const FRENCH_HINTS = new Set([
  'a', 'au', 'aux', 'avec', 'bonjour', 'car', 'ce', 'ces', 'cette', 'comment',
  'dans', 'de', 'des', 'du', 'elle', 'elles', 'en', 'ensuite', 'est', 'et',
  'etre', 'francais', 'française', 'francaise', 'ici', 'il', 'ils', 'je', 'la',
  'le', 'les', 'leur', 'leurs', 'mais', 'merci', 'mon', 'nous', 'notre', 'ou',
  'par', 'pas', 'plus', 'pour', 'puis', 'que', 'qui', 'sa', 'ses', 'son',
  'sur', 'tu', 'une', 'un', 'vers', 'voici', 'voilà', 'vous', 'votre',
  'aujourdhui', 'configuratio', 'configuration',
]);

const ENGLISH_HINTS = new Set([
  'a', 'an', 'and', 'are', 'but', 'demo', 'english', 'for', 'from', 'hello',
  'here', 'how', 'i', 'in', 'is', 'it', 'its', 'now', 'of', 'on', 'please',
  'show', 'so', 'test', 'thanks', 'that', 'the', 'then', 'these', 'they',
  'this', 'those', 'today', 'to', 'we', 'welcome', 'with', 'works', 'you',
  'your',
]);

const CLAUSE_BREAK_HINTS = new Set([
  'and', 'but', 'then', 'now', 'today', 'welcome', 'et', 'mais', 'puis',
  'ensuite', 'alors', 'maintenant', 'aujourdhui',
]);

const DEFAULT_KOKORO_CONFIG = {
  runtime: {
    base_url: 'http://127.0.0.1:8880',
    model: 'kokoro',
    response_format: 'wav',
    speed: 1,
    lang_code: undefined,
    normalize: true,
    volume_multiplier: 1,
  },
  preprocess: {
    enabled: true,
    mode: 'conservative',
    normalize_whitespace: true,
    restore_basic_punctuation: true,
    split_flat_long_sentences: true,
    preserve_meaning: true,
  },
  routing: {
    enabled: true,
    strategy: 'per_segment',
    detect_language: 'fr_en',
    voice_fr: 'ff_siwis',
    voice_en: 'af_bella',
    fallback_voice: 'ff_siwis',
    uncertain_language_policy: 'dominant_else_fallback',
  },
  concatenation: {
    enabled: true,
    gap_ms: 120,
    trim_segment_edges: true,
    skip_concat_when_single_segment: true,
  },
};

