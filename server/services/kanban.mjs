import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VALID_STATUSES = new Set(['triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived']);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BOARD = 'default';
const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9\-_]{0,63}$/;
const DEFAULT_CLAIM_TTL_SECONDS = 15 * 60;
const VALID_WORKSPACE_KINDS = new Set(['scratch', 'worktree', 'dir']);

// ---------------------------------------------------------------------------
// DB connection cache (one connection per unique db path)
// ---------------------------------------------------------------------------

const _CONNECTION_CACHE = new Map();

function _getKanbanHome() {
  const override = process.env.HERMES_KANBAN_HOME;
  if (override && override.trim()) return override.trim();
  const hermesHome = process.env.HERMES_HOME;
  if (hermesHome) return hermesHome;
  // Default to the profile-aware root
  const home = process.env.HOME || '/home/nabs';
  return path.join(home, '.hermes');
}

function _boardsRoot() {
  return path.join(_getKanbanHome(), 'kanban', 'boards');
}

function _boardDir(slug) {
  const norm = _normalizeBoardSlug(slug) || DEFAULT_BOARD;
  return path.join(_boardsRoot(), norm);
}

function _currentBoardPath() {
  return path.join(_getKanbanHome(), 'kanban', 'current');
}

function _kanbanDbPath(board) {
  const override = process.env.HERMES_KANBAN_DB;
  if (override && override.trim()) return override.trim();
  let slug = _normalizeBoardSlug(board);
  if (!slug) {
    slug = _getCurrentBoard();
  }
  if (slug === DEFAULT_BOARD) {
    return path.join(_getKanbanHome(), 'kanban.db');
  }
  return path.join(_boardDir(slug), 'kanban.db');
}

function _getKanbanHomeForHermer(hermes) {
  // If hermes object provides a home, try to resolve it
  if (hermes?.home) {
    // Try to parse as WSL UNC path first
    const unc = _parseWslUncPath(hermes.home);
    if (unc?.linuxPath) return unc.linuxPath;
  }
  const override = process.env.HERMES_KANBAN_HOME;
  if (override && override.trim()) return override.trim();
  return _getKanbanHome();
}

// ---------------------------------------------------------------------------
// Board resolution (mirrors Python get_current_board)
// ---------------------------------------------------------------------------

function _getCurrentBoard() {
  // 1. HERMES_KANBAN_BOARD env var
  const env = process.env.HERMES_KANBAN_BOARD;
  if (env && env.trim()) {
    try {
      const normed = _normalizeBoardSlug(env.trim());
      if (normed) return normed;
    } catch { /* fallthrough */ }
  }
  // 2. <root>/kanban/current file
  try {
    const f = _currentBoardPath();
    if (fs.existsSync(f)) {
      const val = fs.readFileSync(f, 'utf-8').trim();
      if (val) {
        try {
          const normed = _normalizeBoardSlug(val);
          if (normed && _boardExists(normed)) return normed;
        } catch { /* fallthrough */ }
      }
    }
  } catch { /* fallthrough */ }
  // 3. default
  return DEFAULT_BOARD;
}

function _setBoardCurrent(slug) {
  const normed = _normalizeBoardSlug(slug);
  if (!normed) throw new Error('board slug is required');
  const p = _currentBoardPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, normed + '\n', 'utf-8');
  return p;
}

function _boardExists(board) {
  const slug = _normalizeBoardSlug(board) || DEFAULT_BOARD;
  if (slug === DEFAULT_BOARD) return true;
  const d = _boardDir(slug);
  return fs.existsSync(d) || fs.existsSync(path.join(d, 'kanban.db'));
}

function _boardMetadataPath(board) {
  const slug = _normalizeBoardSlug(board) || DEFAULT_BOARD;
  return path.join(_boardDir(slug), 'board.json');
}

function _defaultBoardDisplayName(slug) {
  return slug.replace(/_/g, '-').split('-').filter(Boolean).map(p =>
    p.charAt(0).toUpperCase() + p.slice(1)
  ).join(' ') || slug;
}

function _readBoardMetadata(board) {
  const slug = _normalizeBoardSlug(board) || DEFAULT_BOARD;
  const meta = {
    slug,
    name: _defaultBoardDisplayName(slug),
    description: '',
    icon: '',
    color: '',
    created_at: null,
    archived: false,
  };
  try {
    const p = _boardMetadataPath(slug);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (typeof raw === 'object' && raw !== null) {
        raw.slug = slug; // trust filesystem
        Object.assign(meta, raw);
      }
    }
  } catch { /* */ }
  meta.db_path = _kanbanDbPath(slug);
  return meta;
}

