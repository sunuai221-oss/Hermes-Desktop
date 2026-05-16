import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { createPawrtalService } from '../services/pawrtal.mjs';

function createHermes() {
  return {
    home: path.join(process.cwd(), '.tmp-hermes-home', '.hermes'),
  };
}

function expectedStateDir(hermes) {
  return path.join(path.dirname(hermes.home), '.pawrtal', 'state', 'hermes');
}

function assertInsideStateDir(filePath, stateDir) {
  const relative = path.relative(path.resolve(stateDir), path.resolve(filePath));
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `${filePath} escaped ${stateDir}`,
  );
}

function createMemoryFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const reads = [];
  const unlinks = [];

  return {
    reads,
    unlinks,
    async readFile(filePath) {
      reads.push(filePath);
      if (!files.has(filePath)) {
        const error = new Error(`ENOENT: ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(filePath);
    },
    async unlink(filePath) {
      unlinks.push(filePath);
      if (!files.has(filePath)) {
        const error = new Error(`ENOENT: ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }
      files.delete(filePath);
    },
  };
}

function createExecMock(handler) {
  const calls = [];
  return {
    calls,
    async execFileAsync(file, args, options) {
      calls.push({ file, args, options, script: args.at(-1) });
      return handler({ file, args, options, script: args.at(-1), calls });
    },
  };
}

async function withCleanPawrtalEnv(run) {
  const previousPawrtalHome = process.env.PAWRTAL_HOME;
  const previousDistro = process.env.HERMES_WSL_DISTRO;
  delete process.env.PAWRTAL_HOME;
  delete process.env.HERMES_WSL_DISTRO;

  try {
    await run();
  } finally {
    if (previousPawrtalHome === undefined) delete process.env.PAWRTAL_HOME;
    else process.env.PAWRTAL_HOME = previousPawrtalHome;

    if (previousDistro === undefined) delete process.env.HERMES_WSL_DISTRO;
    else process.env.HERMES_WSL_DISTRO = previousDistro;
  }
}

test('pawrtal service lists companions through the CLI JSON output', async () => {
  await withCleanPawrtalEnv(async () => {
    const fs = createMemoryFs();
    const { calls, execFileAsync } = createExecMock(({ file, args, options, script }) => {
      assert.equal(file, 'wsl.exe');
      assert.deepEqual(args.slice(0, 4), ['-d', 'Ubuntu', '-e', 'bash']);
      assert.equal(options.windowsHide, true);
      assert.match(script, /'list' '--json'/);
      return {
        stdout: JSON.stringify({
          companions: [{
            id: 'veyra',
            displayName: 'Veyra',
            description: 'Navigator',
            packDir: '/home/user/.pawrtal/packs/veyra',
          }],
        }),
        stderr: '',
      };
    });
    const service = createPawrtalService({ fs, execFileAsync });

    const result = await service.listCompanions(createHermes());

    assert.equal(result.ok, true);
    assert.equal(result.command, 'pawrtal list --json');
    assert.deepEqual(result.companions, [{
      id: 'veyra',
      displayName: 'Veyra',
      description: 'Navigator',
      packDir: '/home/user/.pawrtal/packs/veyra',
    }]);
    assert.equal(calls.length, 1);
  });
});

test('pawrtal service spawns and vanishes companions with sanitized arguments', async () => {
  await withCleanPawrtalEnv(async () => {
    const fs = createMemoryFs();
    const seenScripts = [];
    const { execFileAsync } = createExecMock(({ script }) => {
      seenScripts.push(script);
      return { stdout: '', stderr: '' };
    });
    const service = createPawrtalService({ fs, execFileAsync });
    const hermes = createHermes();

    const spawn = await service.spawnCompanion(hermes, { petId: 'Veyra', session: 'Studio' });
    const vanish = await service.vanishCompanion(hermes, { petId: 'Veyra', session: 'Studio' });

    assert.equal(spawn.ok, true);
    assert.equal(spawn.command, 'pawrtal spawn veyra --target hermes --session studio');
    assert.match(seenScripts[0], /'spawn' 'veyra' '--target' 'hermes' '--session' 'studio'/);
    assert.equal(vanish.ok, true);
    assert.equal(vanish.command, 'pawrtal vanish veyra --target hermes --session studio');
    assert.match(seenScripts[1], /'vanish' 'veyra' '--target' 'hermes' '--session' 'studio'/);
  });
});

