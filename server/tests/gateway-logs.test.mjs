import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readGatewayLogs } from '../routes/gateway.mjs';

test('gateway log reader prefers gateway logs over newer generic logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-gateway-logs-'));
  const logsDir = path.join(root, 'logs');
  const appState = path.join(root, 'app-state');
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(appState, { recursive: true });

  const gatewayLog = path.join(logsDir, 'gateway.log');
  const agentLog = path.join(logsDir, 'agent.log');
  await fs.writeFile(gatewayLog, 'gateway selected\n', 'utf-8');
  await fs.writeFile(agentLog, 'agent is newer\n', 'utf-8');

  const older = new Date('2026-05-06T10:00:00Z');
  const newer = new Date('2026-05-06T11:00:00Z');
  await fs.utimes(gatewayLog, older, older);
  await fs.utimes(agentLog, newer, newer);

  const logs = await readGatewayLogs(fs, {
    home: root,
    paths: { appState },
  });

  assert.equal(logs.path, gatewayLog);
  assert.match(logs.content, /gateway selected/);
});
