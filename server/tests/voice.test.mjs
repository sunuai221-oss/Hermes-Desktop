import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAudioDataUrl } from '../services/voice.mjs';

test('parseAudioDataUrl accepts MediaRecorder webm data URLs with codecs parameters', () => {
  const payload = Buffer.from('voice-bytes');
  const parsed = parseAudioDataUrl(
    `data:audio/webm;codecs=opus;base64,${payload.toString('base64')}`,
  );

  assert.equal(parsed.extension, 'webm');
  assert.deepEqual(parsed.buffer, payload);
});

test('parseAudioDataUrl rejects malformed audio data URLs', () => {
  assert.throws(
    () => parseAudioDataUrl('data:text/plain;base64,SGVsbG8='),
    /Unsupported audio data URL/,
  );
});
