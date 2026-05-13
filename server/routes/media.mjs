async function ensureImagesDir(fs, hermes) {
  await fs.mkdir(hermes.paths.images, { recursive: true });
}

export function registerMediaRoutes({
  app,
  fs,
  path,
  runtimeFilesService,
  voiceScriptPath,
  extractAssistantText,
  getVoiceConfig,
  parseAudioDataUrl,
  postGatewayChatCompletion,
  sanitizeTextForSpeech,
  synthesizeSpeech,
  synthesizeSpeechSegments,
  transcribeAudioFile,
}) {
  app.post('/api/images', async (req, res) => {
    try {
      const rawFileName = String(req.body?.fileName || 'clipboard');
      const fileName = rawFileName.replace(/[^\w.-]+/g, '_').replace(/\.png$/i, '') || 'clipboard';
      const dataUrl = String(req.body?.dataUrl || '');
      const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);

      if (!match) {
        return res.status(400).json({ error: 'Only PNG data URLs are supported' });
      }

      const buffer = Buffer.from(match[1], 'base64');
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image must be between 1 byte and 10 MB' });
      }

      await ensureImagesDir(fs, req.hermes);
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const targetPath = path.join(req.hermes.paths.images, `${id}_${fileName}.png`);
      await fs.writeFile(targetPath, buffer);

      res.json({
        id,
        fileName: `${fileName}.png`,
        mimeType: 'image/png',
        dataUrl,
        path: targetPath,
      });
    } catch (error) {
      res.status(500).json({ error: 'Could not save image attachment', details: error.message });
    }
  });

  app.post('/api/voice/respond', async (req, res) => {
    let inputPath = null;

    try {
      const dataUrl = String(req.body?.audioDataUrl || '');
      if (!dataUrl) {
        return res.status(400).json({ error: 'audioDataUrl is required' });
      }

      await fs.mkdir(req.hermes.paths.voice, { recursive: true });
      const { buffer, extension } = parseAudioDataUrl(dataUrl);
      const voiceConfig = await getVoiceConfig(req.hermes, runtimeFilesService);
      const voiceId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      inputPath = path.join(req.hermes.paths.voice, `${voiceId}_input.${extension}`);
      await fs.writeFile(inputPath, buffer);

      const transcript = await transcribeAudioFile(req.hermes, inputPath, voiceConfig.sttModel, voiceScriptPath);
      if (!transcript.trim()) {
        return res.status(400).json({ error: 'No speech detected. Try speaking more clearly or recording a little longer.' });
      }

      const contextText = String(req.body?.contextText || '').trim();
      const images = Array.isArray(req.body?.images) ? req.body.images.filter(item => typeof item?.dataUrl === 'string') : [];
      const userContent = contextText ? `${transcript}\n\n${contextText}` : transcript;
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const completion = await postGatewayChatCompletion(req.hermes, {
        model: String(req.body?.model || voiceConfig.model),
        think: req.body?.think ?? voiceConfig.think,
        messages: [
          ...messages,
          {
            role: 'user',
            content: images.length > 0
              ? [
                { type: 'text', text: userContent },
                ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
              ]
              : userContent,
          },
        ],
      });

      const assistantText = extractAssistantText(completion);
      if (!assistantText) {
        return res.status(502).json({ error: 'Voice response was empty' });
      }

      const synthesized = await synthesizeSpeech(req.hermes, assistantText, voiceConfig);
      res.json({
        transcript,
        assistantText,
        ...synthesized,
      });
    } catch (error) {
      res.status(500).json({ error: 'Could not process voice request', details: error.message });
    } finally {
      if (inputPath) {
        fs.unlink(inputPath).catch(() => {});
      }
    }
  });

  app.post('/api/voice/synthesize', async (req, res) => {
    try {
      const text = sanitizeTextForSpeech(String(req.body?.text || ''));
      if (!text) {
        return res.status(400).json({ error: 'text is required' });
      }

      const voiceConfig = await getVoiceConfig(req.hermes, runtimeFilesService);
      const synthesized = await synthesizeSpeech(req.hermes, text, voiceConfig);
      res.json(synthesized);
    } catch (error) {
      res.status(500).json({ error: 'Could not synthesize voice reply', details: error.message });
    }
  });

  app.post('/api/voice/synthesize/stream', async (req, res) => {
    const text = sanitizeTextForSpeech(String(req.body?.text || ''));
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const sendEvent = (event, payload) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      const voiceConfig = await getVoiceConfig(req.hermes, runtimeFilesService);
      let count = 0;
      for await (const synthesized of synthesizeSpeechSegments(req.hermes, text, voiceConfig)) {
        count += 1;
        sendEvent('voice.audio', synthesized);
      }
      sendEvent('done', { ok: true, count });
    } catch (error) {
      sendEvent('error', { error: 'Could not synthesize voice reply', details: error.message });
    } finally {
      res.end();
    }
  });

  app.delete('/api/voice/audio/:fileName', async (req, res) => {
    try {
      const requestedFileName = String(req.params?.fileName || '').trim();
      const fileName = path.basename(requestedFileName);
      if (!fileName || fileName !== requestedFileName) {
        return res.status(400).json({ error: 'Invalid audio file name' });
      }

      const voiceDir = path.resolve(req.hermes.paths.voice);
      const targetPath = path.resolve(voiceDir, fileName);
      const relativePath = path.relative(voiceDir, targetPath);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return res.status(400).json({ error: 'Invalid audio file path' });
      }

      await fs.unlink(targetPath).catch((error) => {
        if (error?.code === 'ENOENT') return;
        throw error;
      });
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: 'Could not delete voice audio', details: error.message });
    }
  });
}
