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

  return {
    model: config?.model?.default || 'Qwen3.6-27B-UD-IQ3_XXS',
    think: config?.model?.think ?? 'low',
    provider: 'kokoro',
    sttModel: config?.stt?.local?.model || 'base',
    kokoro: normalizeKokoroConfig(config?.tts),
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
    throw new Error(`ffmpeg could not convert Kokoro output: ${error.message}`);
  }
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
  transcodeAudioWithFfmpeg,
  extractAssistantText,
  ensureVoiceDir,
};