function _writeBoardMetadata(board, opts = {}) {
  const slug = _normalizeBoardSlug(board) || DEFAULT_BOARD;
  const meta = _readBoardMetadata(board);
  delete meta.db_path;
  if (opts.name !== undefined) meta.name = String(opts.name).trim() || _defaultBoardDisplayName(slug);
  if (opts.description !== undefined) meta.description = String(opts.description);
  if (opts.icon !== undefined) meta.icon = String(opts.icon);
  if (opts.color !== undefined) meta.color = String(opts.color);
  if (opts.archived !== undefined) meta.archived = Boolean(opts.archived);
  if (!meta.created_at) meta.created_at = Math.floor(Date.now() / 1000);
  const p = _boardMetadataPath(slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
  meta.db_path = _kanbanDbPath(slug);
  return meta;
}

// ---------------------------------------------------------------------------
// DB schema & init
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
    id                   TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    body                 TEXT,
    assignee             TEXT,
    status               TEXT NOT NULL,
    priority             INTEGER DEFAULT 0,
    created_by           TEXT,
    created_at           INTEGER NOT NULL,
    started_at           INTEGER,
    completed_at         INTEGER,
    workspace_kind       TEXT NOT NULL DEFAULT 'scratch',
    workspace_path       TEXT,
    claim_lock           TEXT,
    claim_expires        INTEGER,
    tenant               TEXT,
    result               TEXT,
    idempotency_key      TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    worker_pid           INTEGER,
    last_failure_error   TEXT,
    max_runtime_seconds  INTEGER,
    last_heartbeat_at    INTEGER,
    current_run_id       INTEGER,
    workflow_template_id TEXT,
    current_step_key     TEXT,
    skills               TEXT,
    max_retries          INTEGER
);

CREATE TABLE IF NOT EXISTS task_links (
    parent_id  TEXT NOT NULL,
    child_id   TEXT NOT NULL,
    PRIMARY KEY (parent_id, child_id)
);

CREATE TABLE IF NOT EXISTS task_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    run_id     INTEGER,
    kind       TEXT NOT NULL,
    payload    TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id             TEXT NOT NULL,
    profile             TEXT,
    step_key            TEXT,
    status              TEXT NOT NULL,
    claim_lock          TEXT,
    claim_expires       INTEGER,
    worker_pid          INTEGER,
    max_runtime_seconds INTEGER,
    last_heartbeat_at   INTEGER,
    started_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    outcome             TEXT,
    summary             TEXT,
    metadata            TEXT,
    error               TEXT
);

CREATE TABLE IF NOT EXISTS kanban_notify_subs (
    task_id       TEXT NOT NULL,
    platform      TEXT NOT NULL,
    chat_id       TEXT NOT NULL,
    thread_id     TEXT NOT NULL DEFAULT '',
    user_id       TEXT,
    notifier_profile TEXT,
    created_at    INTEGER NOT NULL,
    last_event_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_id, platform, chat_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee, status);
