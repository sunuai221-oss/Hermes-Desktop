/**
 * Gateway proxy functions — HTTP calls to the Hermes Gateway.
 * Extracted from server/index.mjs.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const execFileAsync = promisify(execFileCb);

/**
 * Read gateway state file safely.
 */
async function readGatewayStateSafe(hermes) {
  try {
    const data = await fs.promises.readFile(hermes.paths.gatewayState, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Check if gateway is healthy via HTTP.
 */
async function requestGatewayHealth(hermes) {
  let lastError = null;
  const targets = [
    { url: hermes.gatewayUrl, port: hermes.gatewayPort, source: 'profile' },
    { url: hermes.sharedGatewayUrl, port: hermes.sharedGatewayPort, source: 'shared-global' },
  ].filter((target, index, all) => target.url && all.findIndex(item => item.url === target.url) === index);

  for (const target of targets) {
    const endpoints = [`${target.url}/health`, `${target.url}/v1/health`];
    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(endpoint, {
          timeout: 2000,
          headers: gatewayHeaders(hermes),
        });
        return {
          ok: true,
          data: response.data,
          endpoint,
          source: target.source,
          gateway_url: target.url,
          port: target.port,
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  return { ok: false, error: lastError };
}

/**
 * Wait for gateway to become healthy.
 */
async function waitForGatewayHealth(hermes, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await requestGatewayHealth(hermes);
    if (health.ok) return health;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return null;
}

/**
 * Build gateway authorization headers.
 */
function gatewayHeaders(hermes, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (hermes.gatewayApiKey) {
    headers.Authorization = `Bearer ${hermes.gatewayApiKey}`;
  }
  return headers;
}

/**
 * Normalize a chat provider name.
 */
function normalizeChatProvider(providerName) {
  if (!providerName) return 'default';
  const normalized = String(providerName).toLowerCase().trim();
  if (normalized === 'ollama') return 'ollama';
  if (normalized === 'custom') return 'custom';
  return normalized;
}

/**
 * Read model config from config.yaml synchronously.
 */
function readModelConfigSync(hermes, yaml) {
  try {
    const raw = fs.readFileSync(hermes.paths.config, 'utf-8');
    const parsed = yaml.parse(raw) || {};
    return parsed?.model || {};
  } catch {
    return {};
  }
}

/**
 * Build the gateway provider payload for a chat request.
 */
function buildGatewayProviderPayload(hermes, body = {}, yaml = null, ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') {
  const provider = normalizeChatProvider(body.provider);
  const normalizedOllamaBaseUrl = String(ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  if (provider === 'ollama') {
    return {
      ...body,
      provider: 'custom',
      base_url: `${normalizedOllamaBaseUrl}/v1`,
      api_key: 'ollama',
    };
  }

  if (provider === 'custom') {
    const modelConfig = readModelConfigSync(hermes, yaml);
    return {
      ...body,
      provider: 'custom',
      base_url: body.base_url || modelConfig.base_url,
      api_key: body.api_key || modelConfig.api_key || 'dummy',
    };
  }

  return {
    ...body,
    provider,
  };
}

/**
 * Get the request config for a gateway provider call.
 */
function getProviderRequestConfig(hermes, body = {}, yaml = null, ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') {
  const payload = buildGatewayProviderPayload(hermes, body, yaml, ollamaBaseUrl);
  return {
    provider: payload.provider,
    endpoint: `${hermes.gatewayUrl}/v1/chat/completions`,
    fallbackEndpoint: hermes.sharedGatewayUrl && hermes.sharedGatewayUrl !== hermes.gatewayUrl
      ? `${hermes.sharedGatewayUrl}/v1/chat/completions`
      : null,
    headers: gatewayHeaders(hermes, { 'Content-Type': 'application/json' }),
    payload,
    useWslFallback: true,
  };
}

/**
 * Check if the error is a connection refused — triggers WSL fallback.
 */
function shouldUseWslGatewayFallback(error) {
  return Boolean(
    error?.code === 'ECONNREFUSED'
    || error?.cause?.code === 'ECONNREFUSED'
    || /ECONNREFUSED/i.test(String(error?.message || ''))
  );
}

/**
 * Post chat completion to gateway with fallback to WSL.
 */
async function postGatewayChatCompletion(hermes, body, { getProviderRequestConfig: grc } = {}) {
  const target = grc ? grc(hermes, body) : getProviderRequestConfig(hermes, body);
  try {
    const response = await axios.post(target.endpoint, target.payload, {
      headers: target.headers,
    });
    return response.data;
  } catch (error) {
    if (target.fallbackEndpoint && shouldUseWslGatewayFallback(error)) {
      try {
        const fallbackResponse = await axios.post(target.fallbackEndpoint, target.payload, {
          headers: target.headers,
        });
        return fallbackResponse.data;
      } catch (fallbackError) {
        error = fallbackError;
      }
    }

    if (!target.useWslFallback || !shouldUseWslGatewayFallback(error)) {
      throw error;
    }

    return postGatewayChatCompletionViaWsl(hermes, target.payload, target.fallbackEndpoint || target.endpoint);
  }
}

/**
 * Fallback: call gateway via WSL Python when direct HTTP fails.
 */
async function postGatewayChatCompletionViaWsl(hermes, body, endpoint) {
  const distro = process.env.HERMES_WSL_DISTRO || 'Ubuntu';
  const requestPath = path.join(hermes.paths.appState, `gateway_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`);
  await fs.promises.writeFile(requestPath, JSON.stringify(body), 'utf-8');

  try {
    const { stdout: wslPathRaw } = await execFileAsync('wsl.exe', ['-d', distro, '-e', 'wslpath', '-a', requestPath], {
      cwd: process.cwd(),
      windowsHide: true,
    });
    const wslPath = wslPathRaw.trim();
    const pythonCode = [
      'import sys, urllib.request',
      'payload = open(sys.argv[1], "rb").read()',
      'endpoint = sys.argv[2]',
      'api_key = sys.argv[3] if len(sys.argv) > 3 else ""',
      'headers = {"Content-Type": "application/json"}',
      'if api_key: headers["Authorization"] = f"Bearer {api_key}"',
      'request = urllib.request.Request(endpoint, data=payload, headers=headers)',
      'sys.stdout.write(urllib.request.urlopen(request, timeout=180).read().decode())',
    ].join('; ');
    const { stdout, stderr } = await execFileAsync('wsl.exe', ['-d', distro, '-e', 'python3', '-c', pythonCode, wslPath, endpoint, hermes.gatewayApiKey || ''], {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });

    if (stderr?.trim()) {
      console.warn('[gateway-wsl-fallback]', stderr.trim());
    }

    return JSON.parse(stdout || '{}');
  } finally {
    fs.promises.unlink(requestPath).catch(() => {});
  }
}

/**
 * Resolve the full gateway process status.
 */
async function resolveGatewayProcessStatus(hermes, gatewayManager) {
  const managed = await gatewayManager.getStatus(hermes.profile);
  const state = await readGatewayStateSafe(hermes);
  const health = await requestGatewayHealth(hermes);
  const isManaged = Boolean(managed.pid);
  const statusSource = isManaged
    ? 'managed-profile'
    : (health.ok ? 'shared-global' : 'offline');

  return {
    status: health.ok ? 'online' : 'offline',
    port: health.port || managed.port || hermes.gatewayPort || null,
    pid: state?.pid || managed.pid,
    gateway_state: state?.gateway_state || (health.ok ? 'running' : 'stopped'),
    managed: isManaged,
    status_source: statusSource,
    gateway_url: health.gateway_url || hermes.gatewayUrl,
    home: hermes.home,
    workspace_root: hermes.workspace_root,
  };
}

export {
  readGatewayStateSafe,
  requestGatewayHealth,
  waitForGatewayHealth,
  gatewayHeaders,
  normalizeChatProvider,
  readModelConfigSync,
  buildGatewayProviderPayload,
  getProviderRequestConfig,
  shouldUseWslGatewayFallback,
  postGatewayChatCompletion,
  postGatewayChatCompletionViaWsl,
  resolveGatewayProcessStatus,
};
