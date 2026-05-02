/**
 * Voice pipeline — STT, TTS, language detection, speech synthesis.
 * Extracted from server/index.mjs.
 */

import fs from 'fs';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import {
  normalizeKokoroConfig,
  sanitizeTextForSpeech,
  detectSpeechLanguageMode,
  buildSpeechSynthesisPlan,
  concatenateWavBuffers
} from './kokoro-tts.mjs';

const execFileAsync = promisify(execFileCb);

/**
 * Parse an audio data URL into a buffer + extension.
 */
function parseAudioDataUrl(dataUrl) {
  const match = String(dataUrl || '')
    .trim()
    .match(/^data:audio\/([^;,]+)(?:;[^;,]+)*;base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error('Unsupported audio data URL');
  }

  const extension = mimeTypeToExtension(match[1]);
  return {
    buffer: Buffer.from(match[2], 'base64'),
    extension,
  };
}

/**
 * Map MIME type to file extension.
 */
function mimeTypeToExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'm4a';
  throw new Error(`Unsupported audio type: ${mimeType}`);
}

/**
 * Read voice configuration from runtimeFilesService.
 */
async function getVoiceConfig(hermes, runtimeFilesService) {
  const config = await runtimeFilesService.readYamlConfig(hermes).catch(() => ({}));
  const ttsProvider = String(config?.tts?.provider || 'kokoro').trim() || 'kokoro';
  const neuttsServerConfig = config?.tts?.neutts_server || config?.tts?.neuttsServer || {};

  return {
    model: config?.model?.default || 'Qwen3.6-27B-UD-IQ3_XXS',
    think: config?.model?.think ?? 'low',
    provider: ttsProvider,
    sttModel: config?.stt?.local?.model || 'base',
    kokoro: normalizeKokoroConfig(config?.tts),
    neuttsServer: {
      base_url: String(
        neuttsServerConfig?.base_url
        || neuttsServerConfig?.baseUrl
        || process.env.NEUTTS_SERVER_URL
        || 'http://127.0.0.1:8020'
      ).trim().replace(/\/$/, ''),
      timeout_ms: Number(neuttsServerConfig?.timeout_ms || neuttsServerConfig?.timeoutMs || 180000),
    },
  };
}



/**
 * Get the Python command (py, python, etc).
 */
function getPythonCommand() {
  const candidates = [
    process.env.HERMES_PYTHON,
    process.env.PYTHON,
    'py',
    'python',
  ].filter(Boolean);

  return candidates[0];
}

/**
 * Run a voice tool (STT/TTS) via Python.
 */
