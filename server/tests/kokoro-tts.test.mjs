import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSpeechSynthesisPlan,
  concatenateWavBuffers,
  normalizeKokoroConfig,
  sanitizeTextForSpeech,
  shapeTextForSpeech,
} from '../services/kokoro-tts.mjs';

function createTestWav(samples, sampleRate = 24000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 4, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 4, 'ascii');
  header.write('fmt ', 12, 4, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 4, 'ascii');
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

test('normalizeKokoroConfig maps legacy voice fields into routing defaults', () => {
  const config = normalizeKokoroConfig({
    kokoro: {
      voice_en: 'af_bella',
      voice_fr: 'ff_siwis',
      voice_multilingual: 'ff_siwis',
      auto_language: true,
      response_format: 'mp3',
    },
  });

  assert.equal(config.routing.voice_en, 'af_bella');
  assert.equal(config.routing.voice_fr, 'ff_siwis');
  assert.equal(config.routing.fallback_voice, 'ff_siwis');
  assert.equal(config.routing.enabled, true);
  assert.equal(config.runtime.response_format, 'mp3');
});

test('speech plan routes FR and EN sentences to the configured voices', () => {
  const config = normalizeKokoroConfig({});
  const plan = buildSpeechSynthesisPlan('Bonjour. Welcome to the demo. Nous allons commencer.', config);

  assert.deepEqual(
    plan.segments.map(segment => ({ text: segment.text, voice: segment.voice })),
    [
      { text: 'Bonjour.', voice: 'ff_siwis' },
      { text: 'Welcome to the demo.', voice: 'af_bella' },
      { text: 'Nous allons commencer.', voice: 'ff_siwis' },
    ],
  );
});

test('speech shaping conservatively restores punctuation for flat bilingual text', () => {
  const config = normalizeKokoroConfig({});
  const plan = buildSpeechSynthesisPlan(
    "Bonjour aujourd'hui on va tester le mode bilingue welcome to the demo",
    config,
  );

  assert.equal(
    plan.shapedText,
    "Bonjour aujourd'hui on va tester le mode bilingue. welcome to the demo.",
  );
  assert.deepEqual(plan.segments.map(segment => segment.voice), ['ff_siwis', 'af_bella']);
});

test('unknown language falls back to the configured fallback voice', () => {
  const config = normalizeKokoroConfig({});
  const plan = buildSpeechSynthesisPlan('Hermes Codex pipeline', config);

  assert.equal(plan.segments.length, 1);
  assert.equal(plan.segments[0].language, 'unknown');
  assert.equal(plan.segments[0].voice, 'ff_siwis');
});

test('shapeTextForSpeech leaves existing sentence punctuation intact', () => {
  const shaped = shapeTextForSpeech('Bonjour. Welcome to the demo.', normalizeKokoroConfig({}).preprocess);
  assert.equal(shaped, 'Bonjour. Welcome to the demo.');
});

test('sanitizeTextForSpeech removes markdown emphasis markers without reading asterisks', () => {
  const sanitized = sanitizeTextForSpeech('Salut *Hermes* et **Codex** avec _Kokoro_.');
  assert.equal(sanitized, 'Salut Hermes et Codex avec Kokoro.');
});

test('sanitizeTextForSpeech strips numeric and bullet list markers for TTS', () => {
  const sanitized = sanitizeTextForSpeech('1. Premier point\n2) Deuxieme point\n- Troisieme point');
  assert.equal(sanitized, 'Premier point Deuxieme point Troisieme point');
});

test('sanitizeTextForSpeech strips inline ordered list markers after punctuation', () => {
  const sanitized = sanitizeTextForSpeech('Voici les points. 1. Premier. 2. Deuxieme. 3. Troisieme.');
  assert.equal(sanitized, 'Voici les points. Premier. Deuxieme. Troisieme.');
});

test('concatenateWavBuffers merges PCM data and inserts optional silence gaps', () => {
  const first = createTestWav([1000, 2000]);
  const second = createTestWav([3000, 4000]);
  const merged = concatenateWavBuffers([first, second], { gap_ms: 100, trim_segment_edges: false });

  assert.equal(merged.toString('ascii', 0, 4), 'RIFF');
  assert.equal(merged.toString('ascii', 8, 12), 'WAVE');
  const dataLength = merged.readUInt32LE(40);
  assert.equal(dataLength, 2 * 2 + 2400 * 2 + 2 * 2);
});