test('pawrtal service reset vanishes, cleans state, and respawns the selected companion', async () => {
  await withCleanPawrtalEnv(async () => {
    const hermes = createHermes();
    const stateDir = expectedStateDir(hermes);
    const fs = createMemoryFs({
      [path.join(stateDir, 'current.json')]: JSON.stringify({ activePetId: 'veyra' }),
    });
    const { calls, execFileAsync } = createExecMock(({ script }) => {
      assert.ok(script.includes("'vanish'") || script.includes("'spawn'"));
      return { stdout: '', stderr: '' };
    });
    const service = createPawrtalService({ fs, execFileAsync });

    const result = await service.resetCompanion(hermes, { session: 'current' });

    assert.equal(result.ok, true);
    assert.equal(result.petId, 'veyra');
    assert.equal(result.vanish.command, 'pawrtal vanish --target hermes --session current');
    assert.equal(result.spawn.command, 'pawrtal spawn veyra --target hermes --session current');
    assert.equal(calls.length, 2);
    assert.ok(fs.unlinks.includes(path.join(stateDir, 'current.json')));
    for (const filePath of fs.unlinks) assertInsideStateDir(filePath, stateDir);
  });
});

test('pawrtal service autostart is a no-op when the desktop companion is already running', async () => {
  await withCleanPawrtalEnv(async () => {
    const hermes = createHermes();
    const stateDir = expectedStateDir(hermes);
    const fs = createMemoryFs({
      [path.join(stateDir, 'current.json')]: JSON.stringify({ activePetId: 'veyra' }),
      [path.join(stateDir, 'desktop-current.json')]: JSON.stringify({ pid: 4242, activePetId: 'veyra' }),
    });
    const { calls, execFileAsync } = createExecMock(({ script }) => {
      assert.match(script, /kill -0 '4242'/);
      return { stdout: 'running\n', stderr: '' };
    });
    const service = createPawrtalService({ fs, execFileAsync });

    const result = await service.autoStart(hermes, { session: 'current' });

    assert.equal(result.ok, true);
    assert.equal(result.autoStarted, false);
    assert.equal(result.alreadyRunning, true);
    assert.equal(calls.length, 1);
  });
});

test('pawrtal service reports missing CLI as a structured error instead of throwing', async () => {
  await withCleanPawrtalEnv(async () => {
    const fs = createMemoryFs();
    const { execFileAsync } = createExecMock(() => {
      const error = new Error('Command failed');
      error.code = 127;
      error.stderr = 'pawrtal CLI not found in WSL PATH.';
      throw error;
    });
    const service = createPawrtalService({ fs, execFileAsync });

    const result = await service.listCompanions(createHermes());

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'pawrtal_cli_missing');
    assert.equal(result.httpStatus, 503);
    assert.equal(result.command, 'pawrtal list --json');
    assert.deepEqual(result.companions, []);
  });
});

test('pawrtal service propagates CLI errors from composed reset actions', async () => {
  await withCleanPawrtalEnv(async () => {
    const hermes = createHermes();
    const stateDir = expectedStateDir(hermes);
    const fs = createMemoryFs({
      [path.join(stateDir, 'current.json')]: JSON.stringify({ activePetId: 'veyra' }),
    });
    const { calls, execFileAsync } = createExecMock(() => {
      const error = new Error('Command failed');
      error.code = 127;
      error.stderr = 'pawrtal CLI not found in WSL PATH.';
      throw error;
    });
    const service = createPawrtalService({ fs, execFileAsync });

    const result = await service.resetCompanion(hermes, { session: 'current' });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'pawrtal_cli_missing');
    assert.equal(result.httpStatus, 503);
    assert.equal(result.spawn.errorCode, 'pawrtal_cli_missing');
    assert.equal(calls.length, 2);
  });
});

test('pawrtal service keeps hostile session state paths inside the Pawrtal state directory', async () => {
  await withCleanPawrtalEnv(async () => {
    const hermes = createHermes();
    const stateDir = expectedStateDir(hermes);
    const fs = createMemoryFs();
    const { execFileAsync } = createExecMock(() => ({ stdout: '', stderr: '' }));
    const service = createPawrtalService({ fs, execFileAsync });

    const status = await service.readStatus(hermes, '../../outside');
    const reset = await service.resetCompanion(hermes, { petId: 'veyra', session: '../../outside' });

    assert.equal(status.session, 'current');
    assert.equal(reset.session, 'current');
    for (const filePath of fs.reads) assertInsideStateDir(filePath, stateDir);
    for (const filePath of fs.unlinks) assertInsideStateDir(filePath, stateDir);
  });
});

test('pawrtal service rejects invalid companion ids before invoking the CLI', async () => {
  await withCleanPawrtalEnv(async () => {
    const fs = createMemoryFs();
    const { calls, execFileAsync } = createExecMock(() => {
      throw new Error('CLI should not be called');
    });
    const service = createPawrtalService({ fs, execFileAsync });

    const result = await service.switchCompanion(createHermes(), { petId: '../outside' });

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'pawrtal_invalid_pet_id');
    assert.equal(result.httpStatus, 400);
    assert.equal(calls.length, 0);
  });
});