CREATE INDEX IF NOT EXISTS idx_tasks_status          ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant          ON tasks(tenant);
CREATE INDEX IF NOT EXISTS idx_tasks_idempotency     ON tasks(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_links_child           ON task_links(child_id);
CREATE INDEX IF NOT EXISTS idx_links_parent          ON task_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_task         ON task_comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_task           ON task_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_run            ON task_events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_runs_task             ON task_runs(task_id, started_at);
CREATE INDEX IF NOT EXISTS idx_runs_status           ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_notify_task           ON kanban_notify_subs(task_id);
`;

function _initDb(db) {
  db.exec(SCHEMA_SQL);
  _migrateColumns(db);
}

function _migrateColumns(db) {
  // Check if columns need migration
  const cols = new Set(
    db.prepare("PRAGMA table_info(tasks)").all().map(r => r.name)
  );
  if (!cols.has('tenant')) db.exec("ALTER TABLE tasks ADD COLUMN tenant TEXT");
  if (!cols.has('result')) db.exec("ALTER TABLE tasks ADD COLUMN result TEXT");
  if (!cols.has('idempotency_key')) {
    db.exec("ALTER TABLE tasks ADD COLUMN idempotency_key TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key)");
  }
  if (!cols.has('consecutive_failures')) {
    const hasLegacy = cols.has('spawn_failures');
    db.exec("ALTER TABLE tasks ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0");
    if (hasLegacy) db.exec("UPDATE tasks SET consecutive_failures = COALESCE(spawn_failures, 0)");
  }
  if (!cols.has('worker_pid')) db.exec("ALTER TABLE tasks ADD COLUMN worker_pid INTEGER");
  if (!cols.has('last_failure_error')) {
    const hasLegacy = cols.has('last_spawn_error');
    db.exec("ALTER TABLE tasks ADD COLUMN last_failure_error TEXT");
    if (hasLegacy) db.exec("UPDATE tasks SET last_failure_error = last_spawn_error");
  }
  if (!cols.has('max_runtime_seconds')) db.exec("ALTER TABLE tasks ADD COLUMN max_runtime_seconds INTEGER");
  if (!cols.has('last_heartbeat_at')) db.exec("ALTER TABLE tasks ADD COLUMN last_heartbeat_at INTEGER");
  if (!cols.has('current_run_id')) db.exec("ALTER TABLE tasks ADD COLUMN current_run_id INTEGER");
  if (!cols.has('workflow_template_id')) db.exec("ALTER TABLE tasks ADD COLUMN workflow_template_id TEXT");
  if (!cols.has('current_step_key')) db.exec("ALTER TABLE tasks ADD COLUMN current_step_key TEXT");
  if (!cols.has('skills')) db.exec("ALTER TABLE tasks ADD COLUMN skills TEXT");
  if (!cols.has('max_retries')) db.exec("ALTER TABLE tasks ADD COLUMN max_retries INTEGER");

  // task_events run_id
  const evCols = new Set(
    db.prepare("PRAGMA table_info(task_events)").all().map(r => r.name)
  );
  if (!evCols.has('run_id')) {
    db.exec("ALTER TABLE task_events ADD COLUMN run_id INTEGER");
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_run ON task_events(run_id, id)");
  }

  // kanban_notify_subs notifier_profile
  const notifyExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='kanban_notify_subs'").get();
  if (notifyExists) {
    const nCols = new Set(
      db.prepare("PRAGMA table_info(kanban_notify_subs)").all().map(r => r.name)
    );
    if (!nCols.has('notifier_profile')) {
      db.exec("ALTER TABLE kanban_notify_subs ADD COLUMN notifier_profile TEXT");
    }
  }
}

function _connectDb(dbPath) {
  if (_CONNECTION_CACHE.has(dbPath)) return _CONNECTION_CACHE.get(dbPath);

  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  _initDb(db);
  _CONNECTION_CACHE.set(dbPath, db);
  return db;
}

function _getDb(board) {
  const dbPath = _kanbanDbPath(board);
  return _connectDb(dbPath);
}

function _normalizeBoardSlug(slug) {
  if (slug == null) return null;
  const s = String(slug).trim().toLowerCase();
  if (!s) return null;
  if (!BOARD_SLUG_RE.test(s)) {
    throw new Error(`invalid board slug: ${slug}`);
  }
  return s;
}

function _cleanString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function _asArray(value) {
  if (Array.isArray(value)) return value.map(_cleanString).filter(Boolean);
  const text = _cleanString(value);
  if (!text) return [];
  return text.split(',').map(_cleanString).filter(Boolean);
}

function _parseWslUncPath(inputPath) {
  const value = String(inputPath || '');
  const match = value.match(/^\\\\wsl(?:\.localhost)?\\([^\\]+)(.*)$/i);
  if (!match) return null;
  const distro = match[1];
  const suffix = match[2] || '';
  const linuxPath = suffix ? suffix.replace(/\\/g, '/') : '/';
  return { distro, linuxPath: linuxPath.startsWith('/') ? linuxPath : '/' + linuxPath };
}

function _rowToTask(row) {
  if (!row) return null;
  let skills = null;
  if (row.skills) {
    try {
      const parsed = JSON.parse(row.skills);
      if (Array.isArray(parsed)) skills = parsed.filter(Boolean).map(String);
    } catch { /* */ }
  }
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    assignee: row.assignee,
    status: row.status,
    priority: row.priority,
    created_by: row.created_by,
    created_at: row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    workspace_kind: row.workspace_kind,
    workspace_path: row.workspace_path,
    claim_lock: row.claim_lock,
    claim_expires: row.claim_expires,
    tenant: row.tenant,
    result: row.result,
    idempotency_key: row.idempotency_key,
    consecutive_failures: row.consecutive_failures ?? 0,
    worker_pid: row.worker_pid,
    last_failure_error: row.last_failure_error,
    max_runtime_seconds: row.max_runtime_seconds,
    last_heartbeat_at: row.last_heartbeat_at,
    current_run_id: row.current_run_id,
    workflow_template_id: row.workflow_template_id,
    current_step_key: row.current_step_key,
    skills,
    max_retries: row.max_retries,
  };
}

function _rowToRun(row) {
  if (!row) return null;
  let meta = null;
  if (row.metadata) {
    try { meta = JSON.parse(row.metadata); } catch { /* */ }
  }
  return {
    id: row.id,
    task_id: row.task_id,
    profile: row.profile,
    step_key: row.step_key,
    status: row.status,
    claim_lock: row.claim_lock,
    claim_expires: row.claim_expires,
    worker_pid: row.worker_pid,
    max_runtime_seconds: row.max_runtime_seconds,
    last_heartbeat_at: row.last_heartbeat_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
    outcome: row.outcome,
    summary: row.summary,
    metadata: meta,
    error: row.error,
  };
}

function _rowToComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    task_id: row.task_id,
    author: row.author,
    body: row.body,
    created_at: row.created_at,
  };
}

function _rowToEvent(row) {
  if (!row) return null;
  let payload = null;
  if (row.payload) {
    try { payload = JSON.parse(row.payload); } catch { /* */ }
  }
  return {
    id: row.id,
    task_id: row.task_id,
    kind: row.kind,
    payload,
    created_at: row.created_at,
    run_id: row.run_id,
  };
}

// ---------------------------------------------------------------------------
// Service functions (matching the old interface exactly)
// ---------------------------------------------------------------------------

export async function listBoards(hermes) {
  const entries = [];
  const seen = new Set();

  // Always include default first
  entries.push(_readBoardMetadata(DEFAULT_BOARD));
  seen.add(DEFAULT_BOARD);

  // Scan boards directory
  const root = _boardsRoot();
  if (fs.existsSync(root)) {
    const children = fs.readdirSync(root).sort();
    for (const name of children) {
      const childPath = path.join(root, name);
      if (!fs.statSync(childPath).isDirectory()) continue;
      let normed;
      try { normed = _normalizeBoardSlug(name); } catch { continue; }
      if (!normed || seen.has(normed)) continue;
      const hasDb = fs.existsSync(path.join(childPath, 'kanban.db'));
      const hasMeta = fs.existsSync(path.join(childPath, 'board.json'));
      if (!hasDb && !hasMeta) continue;
      const meta = _readBoardMetadata(normed);
      if (meta.archived) continue; // skip archived by default
      entries.push(meta);
      seen.add(normed);
    }
  }

  return entries;
}

export async function createBoard(hermes, payload = {}) {
  const slug = _normalizeBoardSlug(payload.slug);
  if (!slug) throw new Error('Board slug is required');

  const meta = _writeBoardMetadata(slug, {
    name: payload.name,
    description: payload.description,
    icon: payload.icon,
    color: payload.color,
  });

  // Touch the DB
  _getDb(slug);

  if (payload.switch === true) {
    _setBoardCurrent(slug);
  }

  return listBoards(hermes);
}

export async function switchBoard(hermes, slug) {
  const normed = _normalizeBoardSlug(slug);
  if (!normed) throw new Error('Board slug is required');
  if (!_boardExists(normed)) throw new Error(`Board ${normed} does not exist`);

  _setBoardCurrent(normed);
  return listBoards(hermes);
}

export async function listTasks(hermes, query = {}) {
  const board = query.board || undefined;
  const db = _getDb(board);

  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];

  if (query.status && VALID_STATUSES.has(String(query.status))) {
    sql += ' AND status = ?';
    params.push(String(query.status));
  }
  if (query.assignee) {
    sql += ' AND assignee = ?';
    params.push(String(query.assignee).toLowerCase());
  }
  if (query.tenant) {
    sql += ' AND tenant = ?';
    params.push(String(query.tenant));
  }
  if (!query.archived) {
    sql += " AND status != 'archived'";
  }

  sql += ' ORDER BY priority DESC, created_at ASC';

  const rows = db.prepare(sql).all(...params);
  return rows.map(_rowToTask);
}

export async function createTask(hermes, payload = {}) {
  const title = _cleanString(payload.title);
  if (!title) throw new Error('Task title is required');

  const board = payload.board || undefined;
  const db = _getDb(board);

  const skillsValue = _asArray(payload.skills);
  const parents = _asArray(payload.parents);

  // Validate workspace_kind
  const workspaceKind = _cleanString(payload.workspaceKind) || 'scratch';
  if (!VALID_WORKSPACE_KINDS.has(workspaceKind)) {
    throw new Error(`workspace_kind must be one of ${[...VALID_WORKSPACE_KINDS].join(', ')}, got '${workspaceKind}'`);
  }

  // Idempotency check
  const idempotencyKey = _cleanString(payload.idempotencyKey);
  if (idempotencyKey) {
    const existing = db.prepare(
      "SELECT id FROM tasks WHERE idempotency_key = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 1"
    ).get(idempotencyKey);
    if (existing) return _rowToTask(
      db.prepare('SELECT * FROM tasks WHERE id = ?').get(existing.id)
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // Determine initial status
  let initialStatus = 'ready';
  if (payload.triage === true) {
    initialStatus = 'triage';
  } else if (parents.length > 0) {
    // Validate parents exist
    const placeholders = parents.map(() => '?').join(',');
    const existingParents = db.prepare(
      `SELECT id FROM tasks WHERE id IN (${placeholders})`
    ).all(...parents);
    const existingIds = new Set(existingParents.map(r => r.id));
    const missing = parents.filter(p => !existingIds.has(p));
    if (missing.length > 0) {
      throw new Error(`unknown parent task(s): ${missing.join(', ')}`);
    }
    // Check if any parent is not done
    const parentStatuses = db.prepare(
      `SELECT status FROM tasks WHERE id IN (${placeholders})`
    ).all(...parents);
    if (parentStatuses.some(r => r.status !== 'done')) {
      initialStatus = 'todo';
    }
  }

  // Generate task ID and insert
  const taskId = _newTaskId();

  const priority = Number.isFinite(Number(payload.priority)) ? Math.trunc(Number(payload.priority)) : 0;
  const maxRuntime = payload.maxRuntime != null ? Math.trunc(Number(payload.maxRuntime)) : null;
  const maxRetries = payload.maxRetries != null ? Math.trunc(Number(payload.maxRetries)) : null;

  db.prepare(`
    INSERT INTO tasks (
      id, title, body, assignee, status, priority,
      created_by, created_at, workspace_kind, workspace_path,
      tenant, idempotency_key, max_runtime_seconds, skills, max_retries
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    title.trim(),
    _cleanString(payload.body),
    _cleanString(payload.assignee)?.toLowerCase() || null,
    initialStatus,
    priority,
    _cleanString(payload.createdBy) || 'desktop',
    now,
    workspaceKind,
    _cleanString(payload.workspace),
    _cleanString(payload.tenant),
    idempotencyKey,
    maxRuntime,
    skillsValue.length > 0 ? JSON.stringify(skillsValue) : null,
    maxRetries,
  );

  // Link parents
  for (const pid of parents) {
    db.prepare(
      'INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)'
    ).run(pid, taskId);
  }

  // Append event
  _appendEvent(db, taskId, 'created', {
    assignee: _cleanString(payload.assignee)?.toLowerCase(),
    status: initialStatus,
    parents: [...parents],
    tenant: _cleanString(payload.tenant),
    skills: skillsValue.length > 0 ? [...skillsValue] : null,
  });

  return _rowToTask(
    db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
  );
}