export function normalizeKokoroConfig(tts = {}) {
  const kokoro = tts?.kokoro || {};
  const runtime = kokoro?.runtime || {};
  const preprocess = kokoro?.preprocess || {};
  const routing = kokoro?.routing || {};
  const concatenation = kokoro?.concatenation || {};

  return {
    runtime: {
      base_url: String(
        runtime.base_url
        || runtime.baseUrl
        || kokoro.base_url
        || kokoro.baseUrl
        || tts?.voicebox?.base_url
        || tts?.voicebox?.baseUrl
        || DEFAULT_KOKORO_CONFIG.runtime.base_url,
      ).trim().replace(/\/$/, ''),
      model: String(runtime.model || kokoro.model || DEFAULT_KOKORO_CONFIG.runtime.model).trim() || DEFAULT_KOKORO_CONFIG.runtime.model,
      response_format: normalizeResponseFormat(runtime.response_format || kokoro.response_format || DEFAULT_KOKORO_CONFIG.runtime.response_format),
      speed: clampNumber(runtime.speed ?? kokoro.speed, 1, 0.25, 4),
      lang_code: normalizeOptionalString(runtime.lang_code || runtime.langCode || kokoro.lang_code || kokoro.langCode),
      normalize: normalizeBoolean(runtime.normalize ?? kokoro.normalize, DEFAULT_KOKORO_CONFIG.runtime.normalize),
      volume_multiplier: clampNumber(runtime.volume_multiplier ?? runtime.volumeMultiplier ?? kokoro.volume_multiplier ?? kokoro.volumeMultiplier, 1, 0.01, 10),
    },
    preprocess: {
      enabled: normalizeBoolean(preprocess.enabled, DEFAULT_KOKORO_CONFIG.preprocess.enabled),
      mode: String(preprocess.mode || DEFAULT_KOKORO_CONFIG.preprocess.mode).trim() || DEFAULT_KOKORO_CONFIG.preprocess.mode,
      normalize_whitespace: normalizeBoolean(preprocess.normalize_whitespace, DEFAULT_KOKORO_CONFIG.preprocess.normalize_whitespace),
      restore_basic_punctuation: normalizeBoolean(preprocess.restore_basic_punctuation, DEFAULT_KOKORO_CONFIG.preprocess.restore_basic_punctuation),
      split_flat_long_sentences: normalizeBoolean(preprocess.split_flat_long_sentences, DEFAULT_KOKORO_CONFIG.preprocess.split_flat_long_sentences),
      preserve_meaning: normalizeBoolean(preprocess.preserve_meaning, DEFAULT_KOKORO_CONFIG.preprocess.preserve_meaning),
    },
    routing: {
      enabled: normalizeBoolean(routing.enabled ?? kokoro.auto_language, DEFAULT_KOKORO_CONFIG.routing.enabled),
      strategy: String(routing.strategy || DEFAULT_KOKORO_CONFIG.routing.strategy).trim() || DEFAULT_KOKORO_CONFIG.routing.strategy,
      detect_language: String(routing.detect_language || routing.detectLanguage || DEFAULT_KOKORO_CONFIG.routing.detect_language).trim() || DEFAULT_KOKORO_CONFIG.routing.detect_language,
      voice_fr: String(routing.voice_fr || routing.voiceFr || kokoro.voice_fr || kokoro.voiceFr || DEFAULT_KOKORO_CONFIG.routing.voice_fr).trim() || DEFAULT_KOKORO_CONFIG.routing.voice_fr,
      voice_en: String(routing.voice_en || routing.voiceEn || kokoro.voice_en || kokoro.voiceEn || kokoro.voice || DEFAULT_KOKORO_CONFIG.routing.voice_en).trim() || DEFAULT_KOKORO_CONFIG.routing.voice_en,
      fallback_voice: String(routing.fallback_voice || routing.fallbackVoice || kokoro.voice_multilingual || kokoro.voiceMultilingual || kokoro.voice || DEFAULT_KOKORO_CONFIG.routing.fallback_voice).trim() || DEFAULT_KOKORO_CONFIG.routing.fallback_voice,
      uncertain_language_policy: String(
        routing.uncertain_language_policy
        || routing.uncertainLanguagePolicy
        || DEFAULT_KOKORO_CONFIG.routing.uncertain_language_policy,
      ).trim() || DEFAULT_KOKORO_CONFIG.routing.uncertain_language_policy,
    },
    concatenation: {
      enabled: normalizeBoolean(concatenation.enabled, DEFAULT_KOKORO_CONFIG.concatenation.enabled),
      gap_ms: clampInteger(concatenation.gap_ms ?? concatenation.gapMs, DEFAULT_KOKORO_CONFIG.concatenation.gap_ms, 0, 2000),
      trim_segment_edges: normalizeBoolean(concatenation.trim_segment_edges ?? concatenation.trimSegmentEdges, DEFAULT_KOKORO_CONFIG.concatenation.trim_segment_edges),
      skip_concat_when_single_segment: normalizeBoolean(
        concatenation.skip_concat_when_single_segment ?? concatenation.skipConcatWhenSingleSegment,
        DEFAULT_KOKORO_CONFIG.concatenation.skip_concat_when_single_segment,
      ),
    },
  };
}

