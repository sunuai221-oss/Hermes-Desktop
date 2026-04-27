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

// ── Services (factories) ────────────────────────────────────────────
import { createAgentsService } from './services/agents.mjs';
import { createContextReferenceService } from './services/context-references.mjs';
import { createCronJobsService } from './services/cronjobs.mjs';
import {
  createProviderCatalogService,
  normalizeChatProvider,
} from './services/provider-catalog.mjs';
import { createPluginsService } from './services/plugins.mjs';
import {
  buildSpeechSynthesisPlan,
  concatenateWavBuffers,
  normalizeKokoroConfig,
  sanitizeTextForSpeech,
} from './services/kokoro-tts.mjs';
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
  sanitizeProfileName,
  getHermesHome,
  resolveHermesHome,
  resolveLocalHermesStateHome,
  resolveWorkspaceRoot,
  getHermesHomeScore,
  detectWslHermesHome,
  resolveLocalAppStateDir,
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
  transcodeAudioWithFfmpeg,
  extractAssistantText,
  ensureVoiceDir,
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

  return {
    ...baseContext,
    gatewayUrl: profileGateway.url,
    gatewayPort: profileGateway.port,
    gatewayHost: profileGateway.host,
    sharedGatewayUrl: sharedGateway.url,
    sharedGatewayPort: sharedGateway.port,
    sharedGatewayHost: sharedGateway.host,
    gatewayApiKey: process.env.API_SERVER_KEY || env.API_SERVER_KEY || '',
  };
}

async function readHermesEnv(hermes) {
  try {
    const data = await fs.readFile(hermes.paths.env, 'utf-8');
    return parseDotEnv(data);
  } catch {
    return {};
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

// ── Profile Management Routes ───────────────────────────────────────

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
    const profileHome = getHermesHome(HERMES_BASE, name);
    if (await exists(profileHome)) {
      return res.status(409).json({ error: 'Profile already exists' });
    }
    await fs.mkdir(profileHome, { recursive: true });

    const paths = resolveProfilePaths(name, profileHome, LOCAL_HERMES_STATE_HOME);
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
    const profileHome = getHermesHome(HERMES_BASE, name);
    const stateDbPath = resolveProfilePaths(name, profileHome, LOCAL_HERMES_STATE_HOME).stateDb;
    const appStateDir = resolveLocalAppStateDir(name, LOCAL_HERMES_STATE_HOME);
    stateDbManager.closeStateDb(stateDbPath);

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

// ── File Management Routes ──────────────────────────────────────────

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

// ── Voice Routes ────────────────────────────────────────────────────

app.post('/api/voice/respond', async (req, res) => {
  let inputPath = null;

  try {
    const dataUrl = String(req.body?.audioDataUrl || '');
    if (!dataUrl) {
      return res.status(400).json({ error: 'audioDataUrl is required' });
    }

    await ensureVoiceDir(req.hermes);
    const { buffer, extension } = parseAudioDataUrl(dataUrl);
    const voiceConfig = await getVoiceConfig(req.hermes, runtimeFilesService);
    const voiceId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    inputPath = path.join(req.hermes.paths.voice, `${voiceId}_input.${extension}`);
    await fs.writeFile(inputPath, buffer);

    const transcript = await transcribeAudioFile(req.hermes, inputPath, voiceConfig.sttModel);
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

    const voiceConfig = await getVoiceConfig(req.hermes, runtimeFilesService);
    const synthesized = await synthesizeSpeech(req.hermes, text, voiceConfig);
    res.json(synthesized);
  } catch (error) {
    res.status(500).json({ error: 'Could not synthesize voice reply', details: error.message });
  }
});

// ── Context Files Routes ────────────────────────────────────────────

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
      content: truncated
        ? `${content.slice(0, 5600)}\n\n[...preview truncated...]\n\n${content.slice(-1600)}`
        : content,
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
    const candidate = await scanContextFile(
      path.join(WORKSPACE_ROOT, name),
      'startup',
      { priority: i + 1 }
    );
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

// ── Memory Routes ───────────────────────────────────────────────────

async function getMemoryStores(hermes) {
  const config = await skillsService.readConfigForSkills(hermes);
  await ensureMemoriesDir(hermes);

  const [memoryContent, userContent] = await Promise.all([
    fs.readFile(hermes.paths.memory, 'utf-8').catch(() => ''),
    fs.readFile(hermes.paths.userMemory, 'utf-8').catch(() => ''),
  ]);

  const memoryLimit = config?.memory?.memory_char_limit ?? 2200;
  const userLimit = config?.memory?.user_char_limit ?? 1375;

  return [
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
    await fs.writeFile(
      target === 'user' ? req.hermes.paths.userMemory : req.hermes.paths.memory,
      content,
      'utf-8'
    );
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

// ── Route Registration (remaining) ──────────────────────────────────

registerAgentRoutes({ app, agentsService });
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

async function ensureMemoriesDir(hermes) {
  await fs.mkdir(hermes.paths.memories, { recursive: true });
}

async function ensureImagesDir(hermes) {
  await fs.mkdir(hermes.paths.images, { recursive: true });
}

// ── Direct Execution ────────────────────────────────────────────────

const isMainModule = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (isMainModule) {
  await startServer();
}