export async function showTask(hermes, board, taskId) {
  const db = _getDb(board);

  const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!taskRow) throw new Error(`Task ${taskId} not found`);

  const task = _rowToTask(taskRow);

  // Get comments
  const comments = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
  ).all(taskId).map(_rowToComment);

  // Get events
  const events = db.prepare(
    'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC'
  ).all(taskId).map(_rowToEvent);

  // Get runs
  const runs = db.prepare(
    'SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC'
  ).all(taskId).map(_rowToRun);

  // Get links (parents & children)
  const childLinks = db.prepare(
    'SELECT child_id FROM task_links WHERE parent_id = ?'
  ).all(taskId).map(r => r.child_id);
  const parentLinks = db.prepare(
    'SELECT parent_id FROM task_links WHERE child_id = ?'
  ).all(taskId).map(r => r.parent_id);

  return {
    ...task,
    comments,
    events,
    runs,
    parents: parentLinks,
    children: childLinks,
  };
}

export async function taskLog(hermes, board, taskId, tail = 12000) {
  // In direct DB mode, we return the events log since we don't have access to
  // the physical log files (those are on the WSL filesystem).
  // This matches the CLI behavior of returning task event history.
  const db = _getDb(board);

  const taskRow = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!taskRow) throw new Error(`Task ${taskId} not found`);

  const events = db.prepare(
    'SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC'
  ).all(taskId);

  // Format events as log lines
  const lines = [];
  for (const ev of events) {
    let pl = '';
    if (ev.payload) {
      try { pl = ' ' + JSON.parse(ev.payload); } catch { pl = ' ' + ev.payload; }
    }
    lines.push(`[${new Date(ev.created_at * 1000).toISOString()}] ${ev.kind}${pl ? ': ' + pl : ''}`);
  }

  // Apply tail
  const trimmed = lines.slice(-Math.min(lines.length, tail / 80)); // rough char-to-line conversion

  return { taskId, content: trimmed.join('\n') || '' };
}

