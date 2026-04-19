import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import yaml from 'yaml';

import { createAgentsService } from '../services/agents.mjs';
import { createRuntimeFilesService } from '../services/runtime-files.mjs';

const runtimeFilesService = createRuntimeFilesService({ fs, yaml });
const agentsService = createAgentsService({ fs, runtimeFilesService });

async function withHermesFiles(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-agents-config-'));
  const hermesHome = path.join(tempDir, '.hermes');
  const hermes = {
    home: hermesHome,
    paths: {
      config: path.join(hermesHome, 'config.yaml'),
      appState: path.join(tempDir, '.hermes-builder'),
      agents: path.join(tempDir, '.hermes-builder', 'agents.json'),
      soul: path.join(hermesHome, 'SOUL.md'),
    },
  };

  await fs.mkdir(hermesHome, { recursive: true });
  await fs.writeFile(hermes.paths.config, '', 'utf-8');
  await fs.writeFile(hermes.paths.soul, '', 'utf-8');

  try {
    await run(hermes);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('runtime files service reads and writes config plus ensures appState storage', async () => {
  await withHermesFiles(async hermes => {
    await runtimeFilesService.ensureAppStateDir(hermes);
    await fs.access(hermes.paths.appState);

    await runtimeFilesService.writeYamlConfig(hermes, {
      model: { default: 'qwen3.5:27b' },
      tts: { edge: { voice: 'en-US-AriaNeural' } },
    });

    const config = await runtimeFilesService.readYamlConfig(hermes);
    assert.equal(config.model.default, 'qwen3.5:27b');
    assert.equal(config.tts.edge.voice, 'en-US-AriaNeural');
  });
});

test('agents service stores profiles and applies the selected profile to soul and config', async () => {
  await withHermesFiles(async hermes => {
    const profiles = [{
      id: 'planner',
      name: 'Planner',
      soul: '# Planner Soul\n',
      personalityOverlay: 'Be direct and systematic.',
      defaultModel: 'gpt-5',
    }];

    await agentsService.writeAgentProfiles(hermes, profiles);
    assert.deepEqual(await agentsService.readAgentProfiles(hermes), profiles);

    await runtimeFilesService.writeYamlConfig(hermes, {
      agent: { personalities: { Existing: 'Keep me.' } },
      model: { default: 'old-model' },
    });

    const result = await agentsService.applyAgentProfile(hermes, 'planner');

    assert.equal(result.success, true);
    assert.equal(result.applied.id, 'planner');
    assert.equal(result.applied.updatedConfig, true);

    const soul = await fs.readFile(hermes.paths.soul, 'utf-8');
    assert.equal(soul, '# Planner Soul\n');

    const config = await runtimeFilesService.readYamlConfig(hermes);
    assert.equal(config.agent.personalities.Existing, 'Keep me.');
    assert.equal(config.agent.personalities.Planner, 'Be direct and systematic.');
    assert.equal(config.model.default, 'gpt-5');

    const storedProfiles = await agentsService.readAgentProfiles(hermes);
    assert.match(storedProfiles[0].lastAppliedAt || '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(storedProfiles[0].updatedAt || '', /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('agents service returns a 404-style error when applying an unknown profile', async () => {
  await withHermesFiles(async hermes => {
    await assert.rejects(
      () => agentsService.applyAgentProfile(hermes, 'missing'),
      error => error?.statusCode === 404 && error.message === 'Agent profile not found'
    );
  });
});