export function sanitizeTextForSpeech(text) {
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

export function shapeTextForSpeech(text, preprocessConfig = DEFAULT_KOKORO_CONFIG.preprocess) {
  let result = String(text || '');
  if (!result.trim() || preprocessConfig.enabled === false) {
    return result.trim();
  }

  if (preprocessConfig.normalize_whitespace !== false) {
    result = result
      .replace(/\s+/g, ' ')
      .replace(/\s+([,;:.!?…])/g, '$1')
      .replace(/([,;:.!?…])(?!\s|$)/g, '$1 ');
  }

  if (preprocessConfig.restore_basic_punctuation !== false) {
    result = result.replace(/([A-Za-zÀ-ÿ])([:;,.!?…]){2,}/g, '$1$2');
  }

  if (preprocessConfig.split_flat_long_sentences !== false) {
    result = splitFlatTextConservatively(result);
  }

  result = result.trim();
  if (result && !/[.!?…]$/.test(result)) {
    result = `${result}.`;
  }
  return result;
}

export function detectSpeechLanguageMode(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return 'unknown';

  const words = collectWordSpans(normalized).map(item => classifyWordLanguage(item.word));
  let fr = 0;
  let en = 0;
  for (const label of words) {
    if (label === 'fr') fr += 1;
    if (label === 'en') en += 1;
  }

  if (fr === 0 && en === 0) {
    return /[àâäæçéèêëîïôœùûüÿ]/i.test(normalized) ? 'fr' : 'unknown';
  }
  if (fr >= 2 && en >= 2) return 'mixed';
  if (fr > en) return 'fr';
  if (en > fr) return 'en';
  return 'unknown';
}

export function buildSpeechSynthesisPlan(text, kokoroConfig) {
  const sanitized = sanitizeTextForSpeech(text);
  if (!sanitized) {
    return { sanitizedText: '', shapedText: '', segments: [] };
  }

  const config = kokoroConfig || DEFAULT_KOKORO_CONFIG;
  const shapedText = shapeTextForSpeech(sanitized, config.preprocess);
  const sentenceCandidates = splitIntoSentenceCandidates(shapedText);
  const segments = [];

  for (const sentence of sentenceCandidates) {
    const parts = config.routing?.enabled === false
      ? [sentence]
      : splitMixedLanguageSentence(sentence);

    for (const part of parts) {
      const cleaned = normalizeSegmentText(part);
      if (!cleaned) continue;
      const language = config.routing?.enabled === false ? 'fallback' : detectSpeechLanguageMode(cleaned);
      segments.push({
        text: cleaned,
        language,
        voice: resolveVoiceForSegment(language, config.routing),
      });
    }
  }

  return {
    sanitizedText: sanitized,
    shapedText,
    segments: mergeAdjacentSegments(segments),
  };
}

export function concatenateWavBuffers(buffers, options = {}) {
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
      throw new Error('Kokoro returned incompatible WAV segments.');
    }

    const data = trimEdges ? trimWavPcmData(item) : item.data;
    parts.push(data);
    if (gapMs > 0 && index < parsed.length - 1) {
      parts.push(createSilenceData(reference, gapMs));
    }
  }

  return buildWavBuffer(reference, Buffer.concat(parts));
}

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
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

function normalizeResponseFormat(value) {
  const normalized = String(value || 'wav').trim().toLowerCase();
  return ['wav', 'mp3', 'opus', 'flac', 'pcm'].includes(normalized) ? normalized : 'wav';
}

function splitFlatTextConservatively(text) {
  const normalized = String(text || '').trim();
  if (!normalized || /[.!?…]/.test(normalized)) {
    return normalized;
  }

  const wordMatches = [...normalized.matchAll(/[^\s]+/g)];
  if (wordMatches.length < 10) {
    return normalized;
  }

  const pieces = [];
  let current = [];
  let knownLanguage = [];
  for (let index = 0; index < wordMatches.length; index += 1) {
    const word = wordMatches[index][0];
    current.push(word);
    const label = classifyWordLanguage(word);
    if (label !== 'unknown') knownLanguage.push(label);

    const wordCount = current.length;
    const nextWord = wordMatches[index + 1]?.[0] || '';
    const shouldSplitOnHint = wordCount >= 6 && CLAUSE_BREAK_HINTS.has(normalizeWord(nextWord));
    const shouldSplitByLength = wordCount >= 14;
    const shouldSplitByLanguage = wordCount >= 6 && languageSwitchesStrongly(knownLanguage);

    if (shouldSplitOnHint || shouldSplitByLength || shouldSplitByLanguage) {
      pieces.push(current.join(' '));
      current = [];
      knownLanguage = [];
    }
  }

  if (current.length > 0) {
    pieces.push(current.join(' '));
  }

  return pieces
    .map((piece, index) => piece.trim())
    .filter(Boolean)
    .map((piece, index, all) => {
      if (/[.!?…]$/.test(piece)) return piece;
      return index < all.length - 1 ? `${piece}.` : piece;
    })
    .join(' ');
}

function languageSwitchesStrongly(labels) {
  if (labels.length < 4) return false;
  const left = dominantLanguage(labels.slice(0, Math.ceil(labels.length / 2)));
  const right = dominantLanguage(labels.slice(Math.floor(labels.length / 2)));
  return left !== 'unknown' && right !== 'unknown' && left !== right;
}