export async function taskAction(hermes, board, taskId, actionArgs) {
  // actionArgs is like CLI args: ['assign', taskId, 'none'], ['comment', taskId, 'text', '--author', 'x'], etc.
  // Parse the action from the args and execute it
  const action = actionArgs[0];

  switch (action) {
    case 'assign': {
      const assignee = actionArgs[2] || 'none';
      await _assignTask(hermes, board, taskId, assignee);
      break;
    }
    case 'comment': {
      const text = actionArgs[2] || '';
      let author = 'desktop';
      for (let i = 3; i < actionArgs.length; i++) {
        if (actionArgs[i] === '--author' && i + 1 < actionArgs.length) {
          author = actionArgs[i + 1];
          break;
        }
      }
      await _addComment(hermes, board, taskId, author, text);
      break;
    }
    case 'complete': {
      let result = null, summary = null, metadata = null;
      for (let i = 1; i < actionArgs.length; i++) {
        if (actionArgs[i] === '--result' && i + 1 < actionArgs.length) { result = actionArgs[++i]; }
        else if (actionArgs[i] === '--summary' && i + 1 < actionArgs.length) { summary = actionArgs[++i]; }
        else if (actionArgs[i] === '--metadata' && i + 1 < actionArgs.length) {
          try { metadata = JSON.parse(actionArgs[++i]); } catch { /* */ }
        }
      }
      await _completeTask(hermes, board, taskId, { result, summary, metadata });
      break;
    }
    case 'block': {
      const reason = actionArgs.slice(2).filter(a => !a.startsWith('--')).join(' ') || null;
      await _blockTask(hermes, board, taskId, reason);
      break;
    }
    case 'reclaim': {
      let reason = null;
      for (let i = 1; i < actionArgs.length; i++) {
        if (actionArgs[i] === '--reason' && i + 1 < actionArgs.length) { reason = actionArgs[++i]; }
      }
      await _reclaimTask(hermes, board, taskId, reason);
      break;
    }
    case 'archive': {
      await _archiveTask(hermes, board, taskId);
      break;
    }
    case 'unblock': {
      await _unblockTask(hermes, board, taskId);
      break;
    }
    default:
      throw new Error(`Unknown kanban action: ${action}`);
  }

  return showTask(hermes, board, taskId);
}

