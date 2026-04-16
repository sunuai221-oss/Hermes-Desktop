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
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const app = express();
const port = Number(process.env.HERMES_DESKTOP_BACKEND_PORT || process.env.HERMES_BUILDER_PORT || process.env.PORT || 3020);
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
const LMSTUDIO_BASE_URL = (process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const VOICE_SCRIPT_PATH = path.join(SERVER_DIR, 'voice_tools.py');
const API_AUTH_LOGIN = process.env.HERMES_API_LOGIN || '';
const API_AUTH_PASSWORD = process.env.HERMES_API_PASSWORD || '';
const execFileAsync = promisify(execFile);
const MAX_REFERENCE_CHARS = 12000;
const MAX_FOLDER_ENTRIES = 200;
const TEXT_EXTENSIONS = new Set(['.py', '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.sh', '.ps1', '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp']);

// Cache for per-profile database connections
const profileDbs = new Map();

app.use(cors());
app.use(bodyParser.json({ limit: '35mb' }));

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

function getStateDb(dbPath) {
  if (profileDbs.has(dbPath)) return profileDbs.get(dbPath);

  fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=5000;');
  try {
    db.exec('PRAGMA journal_mode=WAL;');
  } catch (err) {
    console.warn(`[getStateDb] Could not set WAL mode on ${dbPath} (likely already set and locked):`, err.message);
  }
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'api-server',
      user_id TEXT,
      title TEXT,
      model TEXT,
      system_prompt TEXT,
      parent_session_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_title_unique
      ON sessions(title) WHERE title IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_source_started
      ON sessions(source, started_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_name TEXT,
      tool_results TEXT,
      token_count INTEGER,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session_ts
      ON messages(session_id, timestamp);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
      USING fts5(content, content='messages', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, COALESCE(new.content, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, COALESCE(old.content, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, COALESCE(old.content, ''));
      INSERT INTO messages_fts(rowid, content) VALUES (new.id, COALESCE(new.content, ''));
    END;
  `);
  profileDbs.set(dbPath, db);
  return db;
}

function nowTs() {
  return Date.now();
}

function makeSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const hex = Math.random().toString(16).slice(2, 10).padEnd(8, '0').slice(0, 8);
  return `${timestamp}_${hex}`;
}

function inferSessionMeta(sessionId) {
  const parts = String(sessionId || '').split(':');
  const source = parts[2] || 'api-server';
  const userId = parts[parts.length - 1] || null;
  return { source, userId };
}

function upsertSession(hermes, sessionId, partial = {}) {
  const db = hermes.db;
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
  const timestamp = nowTs();
  const inferred = inferSessionMeta(sessionId);
  if (!existing) {
    db.prepare(`
      INSERT INTO sessions (
        id, source, user_id, title, model, system_prompt, parent_session_id,
        started_at, ended_at, input_tokens, output_tokens, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?)
    `).run(
      sessionId,
      partial.source || inferred.source || 'api-server',
      partial.userId ?? inferred.userId ?? null,
      partial.title ?? null,
      partial.model ?? null,
      partial.systemPrompt ?? null,
      partial.parentSessionId ?? null,
      partial.startedAt || timestamp,
      timestamp
    );
    return;
  }

  db.prepare(`
    UPDATE sessions
    SET
      source = COALESCE(?, source),
      user_id = COALESCE(?, user_id),
      title = COALESCE(?, title),
      model = COALESCE(?, model),
      system_prompt = COALESCE(?, system_prompt),
      parent_session_id = COALESCE(?, parent_session_id),
      ended_at = COALESCE(?, ended_at),
      input_tokens = input_tokens + ?,
      output_tokens = output_tokens + ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    partial.source || null,
    partial.userId ?? null,
    partial.title ?? null,
    partial.model ?? null,
    partial.systemPrompt ?? null,
    partial.parentSessionId ?? null,
    partial.endedAt ?? null,
    Number(partial.inputTokens || 0),
    Number(partial.outputTokens || 0),
    timestamp,
    sessionId
  );
}

function insertMessages(hermes, sessionId, messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  const db = hermes.db;
  const stmt = db.prepare(`
    INSERT INTO messages (session_id, role, content, tool_calls, tool_name, tool_results, token_count, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  for (const message of messages) {
    const role = message?.role || 'assistant';
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
    const toolCalls = message?.tool_calls ? JSON.stringify(message.tool_calls) : null;
    const toolResults = message?.tool_results ? JSON.stringify(message.tool_results) : null;
    const toolName = message?.tool_name || null;
    const tokenCount = Number(message?.token_count || 0) || null;
    const timestamp = Number(message?.timestamp || nowTs()) || nowTs();
    stmt.run(sessionId, role, content, toolCalls, toolName, toolResults, tokenCount, timestamp);
    inserted += 1;
  }
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(nowTs(), sessionId);
  return inserted;
}

function sanitizeSessionTitle(rawTitle) {
  if (rawTitle == null) return null;
  const normalized = String(rawTitle)
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, 100);
}

function parseToolNames(toolCallsRaw, toolNameRaw) {
  const names = new Set();
  if (toolNameRaw) names.add(String(toolNameRaw));
  if (toolCallsRaw) {
    try {
      const parsed = typeof toolCallsRaw === 'string' ? JSON.parse(toolCallsRaw) : toolCallsRaw;
      if (Array.isArray(parsed)) {
        for (const call of parsed) {
          const name = call?.function?.name || call?.name;
          if (name) names.add(String(name));
        }
      }
    } catch {
      // ignore invalid tool call payloads in recap
    }
  }
  return Array.from(names);
}

function truncateUserContent(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 300) return text;
  return `${text.slice(0, 300)}...`;
}

function truncateAssistantContent(content) {
  const lines = String(content || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstLines = lines.slice(0, 3).join('\n');
  if (firstLines.length > 200) return `${firstLines.slice(0, 200)}...`;
  if (lines.length > 3) return `${firstLines}...`;
  return firstLines || '';
}

function getSessionById(hermes, sessionId) {
  const db = hermes.db;
  return db.prepare(`
    SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
    FROM sessions
    WHERE id = ?
  `).get(sessionId);
}

function getLatestSessionByTitleVariant(hermes, baseTitle) {
  const db = hermes.db;
  return db.prepare(`
    SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
    FROM sessions
    WHERE title = ?
       OR title GLOB (? || ' #[0-9]*')
    ORDER BY COALESCE(updated_at, started_at) DESC
    LIMIT 1
  `).get(baseTitle, baseTitle);
}

function nextLineageTitle(hermes, baseTitle) {
  const db = hermes.db;
  const rows = db.prepare(`
    SELECT title
    FROM sessions
    WHERE title = ?
       OR title GLOB (? || ' #[0-9]*')
  `).all(baseTitle, baseTitle);
  let max = 1;
  for (const row of rows) {
    if (row.title === baseTitle) {
      max = Math.max(max, 1);
      continue;
    }
    const match = String(row.title || '').match(new RegExp(`^${baseTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #(\\d+)$`));
    if (!match) continue;
    max = Math.max(max, Number(match[1]) || 1);
  }
  return `${baseTitle} #${max + 1}`;
}

function createContinuationSession(hermes, parentId, options = {}) {
  const parent = getSessionById(hermes, parentId);
  if (!parent) {
    const error = new Error('Parent session not found');
    error.statusCode = 404;
    throw error;
  }

  const id = makeSessionId();
  const titleInput = sanitizeSessionTitle(options.title);
  const inheritedTitle = parent.title ? nextLineageTitle(hermes, parent.title) : null;
  const title = titleInput || inheritedTitle;
  upsertSession(hermes, id, {
    source: options.source || parent.source || 'api-server',
    userId: options.userId ?? parent.user_id ?? null,
    title,
    model: options.model || parent.model || null,
    parentSessionId: parent.id,
  });
  return getSessionById(hermes, id);
}

function buildResumeRecap(hermes, sessionId) {
  const db = hermes.db;
  const rows = db.prepare(`
    SELECT role, content, tool_calls, tool_name, timestamp
    FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC, id ASC
  `).all(sessionId);

  const relevant = rows.filter(row => row.role === 'user' || row.role === 'assistant');
  const exchanges = [];
  let current = null;
  for (const row of relevant) {
    if (row.role === 'user') {
      if (current && (current.user || current.assistant)) exchanges.push(current);
      current = {
        user: truncateUserContent(row.content),
        assistant: '',
        tool_calls: [],
        timestamp: row.timestamp || null,
      };
      continue;
    }

    if (!current) {
      current = { user: '', assistant: '', tool_calls: [], timestamp: row.timestamp || null };
    }

    const toolNames = parseToolNames(row.tool_calls, row.tool_name);
    if (toolNames.length > 0) {
      current.tool_calls = Array.from(new Set([...(current.tool_calls || []), ...toolNames]));
    }
    const assistantText = truncateAssistantContent(row.content);
    if (assistantText) {
      current.assistant = current.assistant ? `${current.assistant}\n${assistantText}` : assistantText;
    } else if (toolNames.length > 0) {
      current.assistant = `[${toolNames.length} tool calls: ${toolNames.join(', ')}]`;
    }
  }
  if (current && (current.user || current.assistant)) exchanges.push(current);

  const tail = exchanges.slice(-10);
  return {
    mode: 'full',
    hidden_exchanges_count: Math.max(0, exchanges.length - tail.length),
    exchanges: tail.map(item => ({
      user: item.user,
      assistant: item.assistant,
      tool_calls: item.tool_calls,
      timestamp: item.timestamp,
    })),
  };
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

function normalizeChatProvider(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return 'profile-default';
  if (value === 'codex-openai' || value === 'openai-codex' || value === 'codex' || value === 'openai') return 'codex-openai';
  if (value === 'ollama') return 'ollama';
  if (value === 'lmstudio' || value === 'lm-studio' || value === 'lm_studio') return 'lmstudio';
  if (value === 'nous' || value === 'nous-research' || value === 'nousresearch') return 'nous';
  return 'profile-default';
}

function stripProviderHints(body = {}) {
  const next = { ...body };
  delete next.provider;
  delete next.provider_label;
  return next;
}

function getProviderRequestConfig(hermes, body = {}) {
  const provider = normalizeChatProvider(body.provider);
  const payload = {
    ...body,
    provider,
  };
  return {
    provider,
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
  const db = getStateDb(paths.stateDb);

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
    const db = profileDbs.get(stateDbPath);

    if (db?.close) {
      db.close();
    }
    profileDbs.delete(stateDbPath);

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

app.get('/api/desktop/health', sendDesktopHealth);
app.get('/api/builder/health', sendDesktopHealth);

app.use('/api/voice/audio', apiAuthMiddleware, hermesContextMiddleware, (req, res, next) => {
  express.static(req.hermes.paths.voice)(req, res, next);
});

function isLocalRequest(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const candidate = forwarded || req.ip || req.socket?.remoteAddress || '';
  const normalized = String(candidate).replace('::ffff:', '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function parseBasicAuthHeader(headerValue) {
  const header = String(headerValue || '');
  if (!header.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;
    return {
      login: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function apiAuthMiddleware(req, res, next) {
  if (isLocalRequest(req)) return next();

  if (!API_AUTH_LOGIN || !API_AUTH_PASSWORD) {
    return res.status(503).json({
      error: 'Remote API auth is not configured. Set HERMES_API_LOGIN and HERMES_API_PASSWORD.',
    });
  }

  const creds = parseBasicAuthHeader(req.headers.authorization);
  if (!creds || creds.login !== API_AUTH_LOGIN || creds.password !== API_AUTH_PASSWORD) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Hermes Gateway API"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
}

app.use('/api', apiAuthMiddleware);
app.use('/api', hermesContextMiddleware);

// ── Gateway Proxy ──────────────────────────────────────────────────

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
    const assistantContent = data?.choices?.[0]?.message?.content;
    if (assistantContent) {
      insertMessages(req.hermes, sessionId, [{
        role: 'assistant',
        content: assistantContent,
        timestamp: nowTs(),
      }]);
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

  try {
    const target = getProviderRequestConfig(req.hermes, req.body);
    const response = await axios.post(
      target.endpoint,
      { ...target.payload, stream: true },
      {
        responseType: 'stream',
        headers: target.headers,
      }
    );
    response.data.on('data', chunk => res.write(chunk));
    response.data.on('end', () => res.end());
    response.data.on('error', err => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

app.get('/api/gateway/health', async (req, res) => {
  const health = await requestGatewayHealth(req.hermes);
  if (health.ok) {
    return res.json(health.data);
  }
  res.status(503).json({ status: 'offline' });
});

app.get('/api/gateway/state', async (req, res) => {
  try {
    const data = await fs.readFile(req.hermes.paths.gatewayState, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Could not read gateway_state.json', details: error.message });
  }
});

app.get('/api/gateway/process-status', async (req, res) => {
  try {
    const status = await resolveGatewayProcessStatus(req.hermes);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get gateway status', details: error.message });
  }
});

app.post('/api/gateway/start', async (req, res) => {
  try {
    const profile = req.hermes.profile;
    const existingStatus = await resolveGatewayProcessStatus(req.hermes);
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
        status: await resolveGatewayProcessStatus(startedContext),
      });
    }

    res.json(await resolveGatewayProcessStatus(startedContext));
  } catch (error) {
    res.status(500).json({ error: 'Failed to start gateway', details: error.message });
  }
});

app.post('/api/gateway/stop', async (req, res) => {
  try {
    const result = await gatewayManager.stop(req.hermes.profile, req.hermes.home);
    res.json({ ...result, status: await resolveGatewayProcessStatus(req.hermes) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop gateway', details: error.message });
  }
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

async function ensureCronDir(hermes) {
  await fs.mkdir(hermes.paths.cronOutput, { recursive: true });
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
  const config = await readYamlConfig(hermes).catch(() => ({}));
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
  await ensureAppStateDir(hermes);
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
  const config = await readConfigForSkills(hermes);
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

function stripTrailingPunctuation(value) {
  return String(value || '').replace(/[.,;!?]+$/, '');
}

function isInsideWorkspace(resolvedPath) {
  const rel = path.relative(WORKSPACE_ROOT, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isSensitivePath(hermes, resolvedPath) {
  const blockedExact = new Set([
    path.resolve(hermes.home, '.env'),
  ]);
  const blockedParts = ['.ssh', '.aws', '.gnupg', '.kube', path.join('skills', '.hub')];

  if (blockedExact.has(resolvedPath)) return true;
  const lower = resolvedPath.toLowerCase();
  return blockedParts.some(part => lower.includes(part.toLowerCase()));
}

function parseFileReference(input) {
  const trimmed = stripTrailingPunctuation(input);
  const match = trimmed.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return { filePath: trimmed, start: null, end: null };
  const filePath = match[1];
  const start = match[2] ? parseInt(match[2], 10) : null;
  const end = match[3] ? parseInt(match[3], 10) : start;
  return { filePath, start, end };
}

async function ensureTextFile(resolvedPath) {
  const buffer = await fs.readFile(resolvedPath);
  if (buffer.includes(0) && !TEXT_EXTENSIONS.has(path.extname(resolvedPath).toLowerCase())) {
    throw new Error('binary files are not supported');
  }
  return buffer.toString('utf-8');
}

function clampContent(content) {
  if (content.length <= MAX_REFERENCE_CHARS) return { content, warning: undefined };
  const head = Math.floor(MAX_REFERENCE_CHARS * 0.7);
  const tail = Math.floor(MAX_REFERENCE_CHARS * 0.2);
  return {
    content: `${content.slice(0, head)}\n\n[...reference preview truncated...]\n\n${content.slice(-tail)}`,
    warning: `reference truncated at ${MAX_REFERENCE_CHARS} chars`,
  };
}

async function resolveFileReference(hermes, rawValue) {
  const { filePath, start, end } = parseFileReference(rawValue);
  const resolvedPath = path.resolve(WORKSPACE_ROOT, filePath);
  if (!isInsideWorkspace(resolvedPath)) throw new Error('path is outside the allowed workspace');
  if (isSensitivePath(hermes, resolvedPath)) throw new Error('path is a sensitive credential file');
  const content = await ensureTextFile(resolvedPath);
  const ranged = start && end
    ? content.split(/\r?\n/).slice(start - 1, end).join('\n')
    : content;
  const preview = clampContent(ranged);
  return {
    ref: `@file:${rawValue}`,
    kind: 'file',
    label: path.relative(WORKSPACE_ROOT, resolvedPath) || path.basename(resolvedPath),
    content: preview.content,
    warning: preview.warning,
    charCount: ranged.length,
  };
}

async function resolveFolderReference(hermes, rawValue) {
  const resolvedPath = path.resolve(WORKSPACE_ROOT, stripTrailingPunctuation(rawValue));
  if (!isInsideWorkspace(resolvedPath)) throw new Error('path is outside the allowed workspace');
  if (isSensitivePath(hermes, resolvedPath)) throw new Error('path is a sensitive credential file');
  const stat = await fs.stat(resolvedPath).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new Error('folder not found');

  const lines = [];
  let count = 0;
  async function walk(dir, depth = 0) {
    if (count >= MAX_FOLDER_ENTRIES || depth > 4) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (count >= MAX_FOLDER_ENTRIES) break;
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(resolvedPath, fullPath) || entry.name;
      const info = await fs.stat(fullPath).catch(() => null);
      lines.push(`${'  '.repeat(depth)}- ${rel}${entry.isDirectory() ? '/' : ''}${info ? ` (${info.size} bytes)` : ''}`);
      count += 1;
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
    }
  }
  await walk(resolvedPath);
  if (count >= MAX_FOLDER_ENTRIES) lines.push('- ...');
  const content = lines.join('\n');
  return {
    ref: `@folder:${rawValue}`,
    kind: 'folder',
    label: path.relative(WORKSPACE_ROOT, resolvedPath) || path.basename(resolvedPath),
    content,
    charCount: content.length,
  };
}

async function resolveGitReference(kind, rawValue = '') {
  if (kind === 'diff') {
    const { stdout, stderr } = await execFileAsync('git', ['diff'], { cwd: WORKSPACE_ROOT });
    if (stderr && !stdout) throw new Error(stderr.trim());
    return { ref: '@diff', kind: 'diff', label: 'git diff', content: stdout || 'No unstaged changes.', charCount: (stdout || '').length };
  }
  if (kind === 'staged') {
    const { stdout, stderr } = await execFileAsync('git', ['diff', '--staged'], { cwd: WORKSPACE_ROOT });
    if (stderr && !stdout) throw new Error(stderr.trim());
    return { ref: '@staged', kind: 'staged', label: 'git diff --staged', content: stdout || 'No staged changes.', charCount: (stdout || '').length };
  }
  const count = Math.min(10, Math.max(1, parseInt(rawValue, 10) || 1));
  const { stdout, stderr } = await execFileAsync('git', ['log', `-${count}`, '--patch', '--stat'], { cwd: WORKSPACE_ROOT });
  if (stderr && !stdout) throw new Error(stderr.trim());
  const preview = clampContent(stdout || '');
  return {
    ref: `@git:${count}`,
    kind: 'git',
    label: `last ${count} commits`,
    content: preview.content || 'No git history available.',
    warning: preview.warning,
    charCount: (stdout || '').length,
  };
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveUrlReference(rawValue) {
  const url = stripTrailingPunctuation(rawValue);
  const parsedUrl = new URL(url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('only http and https URLs are allowed');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }

  await assertSafeRemoteHost(parsedUrl.hostname);

  const response = await axios.get(parsedUrl.toString(), {
    timeout: 10000,
    responseType: 'text',
    maxRedirects: 0,
  });
  const text = htmlToText(String(response.data || ''));
  if (!text) throw new Error('no content extracted');
  const preview = clampContent(text);
  return {
    ref: `@url:${url}`,
    kind: 'url',
    label: url,
    content: preview.content,
    warning: preview.warning,
    charCount: text.length,
  };
}

async function assertSafeRemoteHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) throw new Error('hostname is required');
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    throw new Error('local network hosts are not allowed');
  }

  const addresses = net.isIP(normalized)
    ? [{ address: normalized }]
    : await dns.lookup(normalized, { all: true, verbatim: true }).catch(() => {
        throw new Error('could not resolve remote host');
      });

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('could not resolve remote host');
  }

  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new Error('private or loopback network hosts are not allowed');
    }
  }
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(part => parseInt(part, 10));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80')
      || normalized.startsWith('ff');
  }

  return true;
}

async function resolveContextReference(hermes, ref) {
  const value = String(ref || '').trim();
  if (value === '@diff') return resolveGitReference('diff');
  if (value === '@staged') return resolveGitReference('staged');
  if (value.startsWith('@git:')) return resolveGitReference('git', value.slice(5));
  if (value.startsWith('@file:')) return resolveFileReference(hermes, value.slice(6));
  if (value.startsWith('@folder:')) return resolveFolderReference(hermes, value.slice(8));
  if (value.startsWith('@url:')) return resolveUrlReference(value.slice(5));
  throw new Error('unsupported reference');
}

app.post('/api/context-references/resolve', async (req, res) => {
  try {
    const refs = Array.isArray(req.body?.refs) ? req.body.refs : [];
    const resolved = [];
    for (const ref of refs) {
      try {
        resolved.push(await resolveContextReference(req.hermes, ref));
      } catch (error) {
        const value = String(ref || '');
        let kind = 'file';
        if (value === '@diff') kind = 'diff';
        else if (value === '@staged') kind = 'staged';
        else if (value.startsWith('@git:')) kind = 'git';
        else if (value.startsWith('@folder:')) kind = 'folder';
        else if (value.startsWith('@url:')) kind = 'url';
        resolved.push({
          ref: value,
          kind,
          label: value,
          content: '',
          warning: error.message,
          charCount: 0,
        });
      }
    }
    res.json(resolved);
  } catch (error) {
    res.status(500).json({ error: 'Could not resolve context references', details: error.message });
  }
});

async function ensureAppStateDir(hermes) {
  await fs.mkdir(hermes.paths.appState, { recursive: true });
}

async function readYamlConfig(hermes) {
  const data = await fs.readFile(hermes.paths.config, 'utf-8');
  return yaml.parse(data) || {};
}

async function writeYamlConfig(hermes, config) {
  await fs.writeFile(hermes.paths.config, yaml.stringify(config), 'utf-8');
}

async function writeJsonAtomic(targetPath, data) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmpPath, targetPath);
}

async function readCronJobsFile(hermes) {
  await ensureCronDir(hermes);
  try {
    const raw = await fs.readFile(hermes.paths.cronJobs, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { jobs: parsed, wrapper: 'array' };
    if (Array.isArray(parsed?.jobs)) return { jobs: parsed.jobs, wrapper: 'object' };
    return { jobs: [], wrapper: 'array' };
  } catch {
    return { jobs: [], wrapper: 'array' };
  }
}

async function writeCronJobsFile(hermes, jobs, wrapper = 'array') {
  await ensureCronDir(hermes);
  const payload = wrapper === 'object' ? { jobs } : jobs;
  await writeJsonAtomic(hermes.paths.cronJobs, payload);
}

function addMs(date, count, unit) {
  const mult = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return new Date(date.getTime() + count * mult);
}

function computeNextRunAt(schedule, paused = false) {
  if (paused) return null;
  const now = new Date();
  const trimmed = String(schedule || '').trim();
  const delayMatch = trimmed.match(/^(\d+)(m|h|d)$/i);
  if (delayMatch) {
    return addMs(now, parseInt(delayMatch[1], 10), delayMatch[2].toLowerCase()).toISOString();
  }
  const everyMatch = trimmed.match(/^every\s+(\d+)(m|h|d)$/i);
  if (everyMatch) {
    return addMs(now, parseInt(everyMatch[1], 10), everyMatch[2].toLowerCase()).toISOString();
  }
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  return null;
}

function isValidSchedule(schedule) {
  return computeNextRunAt(schedule, false) !== null;
}

function normalizeCronJob(input, existing = null) {
  const now = new Date().toISOString();
  const job = {
    id: existing?.id || `cron_${Date.now()}`,
    name: input.name || existing?.name || '',
    prompt: input.prompt ?? existing?.prompt ?? '',
    schedule: input.schedule ?? existing?.schedule ?? '',
    repeat: input.repeat ?? existing?.repeat ?? null,
    delivery: input.delivery ?? existing?.delivery ?? 'local',
    skills: Array.isArray(input.skills) ? input.skills : (existing?.skills || []),
    paused: typeof input.paused === 'boolean' ? input.paused : (existing?.paused || false),
    next_run_at: input.next_run_at ?? existing?.next_run_at ?? null,
    last_run_at: existing?.last_run_at || null,
    created_at: existing?.created_at || now,
    updated_at: now,
    force_run: existing?.force_run || false,
  };
  if (!job.next_run_at || input.schedule !== undefined || input.paused !== undefined) {
    job.next_run_at = computeNextRunAt(job.schedule, job.paused);
  }
  return job;
}

async function listCronOutputs(hermes, jobId = null) {
  await ensureCronDir(hermes);
  const outputs = [];
  const jobDirs = await fs.readdir(hermes.paths.cronOutput, { withFileTypes: true }).catch(() => []);
  for (const dir of jobDirs) {
    if (!dir.isDirectory()) continue;
    if (jobId && dir.name !== jobId) continue;
    const fullDir = path.join(hermes.paths.cronOutput, dir.name);
    const files = await fs.readdir(fullDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile()) continue;
      const fullPath = path.join(fullDir, file.name);
      const stat = await fs.stat(fullPath).catch(() => null);
      const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
      outputs.push({
        jobId: dir.name,
        path: fullPath,
        fileName: file.name,
        modifiedAt: stat?.mtime?.toISOString?.() || new Date().toISOString(),
        contentPreview: content.slice(0, 2000),
      });
    }
  }
  return outputs.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

async function readAgentProfiles(hermes) {
  try {
    const data = await fs.readFile(hermes.paths.agents, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed?.profiles) ? parsed.profiles : [];
  } catch {
    return [];
  }
}

async function writeAgentProfiles(hermes, profiles) {
  await ensureAppStateDir(hermes);
  await fs.writeFile(hermes.paths.agents, JSON.stringify({ profiles }, null, 2), 'utf-8');
}

app.get('/api/agents', async (req, res) => {
  try {
    res.json(await readAgentProfiles(req.hermes));
  } catch (error) {
    res.status(500).json({ error: 'Could not read agent profiles', details: error.message });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const profiles = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
    await writeAgentProfiles(req.hermes, profiles);
    res.json({ success: true, count: profiles.length });
  } catch (error) {
    res.status(500).json({ error: 'Could not write agent profiles', details: error.message });
  }
});

app.post('/api/agents/:id/apply', async (req, res) => {
  try {
    const profiles = await readAgentProfiles(req.hermes);
    const profile = profiles.find(item => item.id === req.params.id);

    if (!profile) {
      return res.status(404).json({ error: 'Agent profile not found' });
    }

    await fs.writeFile(req.hermes.paths.soul, profile.soul || '', 'utf-8');

    const config = await readYamlConfig(req.hermes);
    if (!config.agent) config.agent = {};
    if (!config.agent.personalities) config.agent.personalities = {};
    config.agent.personalities[profile.name] = profile.personalityOverlay || '';

    if (profile.defaultModel) {
      if (!config.model) config.model = {};
      config.model.default = profile.defaultModel;
    }

    await writeYamlConfig(req.hermes, config);

    const now = new Date().toISOString();
    const nextProfiles = profiles.map(item =>
      item.id === profile.id
        ? { ...item, lastAppliedAt: now, updatedAt: now }
        : item
    );
    await writeAgentProfiles(req.hermes, nextProfiles);

    res.json({
      success: true,
      applied: {
        id: profile.id,
        name: profile.name,
        wroteSoul: true,
        updatedConfig: true,
        limitations: [
          'SOUL.md is singleton per HERMES_HOME',
          'Preferred skills and tool policy are advisory in the app',
          'Actual tool access remains platform-scoped in Hermes',
        ],
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not apply agent profile', details: error.message });
  }
});

app.get('/api/config', async (req, res) => {
  try {
    const data = await fs.readFile(req.hermes.paths.config, 'utf-8');
    res.json(yaml.parse(data));
  } catch {
    res.status(500).json({ error: 'Could not read config.yaml' });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    await fs.writeFile(req.hermes.paths.config, yaml.stringify(req.body), 'utf-8');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Could not write config.yaml' });
  }
});

// ── Sessions ───────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const db = req.hermes.db;
    const rows = db.prepare(`
      SELECT id, source, user_id, title, model, started_at, updated_at
      FROM sessions
      ORDER BY COALESCE(updated_at, started_at) DESC
      LIMIT 300
    `).all();
    const sessions = {};
    for (const row of rows) {
      sessions[row.id] = {
        id: row.id,
        source: row.source,
        user_id: row.user_id,
        title: row.title || row.id,
        model: row.model || 'default',
        created_at: row.started_at || nowTs(),
        last_accessed: row.updated_at || row.started_at || nowTs(),
      };
    }
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Could not list sessions', details: error.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const parentSessionId = String(req.body?.parent_session_id || req.body?.continue_from || '').trim() || null;
    if (parentSessionId) {
      const created = createContinuationSession(req.hermes, parentSessionId, {
        source: req.body?.source ? String(req.body.source) : undefined,
        userId: req.body?.user_id ? String(req.body.user_id) : undefined,
        model: req.body?.model ? String(req.body.model) : undefined,
        title: req.body?.title ? String(req.body.title) : undefined,
      });
      return res.json({
        id: created.id,
        title: created.title || created.id,
        source: created.source || 'api-server',
        user_id: created.user_id || null,
        model: created.model || 'default',
        parent_session_id: created.parent_session_id || null,
        created_at: created.started_at || nowTs(),
        last_accessed: created.updated_at || created.started_at || nowTs(),
      });
    }

    const id = String(req.body?.id || '').trim() || makeSessionId();
    const source = String(req.body?.source || 'api-server');
    const userId = req.body?.user_id ? String(req.body.user_id) : null;
    const title = sanitizeSessionTitle(req.body?.title);
    const model = req.body?.model ? String(req.body.model) : null;
    upsertSession(req.hermes, id, { source, userId, title, model, parentSessionId: null });
    const newSession = {
      id,
      title: title || id,
      source,
      user_id: userId,
      model: model || 'default',
      created_at: nowTs(),
      last_accessed: nowTs(),
    };
    res.json(newSession);
  } catch (error) {
// ...
    if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
      return res.status(409).json({ error: 'Session title already in use' });
    }
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'Could not create session', details: error.message });
  }
});

app.post('/api/sessions/:id/rename', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const title = sanitizeSessionTitle(req.body?.title);
    const db = req.hermes.db;
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, nowTs(), id);
    res.json({ success: true, id, title });
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
      return res.status(409).json({ error: 'Session title already in use' });
    }
    res.status(500).json({ error: 'Could not rename session', details: error.message });
  }
});

app.get('/api/sessions/:id/title', async (req, res) => {
  try {
    const session = getSessionById(req.hermes, String(req.params.id || '').trim());
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ id: session.id, title: session.title || null });
  } catch (error) {
    res.status(500).json({ error: 'Could not read session title', details: error.message });
  }
});

app.post('/api/sessions/:id/title', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const title = sanitizeSessionTitle(req.body?.title);
    const db = req.hermes.db;
    const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Session not found' });
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, nowTs(), id);
    res.json({ success: true, id, title });
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
      return res.status(409).json({ error: 'Session title already in use' });
    }
    res.status(500).json({ error: 'Could not set session title', details: error.message });
  }
});

