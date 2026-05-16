/**
 * Hermes Desktop Backend — Modular Entry Point
 *
 * Composes services and routes. All business logic lives in:
 *   services/  — business modules (gateway, voice, files, sessions, ...)
 *   routes/    — route registration
 *   middleware/ — auth, local-check
 *   lib/       — pure utilities
 *
 * This file only handles: app setup, service instantiation, route wiring,
 * and the Express server lifecycle.
 */

// ── Dependencies ───────────────────────────────────────────────────
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

// ── Middleware ──────────────────────────────────────────────────────
import {
  createApiAuthMiddleware,
  createLocalRequestChecker,
  isAllowedOrigin,
} from './middleware/api-auth.mjs';

// ── Routes ──────────────────────────────────────────────────────────
import { registerApiAccessRoutes } from './routes/api-access.mjs';
// ── deprecated: replaced by agent-studio (no frontend consumers) ──
import { registerAgentStudioRoutes } from './routes/agent-studio.mjs';
import { registerConfigRoutes } from './routes/config.mjs';
import { registerContextFileRoutes } from './routes/context-files.mjs';
import { registerContextReferenceRoutes } from './routes/context-references.mjs';
import { registerCronJobRoutes } from './routes/cronjobs.mjs';
import { registerGatewayRoutes } from './routes/gateway.mjs';
import { registerHookRoutes } from './routes/hooks.mjs';
import { registerIdentityRoutes } from './routes/identity.mjs';
import { registerKanbanRoutes } from './routes/kanban.mjs';
import { registerMediaRoutes } from './routes/media.mjs';
import { registerModelRoutes } from './routes/models.mjs';
import { registerPluginRoutes } from './routes/plugins.mjs';
import { registerPawrtalRoutes } from './routes/pawrtal.mjs';
import { registerLive2dRoutes } from './routes/live2d.mjs';
import { registerProfileRoutes } from './routes/profiles.mjs';
import { registerSessionRoutes } from './routes/sessions.mjs';
import { registerSkillRoutes } from './routes/skills.mjs';

// ── Services (factories) ────────────────────────────────────────────
import { createAgentStudioService } from './services/agent-studio.mjs';
import { createContextReferenceService } from './services/context-references.mjs';
import { createCronJobsService } from './services/cronjobs.mjs';
import {
  createProviderCatalogService,
  normalizeChatProvider,
} from './services/provider-catalog.mjs';
import { createPluginsService } from './services/plugins.mjs';
import { createPawrtalService } from './services/pawrtal.mjs';
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

// ── Extracted modules ───────────────────────────────────────────────
import { GatewayProcessManager } from './services/gateway-manager.mjs';
import {
  resolveProfilePaths,
  getHermesHome,
  resolveHermesHome,
  resolveLocalHermesStateHome,
  resolveWorkspaceRoot,
  getHermesHomeScore,
  detectWslHermesHome,
  resolveLocalAppStateDir,
  sanitizeProfileName,
} from './services/profile-resolver.mjs';
import {
  parsePort,
  normalizeGatewayHost,
  parseGatewayTarget,
  buildGatewayTarget,
  parseWslUncPath,
  toWslUncPath,
  quoteBash,
  toWslPath,
} from './services/path-resolver.mjs';
import {
  readGatewayStateSafe,
  requestGatewayHealth,
  waitForGatewayHealth,
  gatewayHeaders,
  readModelConfigSync,
  buildGatewayProviderPayload,
  getProviderRequestConfig,
  shouldUseWslGatewayFallback,
  postGatewayChatCompletion,
  postGatewayChatCompletionViaWsl,
  resolveGatewayProcessStatus,
} from './services/gateway-proxy.mjs';
import {
  parseAudioDataUrl,
  mimeTypeToExtension,
  getVoiceConfig,
  getPythonCommand,
  runVoiceTool,
  transcribeAudioFile,
  synthesizeSpeech,
  synthesizeSpeechSegments,
  transcodeAudioWithFfmpeg,
  sanitizeTextForSpeech,
  extractAssistantText,
} from './services/voice.mjs';

// ── Constants ───────────────────────────────────────────────────────
const execFileAsync = promisify(execFile);
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

// ── Hermes paths (resolved at startup) ──────────────────────────────
const HERMES_BASE = resolveHermesHome({ builderRoot: BUILDER_ROOT, distro: DEFAULT_WSL_DISTRO });
const LOCAL_HERMES_STATE_HOME = resolveLocalHermesStateHome({ builderRoot: BUILDER_ROOT, hermesBase: HERMES_BASE });
const WORKSPACE_ROOT = resolveWorkspaceRoot({ hermesBase: HERMES_BASE, builderRoot: BUILDER_ROOT });
const GATEWAY_BASE_URL = (process.env.HERMES_GATEWAY_URL || 'http://127.0.0.1:8642').replace(/\/$/, '');
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const VOICE_SCRIPT_PATH = path.join(SERVER_DIR, 'voice_tools.py');

