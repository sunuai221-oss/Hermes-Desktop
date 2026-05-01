import { execFile as execFileCb } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { parseWslUncPath, quoteBash } from '../services/path-resolver.mjs';
import { normalizeGatewayUsage, parseSseChunk } from '../services/sse-parser.mjs';

const execFileAsync = promisify(execFileCb);
const MAX_LOG_BYTES = 256 * 1024;
const MAX_LOG_LINES = 400;

export function registerGatewayRoutes({
  app,
  axios,
  fs,
  gatewayManager,
  getProviderRequestConfig,
  insertMessages,
  makeSessionId,
  nowTs,
  postGatewayChatCompletion,
  requestGatewayHealth,
  resolveGatewayProcessStatus,
  upsertSession,
  waitForGatewayHealth,
}) {
  app.post('/api/gateway/chat', async (req, res) => {
    try {
      const sessionId = String(req.body?.session_id || '').trim() || makeSessionId();
      const source = String(req.body?.source || 'api-server');
      const userId = req.body?.user_id ? String(req.body.user_id) : null;
      const title = req.body?.session_title ? String(req.body.session_title) : null;
      const model = req.body?.model ? String(req.body.model) : null;
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const latestUserMessage = [...messages].reverse().find(item => item?.role === 'user');

      upsertSession(req.hermes, sessionId, { source, userId, title, model });
      if (latestUserMessage) {
        insertMessages(req.hermes, sessionId, [{
          role: 'user',
          content: latestUserMessage.content,
          timestamp: nowTs(),
        }]);
      }

      const data = await postGatewayChatCompletion(req.hermes, req.body);
      const normalizedUsage = normalizeGatewayUsage(data);
      const assistantContent = data?.choices?.[0]?.message?.content;
      if (assistantContent) {
        insertMessages(req.hermes, sessionId, [{
          role: 'assistant',
          content: assistantContent,
          token_count: normalizedUsage?.completionTokens ?? normalizedUsage?.totalTokens ?? null,
          timestamp: nowTs(),
        }]);
      }

      if (normalizedUsage) {
        data.usage = normalizedUsage;
        upsertSession(req.hermes, sessionId, {
          inputTokens: normalizedUsage.promptTokens || 0,
          outputTokens: normalizedUsage.completionTokens || 0,
        });
      }

      data.session_id = sessionId;
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Gateway Proxy Error', details: error.message });
    }
  });

  app.post('/api/gateway/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeData = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const writeEvent = (eventName, payload) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const forwardParsedEvents = (events) => {
      for (const event of events) {
        if (event.done) {
          res.write('data: [DONE]\n\n');
          continue;
        }

        if (event.malformed) {
          continue;
        }

        if (event.event === 'hermes.tool.progress') {
          writeEvent('hermes.tool.progress', event.toolProgress ?? event.payload ?? event.rawData);
          continue;
        }

        if (event.payload && typeof event.payload === 'object') {
          if (event.usage) {
            writeData({ ...event.payload, usage: event.usage });
            writeEvent('hermes.usage', event.usage);
            continue;
          }
          writeData(event.payload);
          continue;
        }

        if (event.error) {
          writeData({ error: event.error });
          continue;
        }

        if (event.usage) {
          writeEvent('hermes.usage', event.usage);
        }
      }
    };

    try {
      const target = getProviderRequestConfig(req.hermes, req.body);
      let response;
      try {
        response = await axios.post(
          target.endpoint,
          { ...target.payload, ...req.body, stream: true },
          {
            responseType: 'stream',
            headers: target.headers,
          }
        );
      } catch (error) {
        const isConnRefused = Boolean(
          error?.code === 'ECONNREFUSED'
          || error?.cause?.code === 'ECONNREFUSED'
          || /ECONNREFUSED/i.test(String(error?.message || ''))
        );
        if (!target.fallbackEndpoint || !isConnRefused) {
          throw error;
        }

        response = await axios.post(
          target.fallbackEndpoint,
          { ...target.payload, ...req.body, stream: true },
          {
            responseType: 'stream',
            headers: target.headers,
          }
        );
      }

      let parserBuffer = '';
      response.data.on('data', chunk => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk || '');
        const parsed = parseSseChunk(parserBuffer, text);
        parserBuffer = parsed.buffer;
        forwardParsedEvents(parsed.events);
      });

      response.data.on('end', () => {
        if (parserBuffer.trim()) {
          const parsed = parseSseChunk(parserBuffer, '\n\n');
          parserBuffer = parsed.buffer;
          forwardParsedEvents(parsed.events);
        }
        res.end();
      });

      response.data.on('error', err => {
        writeData({ error: err.message });
        res.end();
      });
    } catch (error) {
      writeData({ error: error.message });
      res.end();
    }
  });

  app.get('/api/gateway/health', async (req, res) => {
    const health = await requestGatewayHealth(req.hermes);
    if (health.ok) {
      return res.json(sanitizeForClient(health.data));
    }
    res.status(503).json({ status: 'offline' });
  });

  app.get('/api/gateway/health/detailed', async (req, res) => {
    const detailed = await requestDetailedGatewayHealth(req.hermes, axios);
    if (!detailed.ok) {
      return res.status(503).json({ error: detailed.error || 'Detailed gateway health unavailable' });
    }
    res.json({
      endpoint: detailed.endpoint,
      data: sanitizeForClient(detailed.data),
    });
  });

  app.get('/api/gateway/state', async (req, res) => {
    try {
      const data = await fs.readFile(req.hermes.paths.gatewayState, 'utf-8');
      res.json(sanitizeForClient(JSON.parse(data)));
    } catch (error) {
      res.status(500).json({ error: 'Could not read gateway_state.json', details: error.message });
    }
  });

  app.get('/api/gateway/process-status', async (req, res) => {
    try {
      const status = await resolveGatewayProcessStatus(req.hermes, gatewayManager);
      res.json(sanitizeForClient(status));
    } catch (error) {
      res.status(500).json({ error: 'Failed to get gateway status', details: error.message });
    }
  });

  app.get('/api/gateway/diagnostics', async (req, res) => {
    try {
      const [processStatus, health, detailedHealth, logs] = await Promise.all([
        resolveGatewayProcessStatus(req.hermes, gatewayManager),
        requestGatewayHealth(req.hermes),
        requestDetailedGatewayHealth(req.hermes, axios),
        readGatewayLogs(fs, req.hermes),
      ]);

      res.json({
        processStatus: sanitizeForClient(processStatus),
        health: health.ok ? sanitizeForClient(health.data) : { status: 'offline' },
        detailedHealth: detailedHealth.ok ? sanitizeForClient(detailedHealth.data) : null,
        detailedHealthEndpoint: detailedHealth.ok ? detailedHealth.endpoint : null,
        logs: sanitizeForClient(logs),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch diagnostics', details: error.message });
    }
  });

  app.get('/api/gateway/diagnostics/logs', async (req, res) => {
    try {
      const lines = Math.min(1500, Math.max(50, Number(req.query?.lines) || MAX_LOG_LINES));
      const logs = await readGatewayLogs(fs, req.hermes, lines);
      res.json(sanitizeForClient(logs));
    } catch (error) {
      res.status(500).json({ error: 'Could not read gateway logs', details: error.message });
    }
  });

  app.post('/api/gateway/diagnostics/doctor', async (req, res) => {
    const result = await runHermesDiagnosticCommand(req.hermes, ['doctor'], Number(req.body?.timeoutMs) || 180000);
    res.status(result.ok ? 200 : 500).json(sanitizeForClient(result));
  });

  app.post('/api/gateway/diagnostics/dump', async (req, res) => {
    const result = await runHermesDiagnosticCommand(req.hermes, ['dump'], Number(req.body?.timeoutMs) || 180000);
    res.status(result.ok ? 200 : 500).json(sanitizeForClient(result));
  });

  app.post('/api/gateway/diagnostics/backup', async (req, res) => {
    const result = await runHermesDiagnosticCommand(req.hermes, ['backup'], Number(req.body?.timeoutMs) || 180000);
    res.status(result.ok ? 200 : 500).json(sanitizeForClient(result));
  });

  app.post('/api/gateway/start', async (req, res) => {
    try {
      const profile = req.hermes.profile;
      const existingStatus = await resolveGatewayProcessStatus(req.hermes, gatewayManager);
      if (existingStatus.status === 'online') {
        return res.json(existingStatus);
      }

      let port = req.hermes.gatewayPort || (profile === 'default' ? 8642 : 8643 + (req.hermes.profile.length % 100));
      if (req.body?.port) port = Number(req.body.port);

      await gatewayManager.start(profile, port, req.hermes.home);
      const startedContext = {
        ...req.hermes,
        gatewayPort: port,
        gatewayUrl: `http://${req.hermes.gatewayHost}:${port}`,
      };
      const healthy = await waitForGatewayHealth(startedContext);
      if (!healthy) {
        return res.status(500).json({
          error: 'Gateway did not become healthy after startup',
          status: await resolveGatewayProcessStatus(startedContext, gatewayManager),
        });
      }

      res.json(await resolveGatewayProcessStatus(startedContext, gatewayManager));
    } catch (error) {
      res.status(500).json({ error: 'Failed to start gateway', details: error.message });
    }
  });

  app.post('/api/gateway/stop', async (req, res) => {
    try {
      const result = await gatewayManager.stop(req.hermes.profile, req.hermes.home);
      res.json({ ...result, status: await resolveGatewayProcessStatus(req.hermes, gatewayManager) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to stop gateway', details: error.message });
    }
  });
}

async function requestDetailedGatewayHealth(hermes, axios) {
  const uniqueTargets = [
    hermes.gatewayUrl,
    hermes.sharedGatewayUrl,
  ].filter((target, index, all) => Boolean(target) && all.findIndex(item => item === target) === index);

  let lastError = null;
  for (const target of uniqueTargets) {
    const endpoints = [`${target}/health/detailed`, `${target}/v1/health/detailed`];
    for (const endpoint of endpoints) {
      try {
        const headers = hermes.gatewayApiKey
          ? { Authorization: `Bearer ${hermes.gatewayApiKey}` }
          : undefined;
        const response = await axios.get(endpoint, { timeout: 2500, headers });
        return { ok: true, endpoint, data: response.data };
      } catch (error) {
        lastError = error;
      }
    }
  }

  return { ok: false, error: lastError?.message || 'Gateway detailed health endpoint unavailable' };
}

async function readGatewayLogs(fs, hermes, maxLines = MAX_LOG_LINES) {
  const candidates = [
    path.join(hermes.home, 'gateway.log'),
    path.join(hermes.home, 'logs', 'gateway.log'),
    path.join(hermes.home, 'logs', 'hermes-gateway.log'),
    path.join(hermes.home, 'logs', 'gateway', 'gateway.log'),
    path.join(hermes.paths.appState, 'gateway.log'),
  ];

  const logsDir = path.join(hermes.home, 'logs');
  try {
    const entries = await fs.readdir(logsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue;
      candidates.push(path.join(logsDir, entry.name));
    }
  } catch {
    // Logs directory may not exist yet.
  }

  const uniqueCandidates = Array.from(new Set(candidates));
  const existing = [];
  for (const candidate of uniqueCandidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        existing.push({ path: candidate, stat });
      }
    } catch {
      // missing log file
    }
  }

  if (existing.length === 0) {
    return {
      path: null,
      updatedAt: null,
      sizeBytes: 0,
      truncated: false,
      content: '',
      note: 'No gateway log file detected yet.',
    };
  }

  existing.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const selected = existing[0];
  const text = await readFileTail(fs, selected.path, MAX_LOG_BYTES);
  const lines = text.split(/\r?\n/);
  const trimmed = lines.slice(-maxLines).join('\n').trim();

  return {
    path: selected.path,
    updatedAt: selected.stat.mtime.toISOString(),
    sizeBytes: selected.stat.size,
    truncated: lines.length > maxLines || selected.stat.size > MAX_LOG_BYTES,
    content: redactSecrets(trimmed),
  };
}

async function readFileTail(fs, filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(maxBytes, stat.size);
    const start = Math.max(0, stat.size - length);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) {
        text = text.slice(firstNewline + 1);
      }
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function runHermesDiagnosticCommand(hermes, commandArgs, timeoutMs) {
  const unc = parseWslUncPath(hermes.home);
  const distro = unc?.distro || process.env.HERMES_WSL_DISTRO || 'Ubuntu';
  const homeExport = unc?.linuxPath
    ? `export HERMES_HOME=${quoteBash(unc.linuxPath)}`
    : 'export HERMES_HOME="${HERMES_WSL_HOME:-$HOME/.hermes}"';
  const escapedArgs = commandArgs.map(arg => quoteBash(String(arg))).join(' ');

  const script = [
    'set -e',
    homeExport,
    'HERMES_BIN="${HERMES_CLI_PATH:-$(command -v hermes || true)}"',
    'if [ -z "$HERMES_BIN" ] && [ -x "$HOME/.local/bin/hermes" ]; then HERMES_BIN="$HOME/.local/bin/hermes"; fi',
    'if [ -z "$HERMES_BIN" ]; then echo "Hermes CLI not found in WSL PATH." >&2; exit 127; fi',
    `"$HERMES_BIN" ${escapedArgs}`,
  ].join('; ');

  try {
    const { stdout, stderr } = await execFileAsync(
      'wsl.exe',
      ['-d', distro, '-e', 'bash', '-lc', script],
      {
        cwd: process.cwd(),
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      }
    );

    return {
      ok: true,
      command: `hermes ${commandArgs.join(' ')}`,
      distro,
      stdout: redactSecrets(stdout || ''),
      stderr: redactSecrets(stderr || ''),
    };
  } catch (error) {
    return {
      ok: false,
      command: `hermes ${commandArgs.join(' ')}`,
      distro,
      stdout: redactSecrets(error?.stdout || ''),
      stderr: redactSecrets(error?.stderr || error?.message || 'Unknown diagnostic error'),
      code: typeof error?.code === 'number' ? error.code : null,
    };
  }
}

function sanitizeForClient(value, depth = 0) {
  if (value == null) return value;
  if (depth > 8) return '[truncated]';

  if (typeof value === 'string') return redactSecrets(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(item => sanitizeForClient(item, depth + 1));
  if (typeof value !== 'object') return String(value);

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      result[key] = '[redacted]';
      continue;
    }
    result[key] = sanitizeForClient(entry, depth + 1);
  }
  return result;
}

function redactSecrets(input) {
  return String(input || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/(api[_-]?key\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[redacted]')
    .replace(/(token\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[redacted]')
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, 'sk-[redacted]');
}

function isSensitiveKey(key) {
  return /(secret|token|api[_-]?key|password|authorization)/i.test(String(key || ''));
}
