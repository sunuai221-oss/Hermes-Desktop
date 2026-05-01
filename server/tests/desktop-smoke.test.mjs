import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeWslListOutput,
  parseWslDistrosFromOutput,
} from '../../scripts/desktop-smoke.mjs';

test('normalizes WSL list output by stripping BOM and NUL characters', () => {
  const raw = '\uFEFFU\u0000b\u0000u\u0000n\u0000t\u0000u\u0000\r\u0000\n\u0000';
  assert.equal(normalizeWslListOutput(raw), 'Ubuntu\r\n');
});

test('parses distro names from UTF-16-like WSL output', () => {
  const raw = '\u0000U\u0000b\u0000u\u0000n\u0000t\u0000u\u0000\r\u0000\n\u0000d\u0000o\u0000c\u0000k\u0000e\u0000r\u0000-\u0000d\u0000e\u0000s\u0000k\u0000t\u0000o\u0000p\u0000\r\u0000\n\u0000';
  assert.deepEqual(parseWslDistrosFromOutput(raw), ['Ubuntu', 'docker-desktop']);
});