// ── Auth / Security ─────────────────────────────────────────────────
const API_AUTH_LOGIN = process.env.HERMES_DESKTOP_API_AUTH_LOGIN || '';
const API_AUTH_PASSWORD = process.env.HERMES_DESKTOP_API_AUTH_PASSWORD || '';
const TRUST_PROXY = process.env.HERMES_TRUST_PROXY === '1';
const DEFAULT_JSON_LIMIT = process.env.HERMES_API_JSON_LIMIT || '1mb';
const LARGE_JSON_LIMIT = process.env.HERMES_API_LARGE_JSON_LIMIT || '35mb';

// ── Service Instances ───────────────────────────────────────────────
const gatewayManager = new GatewayProcessManager();
const stateDbManager = createStateDbManager();
const { fetchProviderModels } = createProviderCatalogService({
  axios,
  ollamaBaseUrl: OLLAMA_BASE_URL,
});
const runtimeFilesService = createRuntimeFilesService({ fs, yaml });
const skillsService = createSkillsService({ fs, path, yaml });
const agentStudioService = createAgentStudioService({ fs, path, yaml, runtimeFilesService });
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
const pawrtalService = createPawrtalService({
  fs,
  execFileAsync,
});
const cronJobsService = createCronJobsService({ fs, path });
const getDesktopProviderRequestConfig = (hermes, body = {}) => getProviderRequestConfig(hermes, body, yaml, OLLAMA_BASE_URL);
const postDesktopGatewayChatCompletion = (hermes, body, options = {}) => postGatewayChatCompletion(hermes, body, {
  ...options,
  getProviderRequestConfig: options.getProviderRequestConfig || getDesktopProviderRequestConfig,
});

// ── Express App Setup ───────────────────────────────────────────────
const app = express();
const isLocalRequest = createLocalRequestChecker({ trustProxy: TRUST_PROXY });
const apiAuthMiddleware = createApiAuthMiddleware({
  isLocalRequest,
  apiAuthLogin: API_AUTH_LOGIN,
  apiAuthPassword: API_AUTH_PASSWORD,
});

app.set('trust proxy', TRUST_PROXY ? 1 : false);

app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin));
  },
}));

app.use('/api/gateway/chat', bodyParser.json({ limit: LARGE_JSON_LIMIT }));
app.use('/api/gateway/chat/stream', bodyParser.json({ limit: LARGE_JSON_LIMIT }));
app.use('/api/images', bodyParser.json({ limit: LARGE_JSON_LIMIT }));
app.use('/api/voice/respond', bodyParser.json({ limit: LARGE_JSON_LIMIT }));
app.use(bodyParser.json({ limit: DEFAULT_JSON_LIMIT }));

// ── Hermes Context Resolver ─────────────────────────────────────────
async function getHermesContext(profileName) {
  const home = getHermesHome(HERMES_BASE, profileName);
  const paths = resolveProfilePaths(profileName, home, LOCAL_HERMES_STATE_HOME);
  const db = stateDbManager.getStateDb(paths.stateDb);

  const baseContext = { profile: profileName, home, paths, db };
  const env = await readHermesEnv(baseContext);
  const managed = await gatewayManager.getStatus(profileName);
  const explicitGateway = parseGatewayTarget(process.env.HERMES_GATEWAY_URL || '');
  const sharedGateway = explicitGateway
    || parseGatewayTarget(GATEWAY_BASE_URL)
    || buildGatewayTarget('127.0.0.1', 8642);
  const profileGatewayPort = managed.port || parsePort(env.API_SERVER_PORT) || sharedGateway.port;
  const profileGatewayHost = normalizeGatewayHost(env.API_SERVER_HOST || sharedGateway.host);
  const profileGateway = buildGatewayTarget(profileGatewayHost, profileGatewayPort);

  let gatewayApiKey = process.env.API_SERVER_KEY || env.API_SERVER_KEY || '';
  if (!gatewayApiKey && profileName && profileName !== 'default') {
    const defaultEnv = await readEnvFile(path.join(HERMES_BASE, '.env'));
    gatewayApiKey = defaultEnv.API_SERVER_KEY || '';
  }

  return {
    ...baseContext,
    gatewayUrl: profileGateway.url,
    gatewayPort: profileGateway.port,
    gatewayHost: profileGateway.host,
    sharedGatewayUrl: sharedGateway.url,
    sharedGatewayPort: sharedGateway.port,
    sharedGatewayHost: sharedGateway.host,
    gatewayApiKey,
  };
}

async function readHermesEnv(hermes) {
  return readEnvFile(hermes.paths.env);
}

