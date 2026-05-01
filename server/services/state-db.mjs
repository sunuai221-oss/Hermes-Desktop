import fsSync from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function initializeStateDb(dbPath, db) {
  db.exec('PRAGMA busy_timeout=5000;');
  try {
    db.exec('PRAGMA journal_mode=WAL;');
  } catch (error) {
    console.warn(`[stateDb] Could not set WAL mode on ${dbPath} (likely already set and locked):`, error.message);
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
}

export function createStateDbManager() {
  const stateDbs = new Map();

  function getStateDb(dbPath) {
    if (stateDbs.has(dbPath)) return stateDbs.get(dbPath);

    fsSync.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    initializeStateDb(dbPath, db);
    stateDbs.set(dbPath, db);
    return db;
  }

  function getOpenStateDb(dbPath) {
    return stateDbs.get(dbPath);
  }

  function closeStateDb(dbPath) {
    const db = stateDbs.get(dbPath);
    if (db?.close) {
      db.close();
    }
    stateDbs.delete(dbPath);
  }

  return {
    getStateDb,
    getOpenStateDb,
    closeStateDb,
  };
}
