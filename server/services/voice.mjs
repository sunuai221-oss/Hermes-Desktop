/**
 * Voice pipeline — STT, TTS, language detection, speech synthesis.
 * Extracted from server/index.mjs.
 */

import fs from 'fs';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';


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
  const ttsProvider = String(config?.tts?.provider || 'neutts-server').trim() || 'neutts-server';
  const neuttsServerConfig = config?.tts?.neutts_server || config?.tts?.neuttsServer || {};

  return {
    model: config?.model?.default || 'Qwen3.6-27B-UD-IQ3_XXS',
    think: config?.model?.think ?? 'low',
    provider: ttsProvider,
    sttModel: config?.stt?.local?.model || 'base',
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
 * Synthesize speech via the configured TTS provider.
 */
async function synthesizeSpeech(hermes, text, voiceConfig) {
  return synthesizeSpeechWithNeuTtsServer(hermes, text, voiceConfig);
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

// ── Shared Text/Audio Utilities (formerly from kokoro-tts.mjs) ──

/**
 * Sanitize text for TTS — strip markdown, code fences, links, and emoji.
 */
function sanitizeTextForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' code omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(^|[\s([{\-])(\*{1,3}|_{1,3}|~{2})([^*_~\n]+?)\2(?=$|[\s)\]}.!?,;:…-])/g, '$1$3')
    .replace(/(^|\n)\s*(?:\d{1,3}[.)-]\s+|[-*+•]\s+)/g, '$1')
    .replace(/([.!?…:;])\s+\d{1,3}[.)-]\s+/g, '$1 ')
    .replace(/(^|\n)\s*[-*_]{3,}\s*(?=\n|$)/g, '$1')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replace(/\s*([:;,.!?…])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

/**
 * Concatenate WAV buffers into a single WAV, with optional gap between segments and edge trimming.
 */
function concatenateWavBuffers(buffers, options = {}) {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    throw new Error('No WAV buffers provided for concatenation.');
  }

  const parsed = buffers.map(buffer => parseWavBuffer(buffer));
  const reference = parsed[0];
  const gapMs = clampInteger(options.gap_ms ?? options.gapMs, 0, 0, 2000);
  const trimEdges = options.trim_segment_edges ?? options.trimSegmentEdges ?? false;

  const parts = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (
      item.audioFormat !== reference.audioFormat
      || item.channels !== reference.channels
      || item.sampleRate !== reference.sampleRate
      || item.bitsPerSample !== reference.bitsPerSample
    ) {
      throw new Error('TTS returned incompatible WAV segments.');
    }

    const data = trimEdges ? trimWavPcmData(item) : item.data;
    parts.push(data);
    if (gapMs > 0 && index < parsed.length - 1) {
      parts.push(createSilenceData(reference, gapMs));
    }
  }

  return buildWavBuffer(reference, Buffer.concat(parts));
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseWavBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error('Invalid WAV buffer.');
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Unsupported WAV container.');
  }

  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      data = buffer.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!fmt || !data) {
    throw new Error('WAV file is missing required chunks.');
  }

  return {
    ...fmt,
    data,
  };
}

function trimWavPcmData(parsed) {
  if (parsed.audioFormat !== 1 || parsed.bitsPerSample !== 16) {
    return parsed.data;
  }

  const sampleCount = parsed.data.length / 2;
  let startSample = 0;
  let endSample = sampleCount - 1;
  const threshold = 256;

  while (startSample < sampleCount) {
    if (Math.abs(parsed.data.readInt16LE(startSample * 2)) > threshold) break;
    startSample += 1;
  }

  while (endSample > startSample) {
    if (Math.abs(parsed.data.readInt16LE(endSample * 2)) > threshold) break;
    endSample -= 1;
  }

  const start = Math.max(0, startSample * 2);
  const end = Math.min(parsed.data.length, (endSample + 1) * 2);
  return end > start ? parsed.data.subarray(start, end) : parsed.data;
}

function createSilenceData(parsed, gapMs) {
  const bytesPerSample = parsed.bitsPerSample / 8;
  const frameSize = parsed.channels * bytesPerSample;
  const frames = Math.max(0, Math.round((parsed.sampleRate * gapMs) / 1000));
  return Buffer.alloc(frames * frameSize);
}

function buildWavBuffer(parsed, dataBuffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + dataBuffer.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(parsed.audioFormat, 20);
  header.writeUInt16LE(parsed.channels, 22);
  header.writeUInt32LE(parsed.sampleRate, 24);
  header.writeUInt32LE(parsed.sampleRate * parsed.channels * (parsed.bitsPerSample / 8), 28);
  header.writeUInt16LE(parsed.channels * (parsed.bitsPerSample / 8), 32);
  header.writeUInt16LE(parsed.bitsPerSample, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(dataBuffer.length, 40);
  return Buffer.concat([header, dataBuffer]);
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
  sanitizeTextForSpeech,
  concatenateWavBuffers,
  extractAssistantText,
  ensureVoiceDir,
};
