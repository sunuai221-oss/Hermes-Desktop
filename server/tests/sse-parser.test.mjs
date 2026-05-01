import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseSseBlock,
  parseSseChunk,
  normalizeGatewayUsage,
} from '../services/sse-parser.mjs';

test('parses normal text delta chunks', () => {
  const event = parseSseBlock('data: {"choices":[{"delta":{"content":"Hello"}}]}\n');
  assert.ok(event);
  assert.equal(event.done, false);
  assert.equal(event.malformed, false);
  assert.equal(event.contentDelta, 'Hello');
});

test('normalizes complete usage payloads', () => {
  const usage = normalizeGatewayUsage({
    usage: {
      prompt_tokens: 120,
      completion_tokens: 45,
      total_tokens: 165,
      cost: 0.0024,
      rate_limit_remaining: 98,
      rate_limit_reset: 1714502400,
    },
  });

  assert.deepEqual(usage, {
    promptTokens: 120,
    completionTokens: 45,
    totalTokens: 165,
    cost: 0.0024,
    rateLimitRemaining: 98,
    rateLimitReset: 1714502400,
  });
});

test('normalizes partial usage payloads', () => {
  const usage = normalizeGatewayUsage({
    usage: {
      total_tokens: 256,
    },
  });

  assert.deepEqual(usage, {
    promptTokens: null,
    completionTokens: null,
    totalTokens: 256,
    cost: null,
    rateLimitRemaining: null,
    rateLimitReset: null,
  });
});

test('extracts explicit SSE errors', () => {
  const event = parseSseBlock('event: error\ndata: {"error":"Gateway exploded"}\n');
  assert.ok(event);
  assert.equal(event.error, 'Gateway exploded');
});

test('flags malformed JSON chunks without throwing', () => {
  const event = parseSseBlock('data: {"choices":[{"delta":{"content":"oops"}}\n');
  assert.ok(event);
  assert.equal(event.malformed, true);
  assert.equal(event.payload, null);
});

test('handles done markers', () => {
  const event = parseSseBlock('data: [DONE]\n');
  assert.ok(event);
  assert.equal(event.done, true);
});

test('handles custom hermes tool progress events', () => {
  const event = parseSseBlock('event: hermes.tool.progress\ndata: {"tool":"search","progress":50}\n');
  assert.ok(event);
  assert.equal(event.event, 'hermes.tool.progress');
  assert.deepEqual(event.toolProgress, { tool: 'search', progress: 50 });
});

test('parses multi-block SSE streams with buffer carry-over', () => {
  const first = parseSseChunk('', 'data: {"choices":[{"delta":{"content":"He"}}]}\n\n' +
    'data: {"usage":{"total_tokens":2}}\n\n' +
    'data: {"choices":[{"delta":{"content":"ll');

  assert.equal(first.events.length, 2);
  assert.equal(first.events[0].contentDelta, 'He');
  assert.deepEqual(first.events[1].usage, {
    promptTokens: null,
    completionTokens: null,
    totalTokens: 2,
    cost: null,
    rateLimitRemaining: null,
    rateLimitReset: null,
  });
  assert.ok(first.buffer.length > 0);

  const second = parseSseChunk(first.buffer, 'o"}}]}\n\ndata: [DONE]\n\n');
  assert.equal(second.events.length, 2);
  assert.equal(second.events[0].contentDelta, 'llo');
  assert.equal(second.events[1].done, true);
  assert.equal(second.buffer, '');
});