function dominantLanguage(labels) {
  let fr = 0;
  let en = 0;
  for (const label of labels) {
    if (label === 'fr') fr += 1;
    if (label === 'en') en += 1;
  }
  if (fr === 0 && en === 0) return 'unknown';
  if (fr === en) return 'unknown';
  return fr > en ? 'fr' : 'en';
}

function splitIntoSentenceCandidates(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  const matches = normalized.match(/[^.!?…]+[.!?…]?/g) || [];
  return matches.map(item => item.trim()).filter(Boolean);
}

function splitMixedLanguageSentence(text) {
  const sentence = String(text || '').trim();
  if (!sentence) return [];
  if (detectSpeechLanguageMode(sentence) !== 'mixed') return [sentence];

  const clauseMatches = sentence.match(/[^,;:]+[,;:]?/g) || [];
  const clauseLanguages = clauseMatches.map(item => detectSpeechLanguageMode(item));
  const distinctClauseLanguages = new Set(clauseLanguages.filter(item => item === 'fr' || item === 'en'));
  if (distinctClauseLanguages.size > 1) {
    return clauseMatches.map(item => item.trim()).filter(Boolean);
  }

  const wordSpans = collectWordSpans(sentence);
  if (wordSpans.length < 4) {
    return [sentence];
  }

  const boundaryIndexes = [];
  for (let index = 1; index < wordSpans.length; index += 1) {
    const leftWindow = wordSpans.slice(Math.max(0, index - 4), index).map(item => item.language).filter(item => item !== 'unknown');
    const rightWindow = wordSpans.slice(index, Math.min(wordSpans.length, index + 4)).map(item => item.language).filter(item => item !== 'unknown');
    const left = dominantLanguage(leftWindow);
    const right = dominantLanguage(rightWindow);
    if (left !== 'unknown' && right !== 'unknown' && left !== right && leftWindow.length >= 2 && rightWindow.length >= 2) {
      boundaryIndexes.push(wordSpans[index - 1].end);
    }
  }

  if (boundaryIndexes.length === 0) {
    return [sentence];
  }

  const segments = [];
  let cursor = 0;
  for (const boundary of boundaryIndexes) {
    const candidate = sentence.slice(cursor, boundary).trim();
    if (candidate) segments.push(candidate);
    cursor = boundary;
  }
  const tail = sentence.slice(cursor).trim();
  if (tail) segments.push(tail);
  return segments.length > 1 ? segments : [sentence];
}

function normalizeSegmentText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.!?…])/g, '$1')
    .trim();
}

function mergeAdjacentSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.voice === segment.voice && previous.language === segment.language) {
      previous.text = normalizeSegmentText(`${previous.text} ${segment.text}`);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function resolveVoiceForSegment(language, routingConfig = DEFAULT_KOKORO_CONFIG.routing) {
  if (routingConfig?.enabled === false) {
    return routingConfig?.fallback_voice || DEFAULT_KOKORO_CONFIG.routing.fallback_voice;
  }
  if (language === 'fr') return routingConfig?.voice_fr || DEFAULT_KOKORO_CONFIG.routing.voice_fr;
  if (language === 'en') return routingConfig?.voice_en || DEFAULT_KOKORO_CONFIG.routing.voice_en;
  return routingConfig?.fallback_voice || DEFAULT_KOKORO_CONFIG.routing.fallback_voice;
}

function collectWordSpans(text) {
  const spans = [];
  const regex = /[\p{L}']+/gu;
  for (const match of text.matchAll(regex)) {
    const word = match[0];
    spans.push({
      word,
      start: match.index,
      end: match.index + word.length,
      language: classifyWordLanguage(word),
    });
  }
  return spans;
}

function classifyWordLanguage(word) {
  const normalized = normalizeWord(word);
  if (!normalized) return 'unknown';
  if (/[àâäæçéèêëîïôœùûüÿ]/i.test(word)) return 'fr';
  if (FRENCH_HINTS.has(normalized)) return 'fr';
  if (ENGLISH_HINTS.has(normalized)) return 'en';
  return 'unknown';
}

function normalizeWord(word) {
  return String(word || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-zàâäæçéèêëîïôœùûüÿ]/gi, '');
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