app.post('/api/sessions/:id/continue', async (req, res) => {
  try {
    const parentId = String(req.params.id || '').trim();
    const created = createContinuationSession(req.hermes, parentId, {
      source: req.body?.source ? String(req.body.source) : undefined,
      userId: req.body?.user_id ? String(req.body.user_id) : undefined,
      model: req.body?.model ? String(req.body.model) : undefined,
      title: req.body?.title ? String(req.body.title) : undefined,
    });
    res.json({
      id: created.id,
      title: created.title || created.id,
      source: created.source || 'api-server',
      user_id: created.user_id || null,
      model: created.model || 'default',
      parent_session_id: created.parent_session_id || parentId,
      created_at: created.started_at || nowTs(),
      last_accessed: created.updated_at || created.started_at || nowTs(),
    });
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || ''))) {
      return res.status(409).json({ error: 'Session title already in use' });
    }
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'Could not continue session', details: error.message });
  }
});

app.post('/api/sessions/resume', async (req, res) => {
  try {
    const mode = String(req.body?.mode || 'continue').toLowerCase();
    const value = String(req.body?.value || '').trim();
    const preferredSource = req.body?.source ? String(req.body.source).trim() : '';
    const db = req.hermes.db;
    let session = null;

    if (mode === 'continue') {
      if (preferredSource) {
        session = db.prepare(`
          SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
          FROM sessions
          WHERE source = ?
          ORDER BY COALESCE(updated_at, started_at) DESC
          LIMIT 1
        `).get(preferredSource);
      } else {
        session = db.prepare(`
          SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
          FROM sessions
          WHERE source IN ('cli', 'api-server')
          ORDER BY COALESCE(updated_at, started_at) DESC
          LIMIT 1
        `).get();
      }
    } else if (mode === 'resume') {
      if (!value) return res.status(400).json({ error: 'Missing resume value (session id or title)' });
      session = getSessionById(req.hermes, value);
      if (!session) {
        session = db.prepare(`
          SELECT id, source, user_id, title, model, parent_session_id, started_at, ended_at, updated_at
          FROM sessions
          WHERE title = ?
          ORDER BY COALESCE(updated_at, started_at) DESC
          LIMIT 1
        `).get(value);
      }
      if (!session) {
        session = getLatestSessionByTitleVariant(req.hermes, value);
      }
    } else {
      return res.status(400).json({ error: 'Invalid resume mode. Use continue or resume' });
    }

    if (!session) {
      return res.status(404).json({ error: 'No matching session found' });
    }

    upsertSession(req.hermes, session.id, {});
    const refreshed = getSessionById(req.hermes, session.id) || session;
    const recap = buildResumeRecap(req.hermes, session.id);
    res.json({
      session: {
        id: refreshed.id,
        source: refreshed.source || 'api-server',
        user_id: refreshed.user_id || null,
        title: refreshed.title || refreshed.id,
        model: refreshed.model || 'default',
        parent_session_id: refreshed.parent_session_id || null,
        created_at: refreshed.started_at || nowTs(),
        last_accessed: refreshed.updated_at || refreshed.started_at || nowTs(),
      },
      recap,
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not resume session', details: error.message });
  }
});

app.post('/api/sessions/:id/messages', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Missing session id' });
    const model = req.body?.model ? String(req.body.model) : null;
    const source = req.body?.source ? String(req.body.source) : 'api-server';
    const userId = req.body?.user_id ? String(req.body.user_id) : null;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    upsertSession(req.hermes, id, { model, source, userId });
    const inserted = insertMessages(req.hermes, id, messages);
    res.json({ success: true, inserted, session_id: id });
  } catch (error) {
    res.status(500).json({ error: 'Could not append session messages', details: error.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const db = req.hermes.db;
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    const jsonPath = path.join(req.hermes.paths.sessionsDir, `session_${id}.json`);
    const jsonlPath = path.join(req.hermes.paths.sessionsDir, `${id}.jsonl`);
    
    try { await fs.unlink(jsonPath); } catch {}
    try { await fs.unlink(jsonlPath); } catch {}
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete session', details: error.message });
  }
});

app.get('/api/sessions/:id/transcript', async (req, res) => {
  try {
    const db = req.hermes.db;
    const rows = db.prepare(`
      SELECT role, content, tool_calls, tool_name, tool_results, token_count, timestamp
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp ASC, id ASC
    `).all(req.params.id);
    if (rows.length > 0) {
      return res.json(rows.map(row => ({
        role: row.role,
        content: row.content,
        tool_calls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
        tool_name: row.tool_name || undefined,
        tool_results: row.tool_results ? JSON.parse(row.tool_results) : undefined,
        token_count: row.token_count || undefined,
        timestamp: row.timestamp || undefined,
      })));
    }

    // Try .jsonl first (legacy/streaming), then .json (new format)
    const jsonlPath = path.join(req.hermes.paths.sessionsDir, `${req.params.id}.jsonl`);
    const jsonPath = path.join(req.hermes.paths.sessionsDir, `session_${req.params.id}.json`);
    
    try {
      const data = await fs.readFile(jsonlPath, 'utf-8');
      const lines = data.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
      return res.json(lines);
    } catch {
      const data = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(data);
      return res.json(parsed.messages || []);
    }
  } catch (error) {
    res.json([]);
  }
});

app.get('/api/sessions/stats', async (req, res) => {
  try {
    const db = req.hermes.db;
    const totalSessions = db.prepare('SELECT COUNT(*) AS count FROM sessions').get()?.count || 0;
    const totalMessages = db.prepare('SELECT COUNT(*) AS count FROM messages').get()?.count || 0;
    const bySource = db.prepare('SELECT source, COUNT(*) AS count FROM sessions GROUP BY source ORDER BY count DESC').all();
    const dbStats = await fs.stat(req.hermes.paths.stateDb).catch(() => null);
    res.json({
      total_sessions: totalSessions,
      total_messages: totalMessages,
      by_source: bySource,
      database_size_bytes: dbStats?.size || 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not compute session stats', details: error.message });
  }
});

app.post('/api/sessions/prune', async (req, res) => {
  try {
    const olderThanDays = Math.max(1, Number(req.body?.older_than_days || 90));
    const source = req.body?.source ? String(req.body.source) : null;
    const cutoff = nowTs() - (olderThanDays * 24 * 60 * 60 * 1000);
    const db = req.hermes.db;
    const params = source ? [cutoff, source] : [cutoff];
    const query = source
      ? 'DELETE FROM sessions WHERE COALESCE(ended_at, updated_at, started_at) < ? AND source = ?'
      : 'DELETE FROM sessions WHERE COALESCE(ended_at, updated_at, started_at) < ?';
    const result = db.prepare(query).run(...params);
    res.json({ success: true, deleted: result.changes || 0, older_than_days: olderThanDays, source });
  } catch (error) {
    res.status(500).json({ error: 'Could not prune sessions', details: error.message });
  }
});

app.post('/api/sessions/export', async (req, res) => {
  try {
    const source = req.body?.source ? String(req.body.source) : null;
    const sessionId = req.body?.session_id ? String(req.body.session_id) : null;
    const outputPath = req.body?.output_path ? String(req.body.output_path) : null;
    const db = req.hermes.db;

    let whereClause = '';
    const args = [];
    if (source) {
      whereClause = 'WHERE s.source = ?';
      args.push(source);
    }
    if (sessionId) {
      whereClause = whereClause ? `${whereClause} AND s.id = ?` : 'WHERE s.id = ?';
      args.push(sessionId);
    }

    const sessions = db.prepare(`
      SELECT s.id, s.source, s.user_id, s.title, s.model, s.system_prompt, s.parent_session_id,
             s.started_at, s.ended_at, s.input_tokens, s.output_tokens, s.updated_at
      FROM sessions s
      ${whereClause}
      ORDER BY s.started_at ASC
    `).all(...args);

    const messagesStmt = db.prepare(`
      SELECT role, content, tool_calls, tool_name, tool_results, token_count, timestamp
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp ASC, id ASC
    `);

    const lines = sessions.map(item => JSON.stringify({
      ...item,
      messages: messagesStmt.all(item.id).map(msg => ({
        ...msg,
        tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : undefined,
        tool_results: msg.tool_results ? JSON.parse(msg.tool_results) : undefined,
      })),
    }));

    if (outputPath) {
      await fs.writeFile(path.resolve(outputPath), `${lines.join('\n')}\n`, 'utf-8');
      return res.json({ success: true, count: lines.length, output_path: path.resolve(outputPath) });
    }
    res.json({ count: lines.length, items: lines });
  } catch (error) {
    res.status(500).json({ error: 'Could not export sessions', details: error.message });
  }
});

// ── Models (Provider catalogs) ─────────────────────────────────────

app.get('/api/models', async (req, res) => {
  try {
    const provider = normalizeChatProvider(req.query?.provider);

    if (provider === 'lmstudio') {
      const response = await axios.get(`${LMSTUDIO_BASE_URL}/models`, { timeout: 3000 });
      const models = Array.isArray(response.data?.data)
        ? response.data.data.map(item => ({
            name: item?.id,
            id: item?.id,
            object: item?.object,
            owned_by: item?.owned_by,
          })).filter(item => item.name)
        : [];
      return res.json({ models, provider: 'lmstudio' });
    }

    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 3000 });
    res.json(response.data);
  } catch {
    res.status(503).json({ models: [] });
  }
});

// ── Skills & Hooks ─────────────────────────────────────────────────

async function listSubDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const info = { name: entry.name, path: path.join(dirPath, entry.name) };
        try {
          const skillMd = await fs.readFile(path.join(info.path, 'SKILL.md'), 'utf-8');
          const descMatch = skillMd.match(/description:\s*(.+)/i);
          if (descMatch) info.description = descMatch[1].trim();
        } catch { /* no SKILL.md */ }
        try {
          const hookYaml = await fs.readFile(path.join(info.path, 'HOOK.yaml'), 'utf-8');
          const parsed = yaml.parse(hookYaml);
          if (parsed?.description) info.description = parsed.description;
          if (parsed?.events) info.events = parsed.events;
        } catch { /* no HOOK.yaml */ }
        results.push(info);
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function listGatewayHooks(hermes) {
  try {
    const hooksPath = hermes.paths.hooks;
    const entries = await fs.readdir(hooksPath, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const hookDir = path.join(hooksPath, entry.name);
      const hookYamlPath = path.join(hookDir, 'HOOK.yaml');
      if (!(await exists(hookYamlPath))) continue;
      const hookYaml = await fs.readFile(hookYamlPath, 'utf-8').catch(() => '');
      const parsed = hookYaml ? (yaml.parse(hookYaml) || {}) : {};
      results.push({
        name: parsed.name || entry.name,
        description: parsed.description,
        events: parsed.events || [],
        path: hookDir,
        source: 'gateway',
        hasHandler: await exists(path.join(hookDir, 'handler.py')),
      });
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function expandPath(hermes, inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return inputPath;
  let next = inputPath.replace(/^~(?=$|[\\/])/, hermes.home.replace(/[\\/]?\.hermes$/, ''));
  next = next.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
  return next;
}

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

async function readConfigForSkills(hermes) {
  try {
    const data = await fs.readFile(hermes.paths.config, 'utf-8');
    return yaml.parse(data) || {};
  } catch {
    return {};
  }
}

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: content, frontmatter: {} };
  try {
    return {
      body: content.slice(match[0].length),
      frontmatter: yaml.parse(match[1]) || {},
    };
  } catch {
    return { body: content, frontmatter: {} };
  }
}

function sanitizeSkillSegment(value, fallback = 'skill') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function ensurePathInsideRoot(rootDir, candidatePath) {
  const relative = path.relative(rootDir, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function buildSkillTemplate({ name, description }) {
  const frontmatter = yaml.stringify({
    name,
    description: description || undefined,
    version: '1.0.0',
  }).trim();

  return `---
${frontmatter}
---

# ${name}

## Purpose

Describe what this skill does and the outcome it should help Hermes produce.

## Use When

- Add the concrete situations where this skill should be used.

## Workflow

1. Inspect the local context before acting.
2. Use the smallest set of tools needed.
3. Return a concise result with the next useful action.
`;
}

function resolveLocalSkillTarget(hermes, inputPath) {
  const skillsRoot = path.resolve(hermes.paths.skills);
  if (!inputPath || typeof inputPath !== 'string') return null;

  const resolvedInput = path.resolve(String(inputPath));
  const skillDir = path.basename(resolvedInput).toLowerCase() === 'skill.md'
    ? path.dirname(resolvedInput)
    : resolvedInput;
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!ensurePathInsideRoot(skillsRoot, skillDir) || !ensurePathInsideRoot(skillsRoot, skillFile)) {
    return null;
  }

  return { skillsRoot, skillDir, skillFile };
}

async function collectSkillsRecursive(rootDir, currentDir, source, seenNames, results) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const hasSkill = entries.some(entry => entry.isFile() && entry.name === 'SKILL.md');

  if (hasSkill) {
    const skillPath = path.join(currentDir, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf-8');
    const { frontmatter } = parseSkillFrontmatter(content);
    const name = frontmatter.name || path.basename(currentDir);

    if (!seenNames.has(name)) {
      seenNames.add(name);
      const relDir = path.relative(rootDir, currentDir);
      const parts = relDir.split(path.sep).filter(Boolean);
      const category = parts.length > 1 ? parts[0] : undefined;

      results.push({
        name,
        description: frontmatter.description,
        version: frontmatter.version,
        path: currentDir,
        source,
        rootDir,
        category,
        platforms: frontmatter.platforms || [],
        tags: frontmatter.metadata?.hermes?.tags || [],
        fallbackForToolsets: frontmatter.metadata?.hermes?.fallback_for_toolsets || [],
        requiresToolsets: frontmatter.metadata?.hermes?.requires_toolsets || [],
        fallbackForTools: frontmatter.metadata?.hermes?.fallback_for_tools || [],
        requiresTools: frontmatter.metadata?.hermes?.requires_tools || [],
        requiredEnvironmentVariables: frontmatter.required_environment_variables || [],
      });
    }
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    await collectSkillsRecursive(rootDir, path.join(currentDir, entry.name), source, seenNames, results);
  }
}

async function listSkills(hermes) {
  const config = await readConfigForSkills(hermes);
  const externalDirs = (config.skills?.external_dirs || [])
    .map(p => expandPath(hermes, p))
    .filter(Boolean);

  const roots = [{ dir: hermes.paths.skills, source: 'local' }, ...externalDirs.map(dir => ({ dir, source: 'external' }))];
  const results = [];
  const seenNames = new Set();

  for (const root of roots) {
    if (!(await exists(root.dir))) continue;
    await collectSkillsRecursive(root.dir, root.dir, root.source, seenNames, results);
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

app.get('/api/skills', async (req, res) => {
  res.json(await listSkills(req.hermes));
});

app.post('/api/skills', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const categoryInput = String(req.body?.category || '').trim();

    if (!name) {
      return res.status(400).json({ error: 'Skill name is required' });
    }

    const skillsRoot = path.resolve(req.hermes.paths.skills);
    const category = categoryInput ? sanitizeSkillSegment(categoryInput, '') : '';
    const slug = sanitizeSkillSegment(name, 'skill');
    const targetDir = category
      ? path.resolve(skillsRoot, category, slug)
      : path.resolve(skillsRoot, slug);

    if (!ensurePathInsideRoot(skillsRoot, targetDir)) {
      return res.status(400).json({ error: 'Invalid skill target path' });
    }

    const skillFile = path.join(targetDir, 'SKILL.md');
    if (await exists(skillFile)) {
      return res.status(409).json({ error: 'A local skill with that name already exists in this profile' });
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(skillFile, buildSkillTemplate({ name, description }), 'utf-8');

    res.json({
      success: true,
      skill: {
        name,
        description: description || undefined,
        category: category || undefined,
        path: targetDir,
        skillFile,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not create local skill', details: error.message });
  }
});

app.get('/api/skills/content', async (req, res) => {
  try {
    const target = resolveLocalSkillTarget(req.hermes, String(req.query?.path || ''));
    if (!target) {
      return res.status(400).json({ error: 'Invalid local skill path' });
    }
    if (!(await exists(target.skillFile))) {
      return res.status(404).json({ error: 'Local skill not found' });
    }

    const content = await fs.readFile(target.skillFile, 'utf-8');
    res.json({
      path: target.skillDir,
      skillFile: target.skillFile,
      content,
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not read local skill', details: error.message });
  }
});

app.put('/api/skills', async (req, res) => {
  try {
    const target = resolveLocalSkillTarget(req.hermes, String(req.body?.path || ''));
    const content = String(req.body?.content || '');
    if (!target) {
      return res.status(400).json({ error: 'Invalid local skill path' });
    }
    if (!(await exists(target.skillFile))) {
      return res.status(404).json({ error: 'Local skill not found' });
    }

    await fs.writeFile(target.skillFile, content, 'utf-8');
    res.json({ success: true, path: target.skillDir, skillFile: target.skillFile });
  } catch (error) {
    res.status(500).json({ error: 'Could not save local skill', details: error.message });
  }
});

app.delete('/api/skills', async (req, res) => {
  try {
    const target = resolveLocalSkillTarget(req.hermes, String(req.body?.path || req.query?.path || ''));
    if (!target) {
      return res.status(400).json({ error: 'Invalid local skill path' });
    }
    if (target.skillDir === target.skillsRoot) {
      return res.status(400).json({ error: 'Refusing to remove the skills root' });
    }
    if (!(await exists(target.skillFile))) {
      return res.status(404).json({ error: 'Local skill not found' });
    }

    await fs.rm(target.skillDir, { recursive: true, force: true });
    res.json({ success: true, path: target.skillDir });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete local skill', details: error.message });
  }
});

async function listPlugins(hermes) {
  const config = await readConfigForSkills(hermes);
  const disabled = new Set(config?.plugins?.disabled || []);
  const projectPluginsEnabled = String(process.env.HERMES_ENABLE_PROJECT_PLUGINS || '').toLowerCase() === 'true';
  const roots = [
    { dir: path.join(hermes.home, 'plugins'), source: 'user', enabledByPolicy: true },
    { dir: path.join(WORKSPACE_ROOT, '.hermes', 'plugins'), source: 'project', enabledByPolicy: projectPluginsEnabled },
  ];
  const results = [];

  for (const root of roots) {
    if (!(await exists(root.dir))) continue;
    const entries = await fs.readdir(root.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(root.dir, entry.name);
      const manifestPath = path.join(pluginDir, 'plugin.yaml');
      if (!(await exists(manifestPath))) continue;

      const manifestRaw = await fs.readFile(manifestPath, 'utf-8').catch(() => '');
      const manifest = manifestRaw ? (yaml.parse(manifestRaw) || {}) : {};
      const pluginName = manifest.name || entry.name;

      results.push({
        name: pluginName,
        version: manifest.version,
        description: manifest.description,
        path: pluginDir,
        source: root.source,
        enabled: root.enabledByPolicy && !disabled.has(pluginName),
        requiresEnv: manifest.requires_env || [],
        hasInitPy: await exists(path.join(pluginDir, '__init__.py')),
        hasSchemasPy: await exists(path.join(pluginDir, 'schemas.py')),
        hasToolsPy: await exists(path.join(pluginDir, 'tools.py')),
      });
    }
  }

  return {
    plugins: results.sort((a, b) => a.name.localeCompare(b.name)),
    projectPluginsEnabled,
    pipEntryPointsVisible: false,
  };
}

app.get('/api/hooks', async (req, res) => {
  res.json(await listGatewayHooks(req.hermes));
});

app.get('/api/plugins', async (req, res) => {
  try {
    res.json(await listPlugins(req.hermes));
  } catch (error) {
    res.status(500).json({ error: 'Could not list plugins', details: error.message });
  }
});

app.get('/api/cronjobs', async (req, res) => {
  try {
    const { jobs } = await readCronJobsFile(req.hermes);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Could not read cron jobs', details: error.message });
  }
});

app.post('/api/cronjobs', async (req, res) => {
  try {
    const { jobs, wrapper } = await readCronJobsFile(req.hermes);
    const payload = req.body || {};
    if (!isValidSchedule(payload.schedule)) {
      return res.status(400).json({
        error: 'Invalid schedule format. Supported: "15m", "2h", "1d", "every 30m", or ISO datetime.',
      });
    }
    const job = normalizeCronJob(payload);
    jobs.push(job);
    await writeCronJobsFile(req.hermes, jobs, wrapper);
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Could not create cron job', details: error.message });
  }
});

app.patch('/api/cronjobs/:id', async (req, res) => {
  try {
    const { jobs, wrapper } = await readCronJobsFile(req.hermes);
    const index = jobs.findIndex(job => job.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Cron job not found' });
    const payload = req.body || {};
    if (payload.schedule !== undefined && !isValidSchedule(payload.schedule)) {
      return res.status(400).json({
        error: 'Invalid schedule format. Supported: "15m", "2h", "1d", "every 30m", or ISO datetime.',
      });
    }
    jobs[index] = normalizeCronJob(payload, jobs[index]);
    await writeCronJobsFile(req.hermes, jobs, wrapper);
    res.json(jobs[index]);
  } catch (error) {
    res.status(500).json({ error: 'Could not update cron job', details: error.message });
  }
});

app.post('/api/cronjobs/:id/pause', async (req, res) => {
  try {
    const { jobs, wrapper } = await readCronJobsFile(req.hermes);
    const job = jobs.find(item => item.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Cron job not found' });
    job.paused = true;
    job.next_run_at = null;
    job.updated_at = new Date().toISOString();
    await writeCronJobsFile(req.hermes, jobs, wrapper);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not pause cron job', details: error.message });
  }
});

app.post('/api/cronjobs/:id/resume', async (req, res) => {
  try {
    const { jobs, wrapper } = await readCronJobsFile(req.hermes);
    const job = jobs.find(item => item.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Cron job not found' });
    job.paused = false;
    job.next_run_at = computeNextRunAt(job.schedule, false);
    job.updated_at = new Date().toISOString();
    await writeCronJobsFile(req.hermes, jobs, wrapper);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not resume cron job', details: error.message });
  }
});

app.post('/api/cronjobs/:id/run', async (req, res) => {
  try {
    const { jobs, wrapper } = await readCronJobsFile(req.hermes);
    const job = jobs.find(item => item.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Cron job not found' });
    job.force_run = true;
    job.next_run_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();
    await writeCronJobsFile(req.hermes, jobs, wrapper);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not mark cron job for run', details: error.message });
  }
});

app.post('/api/cronjobs/:id/remove', async (req, res) => {
  try {
    const { jobs, wrapper } = await readCronJobsFile(req.hermes);
    const next = jobs.filter(item => item.id !== req.params.id);
    await writeCronJobsFile(req.hermes, next, wrapper);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not remove cron job', details: error.message });
  }
});

app.get('/api/cronjobs/outputs', async (req, res) => {
  try {
    const jobId = req.query?.jobId ? String(req.query.jobId) : null;
    res.json(await listCronOutputs(req.hermes, jobId));
  } catch (error) {
    res.status(500).json({ error: 'Could not read cron outputs', details: error.message });
  }
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

await installFrontend();

app.listen(port, () => {
  console.log(`[hermes-command-center] Backend running on http://localhost:${port}`);
  if (BUILDER_UI_MODE === 'dev') {
    console.log(`[hermes-command-center] Serving Vite middleware from ${BUILDER_ROOT}`);
  } else if (fsSync.existsSync(BUILDER_DIST_INDEX)) {
    console.log(`[hermes-command-center] Serving frontend bundle from ${BUILDER_DIST_DIR}`);
  } else {
    console.warn('[hermes-command-center] Frontend bundle missing. / will return 503 until "npm run build" is executed.');
  }
});
