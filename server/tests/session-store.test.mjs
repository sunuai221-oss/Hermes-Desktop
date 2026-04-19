import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createStateDbManager } from '../services/state-db.mjs';
import {
  buildResumeRecap,
  createContinuationSession,
  insertMessages,
  sanitizeSessionTitle,
  upsertSession,
} from '../services/session-store.mjs';

async function withHermesContext(run) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hermes-session-store-'));
  const stateDbPath = path.join(tempDir, 'state', 'state.db');
  const manager = createStateDbManager();
  const hermes = {
    db: manager.getStateDb(stateDbPath),
    paths: {
      stateDb: stateDbPath,
      sessionsDir: path.join(tempDir, 'sessions'),
    },
  };

  try {
    await run({ hermes, manager, stateDbPath });
  } finally {
    manager.closeStateDb(stateDbPath);
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('state db manager caches open sqlite handles and recreates them after close', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hermes-state-db-'));
  const stateDbPath = path.join(tempDir, 'state.db');
  const manager = createStateDbManager();

  try {
    const first = manager.getStateDb(stateDbPath);
    const second = manager.getStateDb(stateDbPath);
    assert.equal(first, second);

    manager.closeStateDb(stateDbPath);

    const reopened = manager.getStateDb(stateDbPath);
    assert.notEqual(reopened, first);
  } finally {
    manager.closeStateDb(stateDbPath);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('sanitizeSessionTitle removes invisible characters and enforces the title length cap', () => {
  const sanitized = sanitizeSessionTitle(` \u0000Launch\u200B plan\u2060 ${'x'.repeat(150)} `);

  assert.equal(sanitized.startsWith('Launch plan '), true);
  assert.equal(sanitized.includes('\u0000'), false);
  assert.equal(sanitized.length, 100);
});

test('continuation sessions keep lineage metadata and recap includes parsed tool calls', async () => {
  await withHermesContext(async ({ hermes }) => {
    upsertSession(hermes, 'session-parent', {
      source: 'cli',
      userId: 'alice',
      title: 'Research Thread',
      model: 'gpt-test',
    });

    insertMessages(hermes, 'session-parent', [
      { role: 'user', content: 'Summarize the latest gateway status.' },
      {
        role: 'assistant',
        content: 'Gateway health is stable and the queue is empty.',
        tool_calls: [{ function: { name: 'gateway.health' } }],
      },
    ]);

    const child = createContinuationSession(hermes, 'session-parent');
    assert.equal(child.parent_session_id, 'session-parent');
    assert.equal(child.title, 'Research Thread #2');
    assert.equal(child.source, 'cli');
    assert.equal(child.user_id, 'alice');

    const recap = buildResumeRecap(hermes, 'session-parent');
    assert.equal(recap.mode, 'full');
    assert.equal(recap.exchanges.length, 1);
    assert.equal(recap.exchanges[0].user, 'Summarize the latest gateway status.');
    assert.equal(recap.exchanges[0].tool_calls.includes('gateway.health'), true);

    const ftsMatches = hermes.db.prepare(`
      SELECT rowid
      FROM messages_fts
      WHERE messages_fts MATCH ?
    `).all('queue');
    assert.equal(ftsMatches.length, 1);
  });
});
