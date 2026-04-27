import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createProviderCatalogService,
  normalizeChatProvider,
} from '../services/provider-catalog.mjs';

test('normalizeChatProvider resolves supported aliases to canonical providers', () => {
  assert.equal(normalizeChatProvider(), 'profile-default');
  assert.equal(normalizeChatProvider(' openai '), 'codex-openai');
  assert.equal(normalizeChatProvider('codex'), 'codex-openai');
  assert.equal(normalizeChatProvider('custom'), 'custom');
  assert.equal(normalizeChatProvider('nousresearch'), 'nous');
  assert.equal(normalizeChatProvider('lm-studio'), 'profile-default');
  assert.equal(normalizeChatProvider('unknown-provider'), 'profile-default');
});

test('provider catalog uses Ollama catalogs for supported local model lookups', async () => {
  const calls = [];
  const payload = {
    models: [
      { name: 'Qwen3.6-27B-UD-IQ3_XXS', modified_at: '2026-04-16T10:00:00Z' },
    ],
  };
  const service = createProviderCatalogService({
    axios: {
      async get(url, options) {
        calls.push({ url, options });
        return { data: payload };
      },
    },
    ollamaBaseUrl: 'http://127.0.0.1:11434',
  });

  const result = await service.fetchProviderModels('ollama');

  assert.deepEqual(calls, [{
    url: 'http://127.0.0.1:11434/api/tags',
    options: { timeout: 3000 },
  }]);
  assert.equal(result, payload);
});

test('provider catalog falls back to Ollama catalogs for default providers', async () => {
  const calls = [];
  const payload = {
    models: [
      { name: 'llama3.2', modified_at: '2026-04-16T10:00:00Z' },
    ],
  };
  const service = createProviderCatalogService({
    axios: {
      async get(url, options) {
        calls.push({ url, options });
        return { data: payload };
      },
    },
    ollamaBaseUrl: 'http://127.0.0.1:11434',
  });

  const result = await service.fetchProviderModels('openai');

  assert.deepEqual(calls, [{
    url: 'http://127.0.0.1:11434/api/tags',
    options: { timeout: 3000 },
  }]);
  assert.equal(result, payload);
});
