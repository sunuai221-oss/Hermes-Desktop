import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import axios from 'axios';
import yaml from 'yaml';
import dns from 'dns/promises';
import net from 'net';
import os from 'os';
import { execFile, execFileSync, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  createApiAuthMiddleware,
  createLocalRequestChecker,
  isAllowedOrigin,
} from './middleware/api-auth.mjs';
import { registerApiAccessRoutes } from './routes/api-access.mjs';
import { registerAgentRoutes } from './routes/agents.mjs';
import { registerConfigRoutes } from './routes/config.mjs';
import { registerContextReferenceRoutes } from './routes/context-references.mjs';
import { registerCronJobRoutes } from './routes/cronjobs.mjs';
import { registerGatewayRoutes } from './routes/gateway.mjs';
import { registerHookRoutes } from './routes/hooks.mjs';
import { registerModelRoutes } from './routes/models.mjs';
import { registerPluginRoutes } from './routes/plugins.mjs';
import { registerSessionRoutes } from './routes/sessions.mjs';
import { registerSkillRoutes } from './routes/skills.mjs';
import { createAgentsService } from './services/agents.mjs';
import { createContextReferenceService } from './services/context-references.mjs';
import { createCronJobsService } from './services/cronjobs.mjs';
import {
  createProviderCatalogService,
  normalizeChatProvider,
} from './services/provider-catalog.mjs';
import { createPluginsService } from './services/plugins.mjs';
import { createRuntimeFilesService } from './services/runtime-files.mjs';
import { createStateDbManager } from './services/state-db.mjs';
import { createSkillsService } from './services/skills.mjs';
import {
  buildResumeRecap,
  createContinuationSession,
  getLatestSessionByTitleVariant,
  getSessionById,
  insertMessages,
  makeSessionId,
  nowTs,
  sanitizeSessionTitle,
  upsertSession,
} from './services/session-store.mjs';

const port = Number(process.env.HERMES_DESKTOP_BACKEND_PORT || process.env.HERMES_BUILDER_PORT || process.env.PORT || 3020);
const bindHost = normalizeGatewayHost(process.env.HERMES_DESKTOP_BIND_HOST || process.env.HERMES_BIND_HOST || '127.0.0.1');
const SERVER_FILE = fileURLToPath(import.meta.url);
const SERVER_DIR = path.dirname(SERVER_FILE);
const BUILDER_ROOT = path.resolve(SERVER_DIR, '..');
const BUILDER_DIST_DIR = path.join(BUILDER_ROOT, 'dist');
const BUILDER_DIST_INDEX = path.join(BUILDER_DIST_DIR, 'index.html');
const BUILDER_SOURCE_INDEX = path.join(BUILDER_ROOT, 'index.html');
const DEFAULT_WSL_DISTRO = process.env.HERMES_WSL_DISTRO || 'Ubuntu';
const BUILDER_UI_MODE = process.argv.includes('--dev')
  ? 'dev'
  : (process.env.HERMES_BUILDER_UI_MODE || 'bundled');
const HERMES_BASE = resolveHermesHome();
const LOCAL_HERMES_STATE_HOME = resolveLocalHermesStateHome();
const WORKSPACE_ROOT = resolveWorkspaceRoot();
const GATEWAY_BASE_URL = (process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const VOICE_SCRIPT_PATH = path.join(SERVER_DIR, 'voice_tools.py');
const API_AUTH_LOGIN = process.env.HERMES_API_LOGIN || '';
const API_AUTH_PASSWORD = process.env.HERMES_API_PASSWORD || '';
const TRUST_PROXY = process.env.HERMES_TRUST_PROXY === '1';
const DEFAULT_JSON_LIMIT = process.env.HERMES_API_JSON_LIMIT || '1mb';
const LARGE_JSON_LIMIT = process.env.HERMES_API_LARGE_JSON_LIMIT || '35mb';
const execFileAsync = promisify(execFile);
const defaultJsonBodyParser = bodyParser.json({ limit: DEFAULT_JSON_LIMIT });
const largeJsonBodyParser = bodyParser.json({ limit: LARGE_JSON_LIMIT });
const app = express();
const isLocalRequest = createLocalRequestChecker({ trustProxy: TRUST_PROXY });
const apiAuthMiddleware = createApiAuthMiddleware({
  isLocalRequest,
  apiAuthLogin: API_AUTH_LOGIN,
  apiAuthPassword: API_AUTH_PASSWORD,
});

app.set('trust proxy', TRUST_PROXY ? 1 : false);

const stateDbManager = createStateDbManager();
const { fetchProviderModels } = createProviderCatalogService({
  axios,
  ollamaBaseUrl: OLLAMA_BASE_URL,
});
const runtimeFilesService = createRuntimeFilesService({ fs, yaml });
const skillsService = createSkillsService({ fs, path, yaml });
const agentsService = createAgentsService({ fs, runtimeFilesService });
const contextReferenceService = createContextReferenceService({
  fs,
  path,
  axios,
  dns,
  net,
  execFileAsync,
  workspaceRoot: WORKSPACE_ROOT,
});
const pluginsService = createPluginsService({
  fs,
  path,
  yaml,
  readConfigForSkills: skillsService.readConfigForSkills,
  workspaceRoot: WORKSPACE_ROOT,
});
const cronJobsService = createCronJobsService({ fs, path });

app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
}));
app.use('/api/gateway/chat', largeJsonBodyParser);
app.use('/api/gateway/chat/stream', largeJsonBodyParser);
app.use('/api/images', largeJsonBodyParser);
app.use('/api/voice/respond', largeJsonBodyParser);
app.use(defaultJsonBodyParser);

function parseDotEnv(content) {
  const result = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isFinite(port) || port <= 0) return null;
  return Math.trunc(port);
}

