import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { after, before, test } from 'node:test';

const { app, initializeApp, isAllowedOrigin, isLocalRequest } = await import('../index.mjs');

let server = null;
let baseUrl = '';

before(async () => {
  await initializeApp();
  server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

test('isAllowedOrigin only accepts loopback browser origins', () => {
  assert.equal(isAllowedOrigin(undefined), true);
  assert.equal(isAllowedOrigin('http://localhost:3030'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:3020'), true);
  assert.equal(isAllowedOrigin('http://[::1]:8642'), true);
  assert.equal(isAllowedOrigin('https://example.com'), false);
  assert.equal(isAllowedOrigin('not-a-url'), false);
});

test('isLocalRequest ignores spoofed forwarded headers by default', () => {
  assert.equal(isLocalRequest({
    headers: { 'x-forwarded-for': '127.0.0.1' },
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
  }), false);

  assert.equal(isLocalRequest({
    headers: {},
    ip: '::1',
    socket: { remoteAddress: '::1' },
  }), true);
});

test('desktop health remains available while CORS is restricted to loopback origins', async () => {
  const allowedOrigin = 'http://localhost:3030';
  const allowedResponse = await fetch(`${baseUrl}/api/desktop/health`, {
    headers: { Origin: allowedOrigin },
  });

  assert.equal(allowedResponse.status, 200);
  assert.equal(allowedResponse.headers.get('access-control-allow-origin'), allowedOrigin);

  const payload = await allowedResponse.json();
  assert.equal(payload.status, 'ok');
  assert.equal(payload.service, 'hermes-desktop-backend');
  assert.equal(typeof payload.pid, 'number');

  const blockedResponse = await fetch(`${baseUrl}/api/desktop/health`, {
    headers: { Origin: 'https://example.com' },
  });

  assert.equal(blockedResponse.status, 200);
  assert.equal(blockedResponse.headers.get('access-control-allow-origin'), null);
});