export async function transitionTaskStatus(hermes, board, taskId, status, payload = {}) {
  const db = _getDb(board);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);

  if (status === 'done') {
    await _completeTask(hermes, board, taskId, {
      result: payload?.result,
      summary: payload?.summary,
      metadata: payload?.metadata,
    });
    return;
  }

  if (status === 'blocked') {
    const reason = _cleanString(payload?.reason);
    await _blockTask(hermes, board, taskId, reason);
    return;
  }

  if (status === 'archived') {
    await _archiveTask(hermes, board, taskId);
    return;
  }

  if (status === 'ready') {
    // Ready transition could mean "unblock" or "promote"
    // Check if task is currently blocked, if so unblock
    if (task.status === 'blocked') {
      await _unblockTask(hermes, board, taskId);
      return;
    }
    // Otherwise just move to ready
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE tasks SET status = 'ready' WHERE id = ?").run(taskId);
    _appendEvent(db, taskId, 'promoted', { from: task.status });
    return;
  }

  // For other statuses, just move
  const now = Math.floor(Date.now() / 1000);
  if (status === 'running' && !task.started_at) {
    db.prepare(
      "UPDATE tasks SET status = ?, started_at = ? WHERE id = ?"
    ).run(status, now, taskId);
  } else {
    db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, taskId);
  }
  _appendEvent(db, taskId, 'moved', { from: task.status, to: status });
}