function normalizeGatewayHost(host) {
  const normalized = String(host || '').trim();
  if (!normalized || normalized === '0.0.0.0' || normalized === '::' || normalized === '::0') {
    return '127.0.0.1';
  }
  return normalized;
}

function parseWslUncPath(inputPath) {
  const value = String(inputPath || '');
  const match = value.match(/^\\\\wsl(?:\.localhost)?\\([^\\]+)(.*)$/i);
  if (!match) return null;
  const distro = match[1];
  const suffix = match[2] || '';
  const linuxPath = suffix ? suffix.replace(/\\/g, '/') : '/';
  return {
    distro,
    linuxPath: linuxPath.startsWith('/') ? linuxPath : `/${linuxPath}`,
  };
}

function toWslUncPath(linuxPath, distro) {
  const normalized = String(linuxPath || '').trim().replace(/\\/g, '/');
  if (!normalized.startsWith('/')) return null;
  return `\\\\wsl.localhost\\${distro}${normalized.replace(/\//g, '\\')}`;
}

function quoteBash(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function toWslPath(targetPath, distro) {
  if (!targetPath) return null;
  const unc = parseWslUncPath(targetPath);
  if (unc) return unc.linuxPath;

  const { stdout } = await execFileAsync('wsl.exe', ['-d', distro, '-e', 'wslpath', '-a', targetPath], {
    cwd: SERVER_DIR,
    windowsHide: true,
  });
  return stdout.trim();
}

/**
 * Manages multiple Hermes Gateway processes for different profiles.
 */
class GatewayProcessManager {
  constructor() {
    this.processes = new Map(); // profileName -> { process, port, startTime }
  }

  async getStatus(profileName) {
    const entry = this.processes.get(profileName);
    if (!entry) return { status: 'offline' };

    if (entry.process.exitCode != null || entry.process.killed) {
      this.processes.delete(profileName);
      return { status: 'offline' };
    }

    return {
      status: 'online',
      port: entry.port,
      startTime: entry.startTime,
      pid: entry.process.pid,
    };
  }

  async start(profileName, port, hermesHome = null) {
    if (this.processes.has(profileName)) {
      const status = await this.getStatus(profileName);
      if (status.status === 'online') return status;
    }

    const unc = parseWslUncPath(hermesHome);
    const distro = unc?.distro || DEFAULT_WSL_DISTRO;
    const wslHome = hermesHome ? await toWslPath(hermesHome, distro).catch(() => null) : null;
    const safeProfile = String(profileName || 'default').replace(/[^\w.-]+/g, '_');
    const bashCommand = [
      'set -e',
      wslHome ? `export HERMES_HOME=${quoteBash(wslHome)}` : '',
      'HERMES_BIN="${HERMES_CLI_PATH:-$(command -v hermes || true)}"',
      'if [ -z "$HERMES_BIN" ] && [ -x "$HOME/.local/bin/hermes" ]; then HERMES_BIN="$HOME/.local/bin/hermes"; fi',
      'if [ -z "$HERMES_BIN" ]; then echo "Hermes CLI not found in WSL" >&2; exit 127; fi',
      `exec "$HERMES_BIN"${safeProfile === 'default' ? '' : ` -p ${quoteBash(safeProfile)}`} gateway run --port ${Number(port)}`,
    ].filter(Boolean).join('; ');
    const args = [
      '-d', distro, '-e', 'bash', '-lc',
      bashCommand,
    ];

    console.log(`[ProcessManager] Starting gateway for profile "${profileName}" on port ${port}...`);
    
    const child = spawn('wsl.exe', args, {
      stdio: 'pipe',
      detached: false
    });

    child.stdout.on('data', (data) => {
      // console.log(`[Gateway:${profileName}] ${data}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[Gateway:${profileName}:err] ${data}`);
    });

    child.on('error', (error) => {
      console.error(`[ProcessManager] Failed to start gateway for profile "${profileName}": ${error.message}`);
      this.processes.delete(profileName);
    });

    child.on('exit', (code) => {
      console.warn(`[ProcessManager] Gateway for profile "${profileName}" exited with code ${code}`);
      this.processes.delete(profileName);
    });

    const entry = {
      process: child,
      port: port,
      startTime: Date.now()
    };
    this.processes.set(profileName, entry);

    return { status: 'online', port, pid: child.pid };
  }

  async stop(profileName, hermesHome = null) {
    const entry = this.processes.get(profileName);
    if (entry) {
      console.log(`[ProcessManager] Stopping gateway for profile "${profileName}" (PID: ${entry.process.pid})...`);
      entry.process.kill();
      this.processes.delete(profileName);
      return { success: true };
    }

    const unc = parseWslUncPath(hermesHome);
    if (unc) {
      const bashCommand = [
        `export HERMES_HOME=${quoteBash(unc.linuxPath)}`,
        'pid=$(cat "$HERMES_HOME/gateway.pid" 2>/dev/null || true)',
        'if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi',
      ].join('; ');
      await execFileAsync('wsl.exe', ['-d', unc.distro, '-e', 'bash', '-lc', bashCommand], {
        cwd: SERVER_DIR,
        windowsHide: true,
      }).catch(() => {});
      return { success: true };
    }

    if (hermesHome) {
      try {
        const pidRaw = await fs.readFile(path.join(hermesHome, 'gateway.pid'), 'utf-8');
        const pid = parsePort(pidRaw);
        if (pid) process.kill(pid);
      } catch {
        // ignore stale or missing PID files
      }
    }

    return { success: true };
  }
}

const gatewayManager = new GatewayProcessManager();

function resolveProfilePaths(profileName, hermesHome) {
  const appState = resolveLocalAppStateDir(profileName);
  return {
    home: hermesHome,
    soul: path.join(hermesHome, 'SOUL.md'),
    config: path.join(hermesHome, 'config.yaml'),
    env: path.join(hermesHome, '.env'),
    gatewayState: path.join(hermesHome, 'gateway_state.json'),
    sessionsDir: path.join(hermesHome, 'sessions'),
    stateDb: path.join(appState, 'state.db'),
    skills: path.join(hermesHome, 'skills'),
    hooks: path.join(hermesHome, 'hooks'),
    memories: path.join(hermesHome, 'memories'),
    memory: path.join(hermesHome, 'memories', 'MEMORY.md'),
    userMemory: path.join(hermesHome, 'memories', 'USER.md'),
    images: path.join(hermesHome, 'images'),
    voice: path.join(hermesHome, 'voice'),
    cron: path.join(hermesHome, 'cron'),
    cronJobs: path.join(hermesHome, 'cron', 'jobs.json'),
    cronOutput: path.join(hermesHome, 'cron', 'output'),
    appState,
    agents: path.join(appState, 'agents.json'),
  };
}

function sanitizeProfileName(profileName) {
  if (!profileName || profileName === 'default') return 'default';
  return String(profileName).replace(/[^\w.-]+/g, '_');
}

function resolveLocalHermesStateHome() {
  const builderParent = path.dirname(BUILDER_ROOT);
  const explicit = process.env.HERMES_BUILDER_STATE_HOME
    ? path.resolve(process.env.HERMES_BUILDER_STATE_HOME)
    : null;
  const candidates = [
    explicit,
    path.basename(builderParent).toLowerCase() === '.hermes' ? builderParent : null,
    parseWslUncPath(HERMES_BASE) ? null : HERMES_BASE,
    path.join(os.homedir(), '.hermes'),
  ].filter(Boolean);

  const ranked = candidates
    .map(candidate => ({ candidate, score: getHermesHomeScore(candidate) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0) {
    return ranked[0].candidate;
  }

  return candidates[0] || path.join(os.homedir(), '.hermes');
}

function resolveLocalAppStateDir(profileName) {
  const appStateRoot = path.join(LOCAL_HERMES_STATE_HOME, '.hermes-builder');
  const safeProfile = sanitizeProfileName(profileName);
  return safeProfile === 'default'
    ? appStateRoot
    : path.join(appStateRoot, 'profiles', safeProfile);
}

function getHermesHome(profileName) {
  if (!profileName || profileName === 'default') return HERMES_BASE;
  const safeName = sanitizeProfileName(profileName);
  return path.join(HERMES_BASE, 'profiles', safeName);
}

function resolveHermesHome() {
  const builderParent = path.dirname(BUILDER_ROOT);
  const homeCandidate = path.join(os.homedir(), '.hermes');
  const wslCandidate = detectWslHermesHome();
  const explicitWslHome = process.env.HERMES_WSL_HOME
    ? toWslUncPath(process.env.HERMES_WSL_HOME, DEFAULT_WSL_DISTRO)
    : null;
  const explicit = process.env.HERMES_HOME ? path.resolve(process.env.HERMES_HOME) : null;
  const candidates = [
    explicit,
    explicitWslHome,
    path.basename(builderParent).toLowerCase() === '.hermes' ? builderParent : null,
    homeCandidate,
    wslCandidate,
  ].filter(Boolean);

  const ranked = candidates
    .map(candidate => ({ candidate, score: getHermesHomeScore(candidate) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0) {
    return ranked[0].candidate;
  }

  return explicit || homeCandidate;
}

function resolveWorkspaceRoot() {
  if (process.env.HERMES_WORKSPACE_ROOT) {
    return path.resolve(process.env.HERMES_WORKSPACE_ROOT);
  }

  if (path.basename(HERMES_BASE).toLowerCase() === '.hermes') {
    return path.dirname(HERMES_BASE);
  }

  return BUILDER_ROOT;
}

function getHermesHomeScore(candidatePath) {
  try {
    const resolved = path.resolve(candidatePath);
    let score = 0;
    if (fsSync.existsSync(path.join(resolved, 'sessions'))) score += 10;
    if (fsSync.existsSync(path.join(resolved, 'gateway_state.json'))) score += 5;
    if (fsSync.existsSync(path.join(resolved, 'SOUL.md'))) score += 3;
    if (fsSync.existsSync(path.join(resolved, 'config.yaml'))) score += 2;
    if (fsSync.existsSync(path.join(resolved, 'skills'))) score += 1;
    if (fsSync.existsSync(path.join(resolved, 'hooks'))) score += 1;
    return score;
  } catch {
    return 0;
  }
}

function detectWslHermesHome() {
  const distro = DEFAULT_WSL_DISTRO;
  try {
    const command = `printf '%s' "$HOME"`;
    const result = fsSync.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe'))
      ? execFileSync('wsl.exe', ['-d', distro, '-e', 'bash', '-lc', command], { encoding: 'utf8' }).trim()
      : '';
    if (!result) return null;
    const uncPath = `\\\\wsl.localhost\\${distro}${result.replace(/\//g, '\\')}\\.hermes`;
    return getHermesHomeScore(uncPath) > 0 ? uncPath : null;
  } catch {
    return null;
  }
}

async function readHermesEnv(hermes) {
  try {
    const data = await fs.readFile(hermes.paths.env, 'utf-8');
    return parseDotEnv(data);
  } catch {
    return {};
  }
}

async function resolveGatewayRuntime(hermes) {
  const env = await readHermesEnv(hermes);
  const managed = await gatewayManager.getStatus(hermes.profile);

  let gatewayUrl = (process.env.HERMES_GATEWAY_URL || '').trim().replace(/\/$/, '');
  let gatewayPort = managed.port || parsePort(env.API_SERVER_PORT) || null;
  let gatewayHost = normalizeGatewayHost(env.API_SERVER_HOST || '');

  if (gatewayUrl) {
    try {
      const parsed = new URL(gatewayUrl);
      gatewayHost = normalizeGatewayHost(gatewayHost || parsed.hostname);
      gatewayPort = gatewayPort || parsePort(parsed.port) || 8642;
    } catch {
      gatewayUrl = '';
    }
  }

  if (!gatewayPort) {
    try {
      const parsed = new URL(GATEWAY_BASE_URL);
      gatewayPort = parsePort(parsed.port) || 8642;
      gatewayHost = normalizeGatewayHost(gatewayHost || parsed.hostname);
    } catch {
      gatewayPort = 8642;
      gatewayHost = normalizeGatewayHost(gatewayHost);
    }
  }

  gatewayHost = normalizeGatewayHost(gatewayHost);

  if (!gatewayUrl || (managed.status === 'online' && managed.port && !process.env.HERMES_GATEWAY_URL)) {
    gatewayUrl = `http://${gatewayHost}:${managed.port || gatewayPort}`;
  }

  return {
    gatewayUrl,
    gatewayPort: managed.port || gatewayPort,
    gatewayHost,
    gatewayApiKey: process.env.API_SERVER_KEY || env.API_SERVER_KEY || '',
  };
}

function gatewayHeaders(hermes, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (hermes.gatewayApiKey) {
    headers.Authorization = `Bearer ${hermes.gatewayApiKey}`;
  }
  return headers;
}

function readModelConfigSync(hermes) {
  try {
    const raw = fsSync.readFileSync(hermes.paths.config, 'utf-8');
    const parsed = yaml.parse(raw) || {};
    return parsed?.model || {};
  } catch {
    return {};
  }
}

function buildGatewayProviderPayload(hermes, body = {}) {
  const provider = normalizeChatProvider(body.provider);
  if (provider === 'ollama') {
    return {
      ...body,
      provider: 'custom',
      base_url: `${OLLAMA_BASE_URL}/v1`,
      api_key: 'ollama',
    };
  }

  if (provider === 'custom') {
    const modelConfig = readModelConfigSync(hermes);
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

function getProviderRequestConfig(hermes, body = {}) {
  const payload = buildGatewayProviderPayload(hermes, body);
  return {
    provider: payload.provider,
    endpoint: `${hermes.gatewayUrl}/v1/chat/completions`,
    headers: gatewayHeaders(hermes, { 'Content-Type': 'application/json' }),
    payload,
    useWslFallback: true,
  };
}

async function readGatewayStateSafe(hermes) {
  try {
    const data = await fs.readFile(hermes.paths.gatewayState, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function requestGatewayHealth(hermes) {
  const endpoints = [`${hermes.gatewayUrl}/health`, `${hermes.gatewayUrl}/v1/health`];
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await axios.get(endpoint, {
        timeout: 2000,
        headers: gatewayHeaders(hermes),
      });
      return { ok: true, data: response.data, endpoint };
    } catch (error) {
      lastError = error;
    }
  }

  return { ok: false, error: lastError };
}

async function waitForGatewayHealth(hermes, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await requestGatewayHealth(hermes);
    if (health.ok) return health;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return null;
}

async function resolveGatewayProcessStatus(hermes) {
  const managed = await gatewayManager.getStatus(hermes.profile);
  const state = await readGatewayStateSafe(hermes);
  const health = await requestGatewayHealth(hermes);
  const isManaged = Boolean(managed.pid);
  const statusSource = isManaged
    ? 'managed-profile'
    : (health.ok ? 'shared-global' : 'offline');

  return {
    status: health.ok ? 'online' : 'offline',
    port: hermes.gatewayPort || managed.port || null,
    pid: state?.pid || managed.pid,
    gateway_state: state?.gateway_state || (health.ok ? 'running' : 'stopped'),
    managed: isManaged,
    status_source: statusSource,
    home: hermes.home,
    workspace_root: WORKSPACE_ROOT,
  };
}

async function getHermesContext(profileName) {
  const home = getHermesHome(profileName);
  const paths = resolveProfilePaths(profileName, home);
  const db = stateDbManager.getStateDb(paths.stateDb);

  const baseContext = { profile: profileName, home, paths, db };
  const runtime = await resolveGatewayRuntime(baseContext);
  return { ...baseContext, ...runtime };
}

async function hermesContextMiddleware(req, res, next) {
  try {
    const profileName = req.headers['x-hermes-profile'] || 'default';
    req.hermes = await getHermesContext(profileName);
    next();
  } catch (error) {
    console.error('[hermesContextMiddleware] Failed to initialize Hermes context:', error);
    res.status(503).json({
      error: 'Hermes Desktop state is temporarily unavailable',
      details: error.message,
    });
  }
}

// ── Profile Management ─────────────────────────────────────────────

app.get('/api/profiles/metadata', async (req, res) => {
  try {
    const profilesDir = path.join(HERMES_BASE, 'profiles');
    const profileNames = ['default'];
    const entries = await fs.readdir(profilesDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) profileNames.push(entry.name);
    }

    const results = [];
    for (const name of profileNames) {
      const context = await getHermesContext(name);
      let config = {};
      try {
        const configData = await fs.readFile(context.paths.config, 'utf-8');
        config = yaml.parse(configData);
      } catch {}

      const procStatus = await resolveGatewayProcessStatus(context);
      
      results.push({
        name,
        isDefault: name === 'default',
        model: config?.model?.default || 'default',
        port: procStatus.port || context.gatewayPort || (name === 'default' ? 8642 : null),
        status: procStatus.status,
        managed: procStatus.managed,
        status_source: procStatus.status_source,
        home: procStatus.home,
      });
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Could not fetch profiles metadata', details: error.message });
  }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const rawName = String(req.body?.name || '').trim();
    const name = sanitizeProfileName(rawName);
    if (!rawName || name === 'default' || rawName !== name) {
      return res.status(400).json({ error: 'Invalid profile name' });
    }
    const profileHome = getHermesHome(name);
    if (await exists(profileHome)) {
      return res.status(409).json({ error: 'Profile already exists' });
    }
    await fs.mkdir(profileHome, { recursive: true });
    
    const paths = resolveProfilePaths(name, profileHome);
    const defaultSoulPath = path.join(HERMES_BASE, 'SOUL.md');
    const defaultConfigPath = path.join(HERMES_BASE, 'config.yaml');
    const defaultEnvPath = path.join(HERMES_BASE, '.env');
    const defaultAuthPath = path.join(HERMES_BASE, 'auth.json');
    const defaultSoul = await fs.readFile(defaultSoulPath, 'utf-8').catch(() => '# Hermes');
    const defaultConfig = await fs.readFile(defaultConfigPath, 'utf-8').catch(() => '');
    
    await fs.writeFile(paths.soul, defaultSoul, 'utf-8');
    await fs.writeFile(paths.config, defaultConfig, 'utf-8');
    await copyFileIfExists(defaultEnvPath, paths.env);
    await copyFileIfExists(defaultAuthPath, path.join(profileHome, 'auth.json'));
    await fs.mkdir(paths.memories, { recursive: true });
    await fs.mkdir(paths.sessionsDir, { recursive: true });
    await fs.mkdir(paths.skills, { recursive: true });
    await fs.mkdir(paths.hooks, { recursive: true });
    await fs.mkdir(paths.cron, { recursive: true });
    await fs.mkdir(path.join(profileHome, 'logs'), { recursive: true });
    
    res.json({ success: true, name });
  } catch (error) {
    res.status(500).json({ error: 'Could not create profile', details: error.message });
  }
});

app.delete('/api/profiles/:name', async (req, res) => {
  try {
    const name = sanitizeProfileName(req.params.name);
    if (name === 'default') {
      return res.status(400).json({ error: 'Cannot delete default profile' });
    }
    const profileHome = getHermesHome(name);
    const stateDbPath = resolveProfilePaths(name, profileHome).stateDb;
    const appStateDir = resolveLocalAppStateDir(name);
    stateDbManager.closeStateDb(stateDbPath);

    // Be very careful with rm -rf
    if (profileHome.startsWith(HERMES_BASE) && profileHome !== HERMES_BASE) {
       await fs.rm(profileHome, { recursive: true, force: true });
    }
    if (appStateDir.startsWith(LOCAL_HERMES_STATE_HOME)) {
      await fs.rm(appStateDir, { recursive: true, force: true }).catch(() => {});
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete profile', details: error.message });
  }
});

async function sendDesktopHealth(_req, res) {
  res.json({
    status: 'ok',
    service: 'hermes-desktop-backend',
    port,
    pid: process.pid,
    frontend: {
      mode: BUILDER_UI_MODE,
      dist_ready: BUILDER_UI_MODE === 'dev'
        ? fsSync.existsSync(BUILDER_SOURCE_INDEX)
        : fsSync.existsSync(BUILDER_DIST_INDEX),
      entrypoint: '/',
    },
  });
}

registerApiAccessRoutes({
  app,
  express,
  apiAuthMiddleware,
  hermesContextMiddleware,
  sendDesktopHealth,
});

// ── Gateway Proxy ──────────────────────────────────────────────────

registerGatewayRoutes({
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
});

// ── File Management ────────────────────────────────────────────────

app.get('/api/soul', async (req, res) => {
  try {
    const data = await fs.readFile(req.hermes.paths.soul, 'utf-8');
    res.json({ content: data });
  } catch {
    res.status(500).json({ error: 'Could not read SOUL.md' });
  }
});

app.post('/api/soul', async (req, res) => {
  try {
    await fs.writeFile(req.hermes.paths.soul, req.body.content, 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Could not write SOUL.md' });
  }
});

app.post('/api/images', async (req, res) => {
  try {
    const rawFileName = String(req.body?.fileName || 'clipboard');
    const fileName = rawFileName.replace(/[^\w.-]+/g, '_').replace(/\.png$/i, '') || 'clipboard';
    const dataUrl = String(req.body?.dataUrl || '');
    const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);

    if (!match) {
      return res.status(400).json({ error: 'Only PNG data URLs are supported' });
    }

    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image must be between 1 byte and 10 MB' });
    }

    await ensureImagesDir(req.hermes);
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetPath = path.join(req.hermes.paths.images, `${id}_${fileName}.png`);
    await fs.writeFile(targetPath, buffer);

    res.json({
      id,
      fileName: `${fileName}.png`,
      mimeType: 'image/png',
      dataUrl,
      path: targetPath,
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not save image attachment', details: error.message });
  }
});

app.post('/api/voice/respond', async (req, res) => {
  let inputPath = null;

  try {
    const dataUrl = String(req.body?.audioDataUrl || '');
    if (!dataUrl) {
      return res.status(400).json({ error: 'audioDataUrl is required' });
    }

    await ensureVoiceDir(req.hermes);
    const { buffer, extension } = parseAudioDataUrl(dataUrl);
    const voiceConfig = await getVoiceConfig(req.hermes);
    const voiceId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    inputPath = path.join(req.hermes.paths.voice, `${voiceId}_input.${extension}`);
    await fs.writeFile(inputPath, buffer);

    const transcript = await transcribeAudioFile(inputPath, voiceConfig.sttModel);
    if (!transcript.trim()) {
      return res.status(400).json({ error: 'No speech detected. Try speaking more clearly or recording a little longer.' });
    }

    const contextText = String(req.body?.contextText || '').trim();
    const images = Array.isArray(req.body?.images) ? req.body.images.filter(item => typeof item?.dataUrl === 'string') : [];
    const userContent = contextText ? `${transcript}\n\n${contextText}` : transcript;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const completion = await postGatewayChatCompletion(req.hermes, {
      model: String(req.body?.model || voiceConfig.model),
      think: req.body?.think ?? voiceConfig.think,
      messages: [
        ...messages,
        {
          role: 'user',
          content: images.length > 0
            ? [
              { type: 'text', text: userContent },
              ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
            ]
            : userContent,
        },
      ],
    });

    const assistantText = extractAssistantText(completion);
    if (!assistantText) {
      return res.status(502).json({ error: 'Voice response was empty' });
    }

    const synthesized = await synthesizeSpeech(req.hermes, assistantText, voiceConfig);
    res.json({
      transcript,
      assistantText,
      ...synthesized,
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not process voice request', details: error.message });
  } finally {
    if (inputPath) {
      fs.unlink(inputPath).catch(() => {});
    }
  }
});

app.post('/api/voice/synthesize', async (req, res) => {
  try {
    const text = sanitizeTextForSpeech(String(req.body?.text || ''));
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const voiceConfig = await getVoiceConfig(req.hermes);
    const synthesized = await synthesizeSpeech(req.hermes, text, voiceConfig);
    res.json(synthesized);
  } catch (error) {
    res.status(500).json({ error: 'Could not synthesize voice reply', details: error.message });
  }
});

async function ensureMemoriesDir(hermes) {
  await fs.mkdir(hermes.paths.memories, { recursive: true });
}

async function ensureImagesDir(hermes) {
  await fs.mkdir(hermes.paths.images, { recursive: true });
}

async function ensureVoiceDir(hermes) {
  await fs.mkdir(hermes.paths.voice, { recursive: true });
}

function parseAudioDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:audio\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Unsupported audio data URL');
  }

  const extension = mimeTypeToExtension(match[1]);
  return {
    buffer: Buffer.from(match[2], 'base64'),
    extension,
  };
}

function mimeTypeToExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return 'm4a';
  throw new Error(`Unsupported audio type: ${mimeType}`);
}

async function getVoiceConfig(hermes) {
  const config = await runtimeFilesService.readYamlConfig(hermes).catch(() => ({}));
  return {
    model: config?.model?.default || 'qwen3.5:27b',
    think: config?.model?.think ?? 'low',
    voice: config?.tts?.edge?.voice || 'en-US-AriaNeural',
    rate: config?.tts?.edge?.rate || '+0%',
    sttModel: config?.stt?.local?.model || 'base',
  };
}

async function postGatewayChatCompletion(hermes, body) {
  const target = getProviderRequestConfig(hermes, body);
  try {
    const response = await axios.post(target.endpoint, target.payload, {
      headers: target.headers,
    });
    return response.data;
  } catch (error) {
    if (!target.useWslFallback || !shouldUseWslGatewayFallback(error)) {
      throw error;
    }

    return postGatewayChatCompletionViaWsl(hermes, target.payload);
  }
}

function shouldUseWslGatewayFallback(error) {
  return Boolean(
    error?.code === 'ECONNREFUSED'
    || error?.cause?.code === 'ECONNREFUSED'
    || /ECONNREFUSED/i.test(String(error?.message || ''))
  );
}

async function postGatewayChatCompletionViaWsl(hermes, body) {
  const distro = process.env.HERMES_WSL_DISTRO || 'Ubuntu';
  await runtimeFilesService.ensureAppStateDir(hermes);
  const requestPath = path.join(hermes.paths.appState, `gateway_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`);
  await fs.writeFile(requestPath, JSON.stringify(body), 'utf-8');

  try {
    const { stdout: wslPathRaw } = await execFileAsync('wsl.exe', ['-d', distro, '-e', 'wslpath', '-a', requestPath], {
      cwd: SERVER_DIR,
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
    const { stdout, stderr } = await execFileAsync('wsl.exe', ['-d', distro, '-e', 'python3', '-c', pythonCode, wslPath, `${hermes.gatewayUrl}/v1/chat/completions`, hermes.gatewayApiKey || ''], {
      cwd: SERVER_DIR,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });

    if (stderr?.trim()) {
      console.warn('[gateway-wsl-fallback]', stderr.trim());
    }

    return JSON.parse(stdout || '{}');
  } finally {
    fs.unlink(requestPath).catch(() => {});
  }
}

function getPythonCommand() {
  const candidates = [
    process.env.HERMES_PYTHON,
    process.env.PYTHON,
    'py',
    'python',
  ].filter(Boolean);

  return candidates[0];
}

async function runVoiceTool(hermes, payload) {
  await ensureVoiceDir(hermes);
  const python = getPythonCommand();
  const requestPath = path.join(hermes.paths.voice, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_voice.json`);
  await fs.writeFile(requestPath, JSON.stringify(payload), 'utf-8');
  const args = python === 'py' ? ['-3.10', VOICE_SCRIPT_PATH, requestPath] : [VOICE_SCRIPT_PATH, requestPath];

  try {
    const { stdout, stderr } = await execFileAsync(python, args, {
      cwd: SERVER_DIR,
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
    fs.unlink(requestPath).catch(() => {});
  }
}

async function transcribeAudioFile(hermes, inputPath, model) {
  const parsed = await runVoiceTool(hermes, {
    action: 'transcribe',
    input_path: inputPath,
    model,
  });
  return String(parsed.text || '').trim();
}

async function synthesizeSpeech(hermes, text, voiceConfig) {
  const sanitized = sanitizeTextForSpeech(text);
  if (!sanitized) {
    throw new Error('No speakable text available');
  }

  await ensureVoiceDir(hermes);
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const edgeFileName = `${id}.mp3`;
  const edgeOutputPath = path.join(hermes.paths.voice, edgeFileName);

  try {
    await runVoiceTool(hermes, {
      action: 'synthesize',
      text: sanitized,
      output_path: edgeOutputPath,
      voice: voiceConfig.voice,
      rate: voiceConfig.rate,
    });

    return {
      audioUrl: `/api/voice/audio/${edgeFileName}`,
      fileName: edgeFileName,
      voice: voiceConfig.voice,
      text: sanitized,
    };
  } catch (error) {
    console.warn('[voice-tools] Edge TTS failed, switching to Windows speech fallback:', error.message);
    return synthesizeSpeechWithWindowsVoice(hermes, id, sanitized);
  }
}

function sanitizeTextForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' code omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

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

async function synthesizeSpeechWithWindowsVoice(hermes, id, text) {
  const fileName = `${id}.wav`;
  const outputPath = path.join(hermes.paths.voice, fileName);
  const command = [
    'Add-Type -AssemblyName System.Speech;',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    'try {',
    `  $synth.SetOutputToWaveFile(${toPowerShellString(outputPath)});`,
    `  $synth.Speak(${toPowerShellString(text)});`,
    '} finally {',
    '  $synth.Dispose();',
    '}',
  ].join(' ');

  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: SERVER_DIR,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });

  return {
    audioUrl: `/api/voice/audio/${fileName}`,
    fileName,
    voice: 'windows-default',
    text,
  };
}

function toPowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const STARTUP_CONTEXT_FILES = ['.hermes.md', 'HERMES.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const NESTED_CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const MAX_CONTEXT_PREVIEW = 8000;

async function scanContextFile(filePath, kind, extra = {}) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const truncated = content.length > MAX_CONTEXT_PREVIEW;
    return {
      path: filePath,
      kind,
      name: path.basename(filePath),
      content: truncated ? `${content.slice(0, 5600)}\n\n[...preview truncated...]\n\n${content.slice(-1600)}` : content,
      charCount: content.length,
      truncated,
      ...extra,
    };
  } catch {
    return null;
  }
}

async function listContextFiles(hermes) {
  const startupCandidates = [];
  let startupWinner = null;

  for (let i = 0; i < STARTUP_CONTEXT_FILES.length; i++) {
    const name = STARTUP_CONTEXT_FILES[i];
    const candidate = await scanContextFile(path.join(WORKSPACE_ROOT, name), 'startup', { priority: i + 1 });
    if (candidate) {
      if (!startupWinner) {
        startupWinner = candidate.path;
        candidate.selectedAtStartup = true;
      } else {
        candidate.selectedAtStartup = false;
      }
      startupCandidates.push(candidate);
    }
  }

  const soul = await scanContextFile(hermes.paths.soul, 'soul');
  const nestedCandidates = [];
  const cursorModules = [];
// ...

  async function walk(dir, depth = 0) {
    if (depth > 5) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.cursor') {
          const rulesDir = path.join(fullPath, 'rules');
          const rulesEntries = await fs.readdir(rulesDir, { withFileTypes: true }).catch(() => []);
          for (const rule of rulesEntries) {
            if (!rule.isFile() || !rule.name.endsWith('.mdc')) continue;
            const file = await scanContextFile(path.join(rulesDir, rule.name), 'cursor-module');
            if (file) cursorModules.push(file);
          }
        }
        await walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!NESTED_CONTEXT_FILES.includes(entry.name)) continue;
      if (dir === WORKSPACE_ROOT && STARTUP_CONTEXT_FILES.includes(entry.name)) continue;

      const file = await scanContextFile(fullPath, 'nested', { discoveredProgressively: true });
      if (file) nestedCandidates.push(file);
    }
  }

  await walk(WORKSPACE_ROOT);

  return {
    workspaceRoot: WORKSPACE_ROOT,
    startupWinner,
    startupCandidates,
    nestedCandidates,
    cursorModules,
    soul,
  };
}

async function getMemoryStores(hermes) {
  const config = await skillsService.readConfigForSkills(hermes);
  await ensureMemoriesDir(hermes);

  const [memoryContent, userContent] = await Promise.all([
    fs.readFile(hermes.paths.memory, 'utf-8').catch(() => ''),
    fs.readFile(hermes.paths.userMemory, 'utf-8').catch(() => ''),
  ]);

  const memoryLimit = config?.memory?.memory_char_limit ?? 2200;
  const userLimit = config?.memory?.user_char_limit ?? 1375;

  const stores = [
    {
      target: 'memory',
      path: hermes.paths.memory,
      content: memoryContent,
      charLimit: memoryLimit,
      charCount: memoryContent.length,
      usagePercent: Math.min(100, Math.round((memoryContent.length / memoryLimit) * 100) || 0),
    },
    {
      target: 'user',
      path: hermes.paths.userMemory,
      content: userContent,
      charLimit: userLimit,
      charCount: userContent.length,
      usagePercent: Math.min(100, Math.round((userContent.length / userLimit) * 100) || 0),
    },
  ];

  return stores;
}

app.get('/api/memory', async (req, res) => {
  try {
    res.json(await getMemoryStores(req.hermes));
  } catch (error) {
    res.status(500).json({ error: 'Could not read memory stores', details: error.message });
  }
});

app.post('/api/memory', async (req, res) => {
  try {
    const target = req.body?.target === 'user' ? 'user' : 'memory';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const stores = await getMemoryStores(req.hermes);
    const store = stores.find(item => item.target === target);

    if (!store) {
      return res.status(400).json({ error: 'Unknown memory target' });
    }

    if (content.length > store.charLimit) {
      return res.status(400).json({
        error: `Memory at ${content.length}/${store.charLimit} chars. Trim content before saving.`,
      });
    }

    await ensureMemoriesDir(req.hermes);
    await fs.writeFile(target === 'user' ? req.hermes.paths.userMemory : req.hermes.paths.memory, content, 'utf-8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not write memory store', details: error.message });
  }
});

app.get('/api/memory/search', async (req, res) => {
  try {
    const query = String(req.query?.q || '').trim();
    if (!query) return res.json([]);
    const db = req.hermes.db;
    const ftsQuery = query
      .replace(/[^\p{L}\p{N}\s_*"'-]/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(token => (token.includes('"') || token.includes('*')) ? token : `${token}*`)
      .join(' ');
    const rows = db.prepare(`
      SELECT
        m.session_id AS sessionId,
        s.source AS platform,
        m.role AS role,
        m.content AS content,
        m.timestamp AS timestamp
      FROM messages_fts f
      JOIN messages m ON m.id = f.rowid
      JOIN sessions s ON s.id = m.session_id
      WHERE f.content MATCH ?
      ORDER BY rank
      LIMIT 25
    `).all(ftsQuery || query);
    const lowered = query.toLowerCase();
    const results = rows.map(row => {
      const content = String(row.content || '');
      const index = Math.max(0, content.toLowerCase().indexOf(lowered));
      return {
        sessionId: row.sessionId,
        platform: row.platform || 'unknown',
        role: row.role || 'unknown',
        snippet: content.slice(Math.max(0, index - 80), index + lowered.length + 160),
        timestamp: row.timestamp,
      };
    });
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Could not search session history', details: error.message });
  }
});

app.get('/api/context-files', async (req, res) => {
  try {
    res.json(await listContextFiles(req.hermes));
  } catch (error) {
    res.status(500).json({ error: 'Could not scan context files', details: error.message });
  }
});

app.post('/api/context-files', async (req, res) => {
  try {
    const targetPath = String(req.body?.path || '');
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const inventory = await listContextFiles(req.hermes);
    const allowed = new Set([
      ...inventory.startupCandidates.map(item => item.path),
      ...inventory.nestedCandidates.map(item => item.path),
      ...inventory.cursorModules.map(item => item.path),
      inventory.soul?.path,
    ].filter(Boolean));

    if (!allowed.has(targetPath)) {
      return res.status(400).json({ error: 'Path is not a discovered editable context file' });
    }

    await fs.writeFile(targetPath, content, 'utf-8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not write context file', details: error.message });
  }
});

registerAgentRoutes({
  app,
  agentsService,
});

registerConfigRoutes({
  app,
  runtimeFilesService,
});

registerContextReferenceRoutes({
  app,
  contextReferenceService,
});

registerSessionRoutes({
  app,
  fs,
  path,
  buildResumeRecap,
  createContinuationSession,
  getLatestSessionByTitleVariant,
  getSessionById,
  insertMessages,
  makeSessionId,
  nowTs,
  sanitizeSessionTitle,
  upsertSession,
});

registerModelRoutes({
  app,
  fetchProviderModels,
});

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyFileIfExists(sourcePath, targetPath) {
  if (!(await exists(sourcePath))) return false;
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

registerSkillRoutes({
  app,
  skillsService,
});

registerHookRoutes({
  app,
  skillsService,
});

registerPluginRoutes({
  app,
  pluginsService,
});

registerCronJobRoutes({
  app,
  cronJobsService,
});

async function installFrontend() {
  if (BUILDER_UI_MODE === 'dev') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: BUILDER_ROOT,
      appType: 'custom',
      server: {
        middlewareMode: true,
      },
    });

    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (path.extname(req.path)) return next();

      try {
        let template = await fs.readFile(BUILDER_SOURCE_INDEX, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(template);
      } catch (error) {
        vite.ssrFixStacktrace(error);
        next(error);
      }
    });
    return;
  }

  if (fsSync.existsSync(BUILDER_DIST_INDEX)) {
    app.use(express.static(BUILDER_DIST_DIR, {
      index: false,
      extensions: ['html'],
    }));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (path.extname(req.path)) {
        return res.status(404).end();
      }
      res.sendFile(BUILDER_DIST_INDEX);
    });
    return;
  }

  app.get('/', (_req, res) => {
    res.status(503).type('text/plain').send(
      'Hermes Desktop frontend bundle is missing. Run "npm run build" in the repository root before opening http://localhost:3020.'
    );
  });
}

let frontendInstallPromise = null;
let backendServerPromise = null;
let backendServer = null;

function formatHostForUrl(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function logServerStartup(host, listenPort) {
  console.log(`[hermes-command-center] Backend running on http://${formatHostForUrl(host)}:${listenPort}`);
  if (BUILDER_UI_MODE === 'dev') {
    console.log(`[hermes-command-center] Serving Vite middleware from ${BUILDER_ROOT}`);
  } else if (fsSync.existsSync(BUILDER_DIST_INDEX)) {
    console.log(`[hermes-command-center] Serving frontend bundle from ${BUILDER_DIST_DIR}`);
  } else {
    console.warn('[hermes-command-center] Frontend bundle missing. / will return 503 until "npm run build" is executed.');
  }
}

export async function initializeApp() {
  if (!frontendInstallPromise) {
    frontendInstallPromise = installFrontend().catch((error) => {
      frontendInstallPromise = null;
      throw error;
    });
  }
  await frontendInstallPromise;
  return app;
}

export async function startServer(options = {}) {
  if (backendServer) return backendServer;
  if (!backendServerPromise) {
    const listenPort = Number(options.port || port);
    const host = normalizeGatewayHost(options.host || bindHost);
    backendServerPromise = initializeApp().then(() => new Promise((resolve, reject) => {
      const server = app.listen(listenPort, host);
      server.once('listening', () => {
        backendServer = server;
        logServerStartup(host, listenPort);
        resolve(server);
      });
      server.once('error', (error) => {
        backendServerPromise = null;
        reject(error);
      });
    }));
  }
  return backendServerPromise;
}

export async function stopServer() {
  if (!backendServer) return;
  const server = backendServer;
  backendServer = null;
  backendServerPromise = null;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export { app, isAllowedOrigin, isLocalRequest };

const isMainModule = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMainModule) {
  await startServer();
}
