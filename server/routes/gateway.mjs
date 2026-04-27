export function registerGatewayRoutes({
  app,
  axios,
  fs,
  gatewayManager,
  getProviderRequestConfig,
  insertMessages,
  makeSessionId,
  nowTs,
  postGatewayChatCompletion,
  requestGatewayHealth,
  resolveGatewayProcessStatus,
  upsertSession,
  waitForGatewayHealth,
}) {
  app.post('/api/gateway/chat', async (req, res) => {
    try {
      const sessionId = String(req.body?.session_id || '').trim() || makeSessionId();
      const source = String(req.body?.source || 'api-server');
      const userId = req.body?.user_id ? String(req.body.user_id) : null;
      const title = req.body?.session_title ? String(req.body.session_title) : null;
      const model = req.body?.model ? String(req.body.model) : null;
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const latestUserMessage = [...messages].reverse().find(item => item?.role === 'user');

      upsertSession(req.hermes, sessionId, { source, userId, title, model });
      if (latestUserMessage) {
        insertMessages(req.hermes, sessionId, [{
          role: 'user',
          content: latestUserMessage.content,
          timestamp: nowTs(),
        }]);
      }

      const data = await postGatewayChatCompletion(req.hermes, req.body);
      const assistantContent = data?.choices?.[0]?.message?.content;
      if (assistantContent) {
        insertMessages(req.hermes, sessionId, [{
          role: 'assistant',
          content: assistantContent,
          timestamp: nowTs(),
        }]);
      }

      data.session_id = sessionId;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Gateway Proxy Error', details: error.message });
    }
  });

  app.post('/api/gateway/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      const target = getProviderRequestConfig(req.hermes, req.body);
      let response;
      try {
        response = await axios.post(
          target.endpoint,
          { ...target.payload, stream: true },
          {
            responseType: 'stream',
            headers: target.headers,
          }
        );
      } catch (error) {
        const isConnRefused = Boolean(
          error?.code === 'ECONNREFUSED'
          || error?.cause?.code === 'ECONNREFUSED'
          || /ECONNREFUSED/i.test(String(error?.message || ''))
        );
        if (!target.fallbackEndpoint || !isConnRefused) {
          throw error;
        }

        response = await axios.post(
          target.fallbackEndpoint,
          { ...target.payload, stream: true },
          {
            responseType: 'stream',
            headers: target.headers,
          }
        );
      }

      response.data.on('data', chunk => res.write(chunk));
      response.data.on('end', () => res.end());
      response.data.on('error', err => {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      });
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  app.get('/api/gateway/health', async (req, res) => {
    const health = await requestGatewayHealth(req.hermes);
    if (health.ok) {
      return res.json(health.data);
    }
    res.status(503).json({ status: 'offline' });
  });

  app.get('/api/gateway/state', async (req, res) => {
    try {
      const data = await fs.readFile(req.hermes.paths.gatewayState, 'utf-8');
      res.json(JSON.parse(data));
    } catch (error) {
      res.status(500).json({ error: 'Could not read gateway_state.json', details: error.message });
    }
  });

  app.get('/api/gateway/process-status', async (req, res) => {
    try {
      const status = await resolveGatewayProcessStatus(req.hermes);
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get gateway status', details: error.message });
    }
  });

  app.post('/api/gateway/start', async (req, res) => {
    try {
      const profile = req.hermes.profile;
      const existingStatus = await resolveGatewayProcessStatus(req.hermes);
      if (existingStatus.status === 'online') {
        return res.json(existingStatus);
      }

      let port = req.hermes.gatewayPort || (profile === 'default' ? 8642 : 8643 + (req.hermes.profile.length % 100));
      if (req.body?.port) port = Number(req.body.port);

      await gatewayManager.start(profile, port, req.hermes.home);
      const startedContext = {
        ...req.hermes,
        gatewayPort: port,
        gatewayUrl: `http://${req.hermes.gatewayHost}:${port}`,
      };
      const healthy = await waitForGatewayHealth(startedContext);
      if (!healthy) {
        return res.status(500).json({
          error: 'Gateway did not become healthy after startup',
          status: await resolveGatewayProcessStatus(startedContext),
        });
      }

      res.json(await resolveGatewayProcessStatus(startedContext));
    } catch (error) {
      res.status(500).json({ error: 'Failed to start gateway', details: error.message });
    }
  });

  app.post('/api/gateway/stop', async (req, res) => {
    try {
      const result = await gatewayManager.stop(req.hermes.profile, req.hermes.home);
      res.json({ ...result, status: await resolveGatewayProcessStatus(req.hermes) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to stop gateway', details: error.message });
    }
  });
}