export async function stats(hermes, board) {
  const db = _getDb(board);

  const total = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  const byStatus = {};
  const statusCounts = db.prepare(
    "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
  ).all();
  for (const r of statusCounts) {
    byStatus[r.status] = r.count;
  }

  const open = db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE status NOT IN ('done', 'archived')"
  ).get().count;

  return {
    total,
    byStatus,
    open,
    board: _normalizeBoardSlug(board) || _getCurrentBoard(),
  };
}

export async function assignees(hermes, board) {
  const db = _getDb(board);

  const rows = db.prepare(
    "SELECT assignee, COUNT(*) as count FROM tasks WHERE assignee IS NOT NULL AND status != 'archived' GROUP BY assignee ORDER BY count DESC"
  ).all();

  const assignees = {};
  for (const r of rows) {
    assignees[r.assignee] = { count: r.count };
  }

  return assignees;
}

export async function diagnostics(hermes, query = {}) {
  // Provide basic diagnostics about the kanban DB
  const board = query.board || undefined;
  const db = _getDb(board);

  const info = {
    dbPath: _kanbanDbPath(board),
    board: _normalizeBoardSlug(board) || _getCurrentBoard(),
    tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name),
    taskCount: db.prepare('SELECT COUNT(*) as count FROM tasks').get().count,
    eventCount: db.prepare('SELECT COUNT(*) as count FROM task_events').get().count,
    commentCount: db.prepare('SELECT COUNT(*) as count FROM task_comments').get().count,
    runCount: db.prepare('SELECT COUNT(*) as count FROM task_runs').get().count,
  };

  if (query.severity) {
    // Filter diagnostics by severity if requested
    info.severity = query.severity;
  }
  if (query.task) {
    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(query.task);
    if (taskRow) {
      info.task = _rowToTask(taskRow);
    }
  }

  return info;
}

export function sendKanbanError(res, error) {
  const stderr = String(error?.stderr || '');
  const stdout = String(error?.stdout || '');
  const message = String(error?.message || '');
  const detail = stderr.trim() || stdout.trim() || message || 'Kanban command failed';
  // Check for common connection/file errors (backwards-compatible with WSL pattern from old impl)
  const status = /not found in WSL PATH|execvpe|ENOENT/i.test(detail) ? 503 : 500;
  res.status(status).json({
    error: 'Kanban command failed',
    details: _redactSecrets(detail),
    command: error?.command,
    code: typeof error?.code === 'number' ? error.code : null,
  });
}

// ---------------------------------------------------------------------------
// Internal helper functions
// ---------------------------------------------------------------------------

function _newTaskId() {
  return 't_' + crypto.randomBytes(4).toString('hex');
}

