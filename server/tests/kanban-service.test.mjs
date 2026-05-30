import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { VALID_STATUSES, createTask, showTask, taskAction, taskLog, sendKanbanError } from '../services/kanban.mjs';

function useTempKanbanHome(t) {
  const previous = process.env.HERMES_KANBAN_HOME;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-kanban-service-'));
  process.env.HERMES_KANBAN_HOME = dir;

  t.after(() => {
    if (previous === undefined) {
      delete process.env.HERMES_KANBAN_HOME;
    } else {
      process.env.HERMES_KANBAN_HOME = previous;
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* sqlite may still hold the db on Windows */ }
  });
}

test('kanban service exposes expected status set', () => {
  assert.equal(VALID_STATUSES.has('todo'), true);
  assert.equal(VALID_STATUSES.has('done'), true);
  assert.equal(VALID_STATUSES.has('invalid-status'), false);
});

test('sendKanbanError maps missing CLI to 503 and redacts secrets', () => {
  let statusCode = null;
  let payload = null;
  const res = {
    status(code) {
      statusCode = code;
      return {
        json(body) {
          payload = body;
        },
      };
    },
  };

  sendKanbanError(res, {
    stderr: 'Hermes CLI not found in WSL PATH. authorization: bearer sk-abcdef1234567890',
    command: 'hermes kanban list',
  });

  assert.equal(statusCode, 503);
  assert.equal(payload.error, 'Kanban command failed');
  assert.equal(payload.command, 'hermes kanban list');
  assert.match(payload.details, /\[redacted\]/i);
});

test('kanban assignment treats none as unassigned in direct DB mode', async (t) => {
  useTempKanbanHome(t);

  const task = await createTask(null, { title: 'Assignment hardening', assignee: 'Ada' });
  assert.equal(task.assignee, 'ada');

  await taskAction(null, undefined, task.id, ['assign', task.id, 'none']);
  const detail = await showTask(null, undefined, task.id);

  assert.equal(detail.assignee, null);
});

test('taskLog clamps invalid tail values and serializes event payloads', async (t) => {
  useTempKanbanHome(t);

  const task = await createTask(null, { title: 'Log hardening' });
  for (let index = 0; index < 240; index += 1) {
    await taskAction(null, undefined, task.id, ['comment', task.id, `note ${index}`, '--author', 'tester']);
  }

  const full = await taskLog(null, undefined, task.id, 200000);
  assert.ok(full.content.length > 12000);
  assert.doesNotMatch(full.content, /\[object Object\]/);

  const compact = await taskLog(null, undefined, task.id, 160);
  assert.ok(compact.content.length <= 160);

  const invalid = await taskLog(null, undefined, task.id, 'not-a-number');
  assert.ok(invalid.content.length <= 12000);
  assert.doesNotMatch(invalid.content, /\[object Object\]/);
});