async function readEnvFile(envPath) {
  try {
    const data = await fs.readFile(envPath, 'utf-8');
    return parseDotEnv(data);
  } catch {
    const fallback = await readHermesEnvViaWsl(envPath);
    return fallback || {};
  }
}

async function readHermesEnvViaWsl(envPath) {
  try {
    const unc = parseWslUncPath(envPath);
    if (!unc?.linuxPath || !unc?.distro) return null;

    const envPathQuoted = quoteBash(unc.linuxPath);
    const command = `if [ -f ${envPathQuoted} ]; then cat ${envPathQuoted}; fi`;
    const { stdout } = await execFileAsync(
      'wsl.exe',
      ['-d', unc.distro, '-e', 'bash', '-lc', command],
      {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 512 * 1024,
      }
    );
    const raw = String(stdout || '').trim();
    if (!raw) return null;
    return parseDotEnv(raw);
  } catch {
    return null;
  }
}

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

async function hermesContextMiddleware(req, res, next) {
  try {
    const profileName = req.headers['x-hermes-profile'] || req.query?.profile || 'default';
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

// ── Health Check ────────────────────────────────────────────────────

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

// ── Route Registration ──────────────────────────────────────────────

registerApiAccessRoutes({
  app,
  express,
  apiAuthMiddleware,
  hermesContextMiddleware,
  sendDesktopHealth,
});

registerGatewayRoutes({
  app,
  axios,
  fs,
  gatewayManager,
  getProviderRequestConfig: getDesktopProviderRequestConfig,
  insertMessages,
  makeSessionId,
  nowTs,
  postGatewayChatCompletion: postDesktopGatewayChatCompletion,
  requestGatewayHealth,
  resolveGatewayProcessStatus,
  upsertSession,
  waitForGatewayHealth,
});

registerKanbanRoutes({ app });
registerIdentityRoutes({ app, fs, skillsService });
registerContextFileRoutes({
  app,
  fs,
  path,
  workspaceRoot: WORKSPACE_ROOT,
});
registerMediaRoutes({
  app,
  fs,
  path,
  runtimeFilesService,
  voiceScriptPath: VOICE_SCRIPT_PATH,
  extractAssistantText,
  getVoiceConfig,
  parseAudioDataUrl,
  postGatewayChatCompletion: postDesktopGatewayChatCompletion,
  sanitizeTextForSpeech,
  synthesizeSpeech,
  synthesizeSpeechSegments,
  transcribeAudioFile,
});
registerProfileRoutes({
  app,
  fs,
  path,
  yaml,
  gatewayManager,
  getHermesContext,
  hermesBase: HERMES_BASE,
  localHermesStateHome: LOCAL_HERMES_STATE_HOME,
  getHermesHome,
  resolveGatewayProcessStatus,
  resolveLocalAppStateDir,
  resolveProfilePaths,
  sanitizeProfileName,
  stateDbManager,
});

// ── Route Registration (remaining) ──────────────────────────────────

  registerAgentStudioRoutes({ app, agentStudioService, getHermesContext, postGatewayChatCompletion: postDesktopGatewayChatCompletion });
  registerConfigRoutes({ app, runtimeFilesService });
  registerContextReferenceRoutes({ app, contextReferenceService });
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
registerModelRoutes({ app, fetchProviderModels });
registerSkillRoutes({ app, skillsService });
registerHookRoutes({ app, skillsService });
registerPluginRoutes({ app, pluginsService });
registerPawrtalRoutes({ app, pawrtalService });
registerLive2dRoutes({ app, fs, expressStatic: express.static, hermesBase: HERMES_BASE });
registerCronJobRoutes({ app, cronJobsService });

// ── Frontend ────────────────────────────────────────────────────────

async function installFrontend() {
  if (BUILDER_UI_MODE === 'dev') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: BUILDER_ROOT,
      appType: 'custom',
      server: { middlewareMode: true },
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

    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      if (path.extname(req.path)) {
        return res.status(404).end();
      }
      res.sendFile('index.html', { root: BUILDER_DIST_DIR }, (error) => {
        if (!error) return;
        if (error.code === 'ENOENT') {
          res.status(503).type('text/plain').send(
            'Hermes Desktop frontend bundle is missing. Run "npm run build" in the repository root before opening the app.'
          );
          return;
        }
        next(error);
      });
    });
    return;
  }

  app.get('/', (_req, res) => {
    res.status(503).type('text/plain').send(
      'Hermes Desktop frontend bundle is missing. Run "npm run build" in the repository root before opening http://localhost:3020.'
    );
  });
}

// ── Server Lifecycle ────────────────────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────

// ── Direct Execution ────────────────────────────────────────────────

const isMainModule = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMainModule) {
  await startServer();
}