function _appendEvent(db, taskId, kind, payload = {}, runId = null) {
  const now = Math.floor(Date.now() / 1000);
  const pl = payload ? JSON.stringify(payload, null, 0) : null;
  db.prepare(
    'INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(taskId, runId, kind, pl, now);
}

async function _assignTask(hermes, board, taskId, profile) {
  const db = _getDb(board);
  profile = String(profile).toLowerCase().trim();

  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT status, claim_lock, assignee FROM tasks WHERE id = ?').get(taskId);
    if (!row) throw new Error(`Task ${taskId} not found`);
    if (row.claim_lock != null && row.status === 'running') {
      throw new Error(`cannot reassign ${taskId}: currently running (claimed)`);
    }
    if (row.assignee !== profile) {
      db.prepare(
        'UPDATE tasks SET assignee = ?, consecutive_failures = 0, last_failure_error = NULL WHERE id = ?'
      ).run(profile, taskId);
    } else {
      db.prepare('UPDATE tasks SET assignee = ? WHERE id = ?').run(profile, taskId);
    }
    _appendEvent(db, taskId, 'assigned', { assignee: profile });
    const result = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

async function _addComment(hermes, board, taskId, author, body) {
  const db = _getDb(board);

  if (!body || !body.trim()) throw new Error('comment body is required');
  if (!author || !author.trim()) throw new Error('comment author is required');
  const now = Math.floor(Date.now() / 1000);

  db.exec('BEGIN IMMEDIATE');
  try {
    const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId);
    if (!exists) throw new Error(`unknown task ${taskId}`);
    db.prepare(
      'INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)'
    ).run(taskId, author.trim(), body.trim(), now);
    _appendEvent(db, taskId, 'commented', { author, len: body.length });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

async function _completeTask(hermes, board, taskId, { result, summary, metadata } = {}) {
  const db = _getDb(board);
  const now = Math.floor(Date.now() / 1000);

  db.exec('BEGIN IMMEDIATE');
  try {
    // End current run if any
    const currentRunId = db.prepare('SELECT current_run_id FROM tasks WHERE id = ?').get(taskId)?.current_run_id;
    if (currentRunId != null) {
      db.prepare(`
        UPDATE task_runs
        SET status = ?, outcome = ?, summary = ?, error = ?, metadata = ?,
            ended_at = ?, claim_lock = NULL, claim_expires = NULL, worker_pid = NULL
        WHERE id = ? AND ended_at IS NULL
      `).run(
        'done', 'completed', summary, null,
        metadata ? JSON.stringify(metadata, null, 0) : null,
        now, currentRunId
      );
      db.prepare('UPDATE tasks SET current_run_id = NULL WHERE id = ?').run(taskId);
    }

    // Update task
    db.prepare(`
      UPDATE tasks SET status = 'done', result = ?, completed_at = ? WHERE id = ?
    `).run(result, now, taskId);

    _appendEvent(db, taskId, 'completed', { summary, result });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

async function _blockTask(hermes, board, taskId, reason) {
  const db = _getDb(board);
  const now = Math.floor(Date.now() / 1000);

  db.exec('BEGIN IMMEDIATE');
  try {
    const currentRunId = db.prepare('SELECT current_run_id FROM tasks WHERE id = ?').get(taskId)?.current_run_id;
    if (currentRunId != null) {
      db.prepare(`
        UPDATE task_runs
        SET status = 'blocked', outcome = 'blocked', summary = ?, ended_at = ?,
            claim_lock = NULL, claim_expires = NULL, worker_pid = NULL
        WHERE id = ? AND ended_at IS NULL
      `).run(reason, now, currentRunId);
      db.prepare('UPDATE tasks SET current_run_id = NULL WHERE id = ?').run(taskId);
    }

    db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(taskId);
    db.prepare(
      'UPDATE tasks SET consecutive_failures = consecutive_failures + 1, last_failure_error = ? WHERE id = ?'
    ).run(reason, taskId);

    _appendEvent(db, taskId, 'blocked', { reason });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

async function _archiveTask(hermes, board, taskId) {
  const db = _getDb(board);

  db.exec('BEGIN IMMEDIATE');
  try {
    const currentRunId = db.prepare('SELECT current_run_id FROM tasks WHERE id = ?').get(taskId)?.current_run_id;
    if (currentRunId != null) {
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        UPDATE task_runs
        SET status = 'reclaimed', outcome = 'reclaimed', ended_at = ?,
            claim_lock = NULL, claim_expires = NULL, worker_pid = NULL
        WHERE id = ? AND ended_at IS NULL
      `).run(now, currentRunId);
      db.prepare('UPDATE tasks SET current_run_id = NULL WHERE id = ?').run(taskId);
    }

    db.prepare("UPDATE tasks SET status = 'archived' WHERE id = ?").run(taskId);
    _appendEvent(db, taskId, 'archived', {});
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

async function _unblockTask(hermes, board, taskId) {
  const db = _getDb(board);

  const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  db.prepare("UPDATE tasks SET status = 'ready' WHERE id = ?").run(taskId);
  _appendEvent(db, taskId, 'promoted', { from: task.status });
}

async function _reclaimTask(hermes, board, taskId, reason) {
  const db = _getDb(board);

  db.exec('BEGIN IMMEDIATE');
  try {
    const currentRunId = db.prepare('SELECT current_run_id FROM tasks WHERE id = ?').get(taskId)?.current_run_id;
    if (currentRunId != null) {
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        UPDATE task_runs
        SET status = 'reclaimed', outcome = 'reclaimed', summary = ?, ended_at = ?,
            claim_lock = NULL, claim_expires = NULL, worker_pid = NULL
        WHERE id = ? AND ended_at IS NULL
      `).run(reason, now, currentRunId);
      db.prepare('UPDATE tasks SET current_run_id = NULL WHERE id = ?').run(taskId);
    }

    // If still running, move back to ready
    db.prepare(
      "UPDATE tasks SET status = 'ready', claim_lock = NULL, claim_expires = NULL WHERE id = ? AND status = 'running'"
    ).run(taskId);

    _appendEvent(db, taskId, 'reclaimed', { reason });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function _redactSecrets(input) {
  return String(input || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/(api[_-]?key\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[redacted]')
    .replace(/(token\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[redacted]')
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, 'sk-[redacted]');
}
