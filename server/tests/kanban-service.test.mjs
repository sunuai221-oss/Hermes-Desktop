import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VALID_STATUSES, sendKanbanError } from '../services/kanban.mjs';

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
