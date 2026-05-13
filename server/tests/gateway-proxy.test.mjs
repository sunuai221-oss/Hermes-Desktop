import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import yaml from 'yaml';

import {
  buildGatewayProviderPayload,
  getProviderRequestConfig,
  readModelConfigSync,
} from '../services/gateway-proxy.mjs';

test('ollama provider uses a safe default base URL when none is injected', () => {
  const hermes = {
    gatewayUrl: 'http://127.0.0.1:8642',
    sharedGatewayUrl: null,
    gatewayApiKey: '',
  };

  const target = getProviderRequestConfig(hermes, { provider: 'ollama', model: 'llama3' });

  assert.equal(target.provider, 'custom');
  assert.equal(target.payload.provider, 'custom');
  assert.equal(target.payload.base_url, 'http://127.0.0.1:11434/v1');
  assert.equal(target.payload.api_key, 'ollama');
});

test('custom provider reads model config in ESM without require()', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-gateway-proxy-'));
  const configPath = path.join(tempDir, 'config.yaml');
  await fs.writeFile(configPath, 'model:\n  base_url: http://localhost:9999/v1\n  api_key: test-key\n', 'utf-8');

  try {
    const hermes = {
      paths: { config: configPath },
      gatewayUrl: 'http://127.0.0.1:8642',
      sharedGatewayUrl: null,
      gatewayApiKey: '',
    };

    assert.deepEqual(readModelConfigSync(hermes, yaml), {
      base_url: 'http://localhost:9999/v1',
      api_key: 'test-key',
    });

    const payload = buildGatewayProviderPayload(hermes, { provider: 'custom', model: 'custom-model' }, yaml);
    assert.equal(payload.provider, 'custom');
    assert.equal(payload.base_url, 'http://localhost:9999/v1');
    assert.equal(payload.api_key, 'test-key');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
