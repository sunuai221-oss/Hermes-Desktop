import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import yaml from 'yaml';

import { computeNextRunAt, createCronJobsService } from '../services/cronjobs.mjs';
import { createPluginsService } from '../services/plugins.mjs';

async function withTempDir(prefix, run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(tempDir);
  } finally {
    delete process.env.HERMES_ENABLE_PROJECT_PLUGINS;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('plugins service lists user and project plugins with policy and disabled-state applied', async () => {
  await withTempDir('hermes-plugins-', async tempDir => {
    const hermes = {
      home: path.join(tempDir, '.hermes'),
    };
    const workspaceRoot = path.join(tempDir, 'workspace');
    const userPluginsDir = path.join(hermes.home, 'plugins');
    const projectPluginsDir = path.join(workspaceRoot, '.hermes', 'plugins');
    await fs.mkdir(userPluginsDir, { recursive: true });
    await fs.mkdir(projectPluginsDir, { recursive: true });

    const alphaDir = path.join(userPluginsDir, 'alpha');
    const betaDir = path.join(userPluginsDir, 'beta');
    const gammaDir = path.join(projectPluginsDir, 'gamma');
    await fs.mkdir(alphaDir, { recursive: true });
    await fs.mkdir(betaDir, { recursive: true });
    await fs.mkdir(gammaDir, { recursive: true });

    await fs.writeFile(path.join(alphaDir, 'plugin.yaml'), `name: Alpha
version: 1.0.0
description: User plugin
requires_env:
  - ALPHA_KEY
`, 'utf-8');
    await fs.writeFile(path.join(alphaDir, '__init__.py'), '# alpha\n', 'utf-8');

    await fs.writeFile(path.join(betaDir, 'plugin.yaml'), `name: Beta
description: Disabled plugin
`, 'utf-8');

    await fs.writeFile(path.join(gammaDir, 'plugin.yaml'), `name: Gamma
description: Project plugin
`, 'utf-8');
    await fs.writeFile(path.join(gammaDir, 'schemas.py'), '# gamma schemas\n', 'utf-8');
    await fs.writeFile(path.join(gammaDir, 'tools.py'), '# gamma tools\n', 'utf-8');

    const pluginsService = createPluginsService({
      fs,
      path,
      yaml,
      readConfigForSkills: async () => ({ plugins: { disabled: ['Beta'] } }),
      workspaceRoot,
    });

    process.env.HERMES_ENABLE_PROJECT_PLUGINS = 'false';
    const initial = await pluginsService.listPlugins(hermes);
    assert.equal(initial.projectPluginsEnabled, false);
    assert.deepEqual(initial.plugins.map(plugin => plugin.name), ['Alpha', 'Beta', 'Gamma']);
    assert.equal(initial.plugins.find(plugin => plugin.name === 'Alpha')?.enabled, true);
    assert.equal(initial.plugins.find(plugin => plugin.name === 'Alpha')?.hasInitPy, true);
    assert.deepEqual(initial.plugins.find(plugin => plugin.name === 'Alpha')?.requiresEnv, ['ALPHA_KEY']);
    assert.equal(initial.plugins.find(plugin => plugin.name === 'Beta')?.enabled, false);
    assert.equal(initial.plugins.find(plugin => plugin.name === 'Gamma')?.enabled, false);
    assert.equal(initial.plugins.find(plugin => plugin.name === 'Gamma')?.hasSchemasPy, true);
    assert.equal(initial.plugins.find(plugin => plugin.name === 'Gamma')?.hasToolsPy, true);

    process.env.HERMES_ENABLE_PROJECT_PLUGINS = 'true';
    const withProjectEnabled = await pluginsService.listPlugins(hermes);
    assert.equal(withProjectEnabled.projectPluginsEnabled, true);
    assert.equal(withProjectEnabled.plugins.find(plugin => plugin.name === 'Gamma')?.enabled, true);
  });
});

test('computeNextRunAt supports delay, every, iso and paused schedules', () => {
  assert.match(computeNextRunAt('15m') || '', /^\d{4}-\d{2}-\d{2}T/);
  assert.match(computeNextRunAt('every 2h') || '', /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(computeNextRunAt('2026-04-16T10:30:00.000Z'), '2026-04-16T10:30:00.000Z');
  assert.equal(computeNextRunAt('1d', true), null);
  assert.equal(computeNextRunAt('not-a-schedule'), null);
});

test('cron jobs service persists object-wrapped jobs and supports lifecycle operations', async () => {
  await withTempDir('hermes-cron-', async tempDir => {
    const hermes = {
      paths: {
        cronJobs: path.join(tempDir, 'cron', 'jobs.json'),
        cronOutput: path.join(tempDir, 'cron', 'output'),
      },
    };
    const cronJobsService = createCronJobsService({ fs, path });
    await fs.mkdir(hermes.paths.cronOutput, { recursive: true });

    const existingJob = {
      id: 'job-alpha',
      name: 'Alpha',
      prompt: 'Do alpha work',
      schedule: '1h',
      repeat: null,
      delivery: 'local',
      skills: ['alpha'],
      paused: false,
      next_run_at: '2026-04-16T10:00:00.000Z',
      last_run_at: null,
      created_at: '2026-04-16T09:00:00.000Z',
      updated_at: '2026-04-16T09:00:00.000Z',
      force_run: false,
    };
    await fs.mkdir(path.dirname(hermes.paths.cronJobs), { recursive: true });
    await fs.writeFile(hermes.paths.cronJobs, JSON.stringify({ jobs: [existingJob] }, null, 2), 'utf-8');

    const created = await cronJobsService.createCronJob(hermes, {
      name: 'Beta',
      prompt: 'Do beta work',
      schedule: 'every 30m',
      delivery: 'local',
      skills: ['beta'],
    });
    assert.equal(created.name, 'Beta');

    const updated = await cronJobsService.updateCronJob(hermes, 'job-alpha', {
      schedule: '2h',
      paused: true,
    });
    assert.equal(updated.schedule, '2h');
    assert.equal(updated.paused, true);
    assert.equal(updated.next_run_at, null);

    await cronJobsService.resumeCronJob(hermes, 'job-alpha');
    let jobs = await cronJobsService.listCronJobs(hermes);
    assert.equal(jobs.find(job => job.id === 'job-alpha')?.paused, false);
    assert.match(jobs.find(job => job.id === 'job-alpha')?.next_run_at || '', /^\d{4}-\d{2}-\d{2}T/);

    await cronJobsService.runCronJob(hermes, 'job-alpha');
    jobs = await cronJobsService.listCronJobs(hermes);
    assert.equal(jobs.find(job => job.id === 'job-alpha')?.force_run, true);

    await cronJobsService.pauseCronJob(hermes, 'job-alpha');
    jobs = await cronJobsService.listCronJobs(hermes);
    assert.equal(jobs.find(job => job.id === 'job-alpha')?.paused, true);

    await cronJobsService.removeCronJob(hermes, created.id);
    jobs = await cronJobsService.listCronJobs(hermes);
    assert.equal(jobs.some(job => job.id === created.id), false);

    const persisted = JSON.parse(await fs.readFile(hermes.paths.cronJobs, 'utf-8'));
    assert.equal(Array.isArray(persisted.jobs), true);
    assert.equal(Array.isArray(persisted), false);

    const outputDir = path.join(hermes.paths.cronOutput, 'job-alpha');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'latest.md'), 'alpha output'.repeat(200), 'utf-8');

    const outputs = await cronJobsService.listCronOutputs(hermes, 'job-alpha');
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].jobId, 'job-alpha');
    assert.equal(outputs[0].contentPreview.length, 2000);
  });
});

test('cron jobs service rejects invalid schedules with a 400 error', async () => {
  await withTempDir('hermes-cron-invalid-', async tempDir => {
    const hermes = {
      paths: {
        cronJobs: path.join(tempDir, 'cron', 'jobs.json'),
        cronOutput: path.join(tempDir, 'cron', 'output'),
      },
    };
    const cronJobsService = createCronJobsService({ fs, path });

    await assert.rejects(
      () => cronJobsService.createCronJob(hermes, {
        name: 'Broken',
        prompt: 'No schedule',
        schedule: 'someday',
      }),
      error => error?.statusCode === 400 && /Invalid schedule format/.test(error.message)
    );
  });
});