async function runVoiceTool(hermes, payload, voiceScriptPath) {
  await ensureVoiceDir(hermes);
  const python = getPythonCommand();
  const requestPath = path.join(hermes.paths.voice, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_voice.json`);
  await fs.promises.writeFile(requestPath, JSON.stringify(payload), 'utf-8');
  const args = python === 'py' ? ['-3.10', voiceScriptPath, requestPath] : [voiceScriptPath, requestPath];

  try {
    const { stdout, stderr } = await execFileAsync(python, args, {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });

    if (stderr?.trim()) {
      console.warn('[voice-tools]', stderr.trim());
    }

    const parsed = JSON.parse(stdout || '{}');
    if (!parsed.ok) {
      throw new Error(parsed.error || 'Voice tool failed');
    }

    return parsed;
  } finally {
    fs.promises.unlink(requestPath).catch(() => {});
  }
}

/**
 * Transcribe an audio file via whisper.
 */
async function transcribeAudioFile(hermes, inputPath, model, voiceScriptPath) {
  const parsed = await runVoiceTool(hermes, {
    action: 'transcribe',
    input_path: inputPath,
    model,
  }, voiceScriptPath);
  return String(parsed.text || '').trim();
}

/**
 * Synthesize speech via Kokoro TTS.
 */
async function synthesizeSpeech(hermes, text, voiceConfig) {
  if (String(voiceConfig?.provider || '').toLowerCase() === 'neutts-server') {
    return synthesizeSpeechWithNeuTtsServer(hermes, text, voiceConfig);
  }

  const plan = buildSpeechSynthesisPlan(text, voiceConfig.kokoro);
  if (!plan.shapedText || plan.segments.length === 0) {
    throw new Error('No speakable text available');
  }

  await ensureVoiceDir(hermes);
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const runtimeConfig = voiceConfig.kokoro.runtime;
  const concatConfig = voiceConfig.kokoro.concatenation;
  const baseUrl = String(runtimeConfig.base_url || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('Kokoro base URL is missing. Set tts.kokoro.base_url in config.yaml.');
  }

  const segmentBuffers = [];
  for (const segment of plan.segments) {
    const payload = {
      model: runtimeConfig.model || 'kokoro',
      input: segment.text,
      voice: segment.voice,
      response_format: 'wav',
      speed: runtimeConfig.speed ?? 1,
      stream: false,
      normalization_options: {
        normalize: runtimeConfig.normalize !== false,
      },
    };
    if (runtimeConfig.lang_code) payload.lang_code = runtimeConfig.lang_code;
    if (runtimeConfig.volume_multiplier && runtimeConfig.volume_multiplier !== 1) {
      payload.volume_multiplier = runtimeConfig.volume_multiplier;
    }

    const response = await axios.post(`${baseUrl}/v1/audio/speech`, payload, {
      headers: { 'Content-Type': 'application/json' },
      responseType: 'arraybuffer',
      timeout: 180000,
    });

    const audioBuffer = Buffer.from(response?.data || []);
    if (!audioBuffer.length) {
      throw new Error(`Kokoro returned an empty audio response for segment "${segment.text.slice(0, 48)}"`);
    }
    segmentBuffers.push(audioBuffer);
  }

  const wavBuffer = segmentBuffers.length === 1
    ? segmentBuffers[0]
    : concatenateWavBuffers(segmentBuffers, {
      gap_ms: concatConfig.gap_ms,
      trim_segment_edges: concatConfig.trim_segment_edges,
    });

  const wavFileName = `${id}_kokoro.wav`;
  const wavOutputPath = path.join(hermes.paths.voice, wavFileName);
  await fs.promises.writeFile(wavOutputPath, wavBuffer);

  const responseFormat = ['wav', 'mp3', 'opus', 'flac'].includes(runtimeConfig.response_format)
    ? runtimeConfig.response_format
    : 'wav';
  let fileName = wavFileName;
  if (responseFormat !== 'wav') {
    fileName = `${id}_kokoro.${responseFormat}`;
    const outputPath = path.join(hermes.paths.voice, fileName);
    await transcodeAudioWithFfmpeg(wavOutputPath, outputPath);
    fs.promises.unlink(wavOutputPath).catch(() => {});
  }

  return {
    audioUrl: `/api/voice/audio/${fileName}?profile=${encodeURIComponent(String(hermes.profile || 'default'))}`,
    fileName,
    voice: `kokoro:${plan.segments.map(segment => segment.voice).join('|')}`,
    text: plan.shapedText,
  };
}

/**
 * Synthesize speech via an already-running NeuTTS HTTP server.
 */
async function synthesizeSpeechWithNeuTtsServer(hermes, text, voiceConfig) {
  const speakableText = normalizeTextForNeuTts(text);
  if (!speakableText) {
    throw new Error('No speakable text available');
  }

  await ensureVoiceDir(hermes);
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const baseUrl = String(voiceConfig?.neuttsServer?.base_url || 'http://127.0.0.1:8020').trim().replace(/\/$/, '');
  const timeout = Number(voiceConfig?.neuttsServer?.timeout_ms || 180000);
  if (!baseUrl) {
    throw new Error('NeuTTS server base URL is missing. Set tts.neutts_server.base_url in config.yaml.');
  }

  const segments = splitTextForNeuTts(speakableText);
  const segmentBuffers = [];
  for (const [index, segment] of segments.entries()) {
    segmentBuffers.push(await requestNeuTtsWavBuffer({
      hermes,
      baseUrl,
      text: segment,
      timeout,
      id: `${id}_${index}`,
    }));
  }

  const wavBuffer = segmentBuffers.length === 1
    ? segmentBuffers[0]
    : concatenateWavBuffers(segmentBuffers, {
      gap_ms: 140,
      trim_segment_edges: true,
    });

  const fileName = `${id}_neutts.wav`;
  const outputPath = path.join(hermes.paths.voice, fileName);
  await fs.promises.writeFile(outputPath, wavBuffer);

  return {
    audioUrl: `/api/voice/audio/${fileName}?profile=${encodeURIComponent(String(hermes.profile || 'default'))}`,
    fileName,
    voice: `neutts-server:${segments.length}`,
    text: speakableText,
  };
}

async function* synthesizeSpeechSegments(hermes, text, voiceConfig) {
  if (String(voiceConfig?.provider || '').toLowerCase() !== 'neutts-server') {
    yield {
      ...(await synthesizeSpeech(hermes, text, voiceConfig)),
      index: 0,
      total: 1,
    };
    return;
  }

  const speakableText = normalizeTextForNeuTts(text);
  if (!speakableText) {
    throw new Error('No speakable text available');
  }

  await ensureVoiceDir(hermes);
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const baseUrl = String(voiceConfig?.neuttsServer?.base_url || 'http://127.0.0.1:8020').trim().replace(/\/$/, '');
  const timeout = Number(voiceConfig?.neuttsServer?.timeout_ms || 180000);
  if (!baseUrl) {
    throw new Error('NeuTTS server base URL is missing. Set tts.neutts_server.base_url in config.yaml.');
  }

  const segments = splitTextForNeuTts(speakableText);
  for (const [index, segment] of segments.entries()) {
    const wavBuffer = await requestNeuTtsWavBuffer({
      hermes,
      baseUrl,
      text: segment,
      timeout,
      id: `${id}_${index}`,
    });
    const fileName = `${id}_${index}_neutts.wav`;
    const outputPath = path.join(hermes.paths.voice, fileName);
    await fs.promises.writeFile(outputPath, wavBuffer);

    yield {
      audioUrl: `/api/voice/audio/${fileName}?profile=${encodeURIComponent(String(hermes.profile || 'default'))}`,
      fileName,
      voice: `neutts-server:${index + 1}/${segments.length}`,
      text: segment,
      index,
      total: segments.length,
    };
  }
}

async function requestNeuTtsWavBuffer({ hermes, baseUrl, text, timeout, id }) {
  const response = await axios.post(`${baseUrl}/tts`, { text }, {
    headers: { 'Content-Type': 'application/json' },
    responseType: 'arraybuffer',
    timeout,
  });

  const audioBuffer = Buffer.from(response?.data || []);
  if (!audioBuffer.length) {
    throw new Error('NeuTTS server returned an empty audio response.');
  }

  if (looksLikeJsonPayload(audioBuffer)) {
    throw new Error('NeuTTS server returned JSON instead of audio. Check NeuTTS logs for upstream errors.');
  }

  const rawExtension = detectAudioExtension(response?.headers?.['content-type'], audioBuffer);
  const rawFileName = `${id}_neutts_raw.${rawExtension}`;
  const rawPath = path.join(hermes.paths.voice, rawFileName);
  await fs.promises.writeFile(rawPath, audioBuffer);

  const outputPath = path.join(hermes.paths.voice, `${id}_neutts_segment.wav`);
  if (rawExtension === 'wav') {
    fs.promises.unlink(rawPath).catch(() => {});
    return audioBuffer;
  } else {
    await transcodeAudioWithFfmpeg(rawPath, outputPath);
    fs.promises.unlink(rawPath).catch(() => {});
    const wavBuffer = await fs.promises.readFile(outputPath);
    fs.promises.unlink(outputPath).catch(() => {});
    return wavBuffer;
  }
}


/**
 * Transcode audio with ffmpeg.
 */
async function transcodeAudioWithFfmpeg(inputPath, outputPath) {
  const ffmpeg = process.env.HERMES_FFMPEG || process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await execFileAsync(ffmpeg, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      outputPath,
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`ffmpeg could not convert audio output: ${error.message}`);
  }
}

function normalizeTextForNeuTts(text) {
  return sanitizeTextForSpeech(text)
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[•◦▪●○◆◇■□]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextForNeuTts(text, maxChars = 180) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];

  const clauses = normalized
    .replace(/\s*([.!?;])\s*/g, '$1\n')
    .split(/\n+/)
    .map(part => part.trim())
    .filter(Boolean);

  const segments = [];
  for (const clause of clauses) {
    if (clause.length <= maxChars) {
      segments.push(clause);
      continue;
    }

    const words = clause.split(/\s+/);
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        segments.push(ensureSentenceEnding(current));
        current = word;
      } else {
        current = next;
      }
    }
    if (current) segments.push(ensureSentenceEnding(current));
  }

  return segments;
}

function ensureSentenceEnding(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  return /[.!?;:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function looksLikeJsonPayload(buffer) {
  const preview = buffer.subarray(0, 64).toString('utf8').trimStart();
  return preview.startsWith('{') || preview.startsWith('[');
}

function detectAudioExtension(contentType, buffer) {
  const normalizedType = String(contentType || '').toLowerCase();
  if (normalizedType) {
    if (normalizedType.includes('wav')) return 'wav';
    if (normalizedType.includes('mpeg') || normalizedType.includes('mp3')) return 'mp3';
    if (normalizedType.includes('ogg')) return 'ogg';
    if (normalizedType.includes('webm')) return 'webm';
    if (normalizedType.includes('flac')) return 'flac';
    if (normalizedType.includes('mp4') || normalizedType.includes('m4a')) return 'm4a';
  }

  const signature = buffer.subarray(0, 16);
  if (signature.length >= 12 && signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (signature.length >= 4 && signature.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (signature.length >= 4 && signature.toString('ascii', 0, 4) === 'fLaC') return 'flac';
  if (signature.length >= 3 && signature.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (signature.length >= 2 && signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0) return 'mp3';
  return 'wav';
}



/**
 * Extract assistant text from gateway response.
 */
function extractAssistantText(responseData) {
  const raw = responseData?.choices?.[0]?.message?.content;
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map(item => (item?.type === 'text' ? item.text : ''))
      .join(' ')
      .trim();
  }
  return '';
}

/**
 * Ensure the voice directory exists.
 */
async function ensureVoiceDir(hermes) {
  await fs.promises.mkdir(hermes.paths.voice, { recursive: true });
}

export {
  parseAudioDataUrl,
  mimeTypeToExtension,
  getVoiceConfig,
  getPythonCommand,
  runVoiceTool,
  transcribeAudioFile,
  synthesizeSpeech,
  synthesizeSpeechWithNeuTtsServer,
  synthesizeSpeechSegments,
  transcodeAudioWithFfmpeg,
  extractAssistantText,
  ensureVoiceDir,
};
