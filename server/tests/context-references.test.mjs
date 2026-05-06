import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

import express from 'express';

import { registerContextReferenceRoutes } from '../routes/context-references.mjs';
import { createContextReferenceService } from '../services/context-references.mjs';

async function withWorkspace(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-context-references-'));
  const workspaceRoot = path.join(tempDir, 'workspace');
  const hermesHome = path.join(tempDir, '.hermes');
  const hermes = { home: hermesHome };

  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(hermesHome, { recursive: true });

  try {
    await run({ hermes, workspaceRoot, tempDir });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function createService({ workspaceRoot, axiosGet, dnsLookup, execFileAsync }) {
  return createContextReferenceService({
    fs,
    path,
    axios: {
      async get(url, options) {
        if (!axiosGet) throw new Error(`Unexpected axios.get(${url})`);
        return axiosGet(url, options);
      },
    },
    dns: {
      async lookup(hostname, options) {
        if (!dnsLookup) throw new Error(`Unexpected dns.lookup(${hostname})`);
        return dnsLookup(hostname, options);
      },
    },
    net,
    async execFileAsync(command, args, options) {
      if (!execFileAsync) throw new Error(`Unexpected execFileAsync(${command})`);
      return execFileAsync(command, args, options);
    },
    workspaceRoot,
  });
}

test('context reference service resolves file ranges relative to the workspace root', async () => {
  await withWorkspace(async ({ hermes, workspaceRoot }) => {
    await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'docs', 'guide.md'), 'one\ntwo\nthree\nfour\n', 'utf-8');

    const service = createService({ workspaceRoot });
    const resolved = await service.resolveContextReference(hermes, '@file:docs/guide.md:2-3');

    assert.deepEqual(resolved, {
      ref: '@file:docs/guide.md:2-3',
      kind: 'file',
      label: path.join('docs', 'guide.md'),
      content: 'two\nthree',
      warning: undefined,
      charCount: 'two\nthree'.length,
    });
  });
});

test('context reference service rejects sensitive credential paths', async () => {
  await withWorkspace(async ({ hermes, workspaceRoot }) => {
    await fs.writeFile(path.join(hermes.home, '.env'), 'SECRET=1\n', 'utf-8');
    const service = createService({ workspaceRoot });

    await assert.rejects(
      () => service.resolveContextReference(hermes, `@file:${path.relative(workspaceRoot, path.join(hermes.home, '.env'))}`),
      error => error.message === 'path is outside the allowed workspace'
    );

    await fs.mkdir(path.join(workspaceRoot, '.aws'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, '.aws', 'credentials'), 'token', 'utf-8');

    await assert.rejects(
      () => service.resolveContextReference(hermes, '@file:.aws/credentials'),
      error => error.message === 'path is a sensitive credential file'
    );
  });
});

test('context reference service blocks private or loopback URL targets before fetching', async () => {
  await withWorkspace(async ({ hermes, workspaceRoot }) => {
    const service = createService({
      workspaceRoot,
      dnsLookup: async () => [{ address: '127.0.0.1' }],
    });

    await assert.rejects(
      () => service.resolveContextReference(hermes, '@url:https://internal.example.test/docs'),
      error => error.message === 'private or loopback network hosts are not allowed'
    );
  });
});

test('context reference service clamps git previews and caps commit count at ten', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const largePatch = `${'A'.repeat(10000)}${'B'.repeat(4000)}`;
    const service = createService({
      workspaceRoot,
      execFileAsync: async (command, args, options) => {
        assert.equal(command, 'git');
        assert.deepEqual(args, ['log', '-10', '--patch', '--stat']);
        assert.deepEqual(options, { cwd: workspaceRoot });
        return { stdout: largePatch, stderr: '' };
      },
    });

    const resolved = await service.resolveContextReference({ home: workspaceRoot }, '@git:25');

    assert.equal(resolved.ref, '@git:10');
    assert.equal(resolved.kind, 'git');
    assert.equal(resolved.label, 'last 10 commits');
    assert.equal(resolved.warning, 'reference truncated at 12000 chars');
    assert.equal(resolved.charCount, largePatch.length);
    assert.match(resolved.content, /^A+/);
    assert.match(resolved.content, /reference preview truncated/);
    assert.match(resolved.content, /B+$/);
  });
});

test('context reference route preserves per-reference failures with inferred kinds', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.hermes = { home: 'C:\\Users\\example\\.hermes' };
    next();
  });

  registerContextReferenceRoutes({
    app,
    contextReferenceService: {
      inferReferenceKind(ref) {
        const value = String(ref || '');
        if (value.startsWith('@url:')) return 'url';
        return 'file';
      },
      async resolveContextReference(_hermes, ref) {
        if (ref === '@file:README.md') {
          return {
            ref,
            kind: 'file',
            label: 'README.md',
            content: 'hello',
            warning: undefined,
            charCount: 5,
          };
        }
        throw new Error('blocked');
      },
    },
  });

  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/context-references/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refs: ['@file:README.md', '@url:https://example.com'] }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      {
        ref: '@file:README.md',
        kind: 'file',
        label: 'README.md',
        content: 'hello',
        charCount: 5,
      },
      {
        ref: '@url:https://example.com',
        kind: 'url',
        label: '@url:https://example.com',
        content: '',
        warning: 'blocked',
        charCount: 0,
      },
    ]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
