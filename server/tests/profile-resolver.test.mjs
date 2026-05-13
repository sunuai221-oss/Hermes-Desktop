import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  getHermesHomeScore,
  resolveHermesHome,
  resolveProfilePaths,
} from '../services/profile-resolver.mjs';

test('getHermesHomeScore favors multi-profile Hermes roots', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-profile-score-'));
  const builderRoot = path.join(tempDir, '.hermes', 'hermes-builder');
  const builderParent = path.dirname(builderRoot);
  const explicitHome = path.join(tempDir, 'runtime-home');

  await fs.mkdir(path.join(builderParent, 'skills'), { recursive: true });
  await fs.mkdir(path.join(explicitHome, 'profiles', 'work'), { recursive: true });
  await fs.writeFile(path.join(builderParent, 'SOUL.md'), '# Local builder state\n', 'utf-8');
  await fs.writeFile(path.join(builderParent, 'config.yaml'), 'model: {}\n', 'utf-8');

  try {
    assert.ok(
      getHermesHomeScore(explicitHome) > getHermesHomeScore(builderParent),
      'multi-profile home should outrank builder-local fallback state'
    );

    const resolved = resolveHermesHome({
      builderRoot,
      distro: 'NoSuchDistro',
      env: { HERMES_HOME: explicitHome },
    });

    assert.equal(resolved, explicitHome);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('agent studio storage is global across runtime profiles', () => {
  const localStateHome = path.join(os.tmpdir(), 'hermes-local-state');
  const defaultPaths = resolveProfilePaths('default', path.join(os.tmpdir(), 'hermes'), localStateHome);
  const researchPaths = resolveProfilePaths('research', path.join(os.tmpdir(), 'hermes', 'profiles', 'research'), localStateHome);

  assert.equal(researchPaths.agentStudioDir, defaultPaths.agentStudioDir);
  assert.equal(researchPaths.agentStudioLibrary, defaultPaths.agentStudioLibrary);
  assert.equal(researchPaths.agentStudioWorkspaces, defaultPaths.agentStudioWorkspaces);
  assert.notEqual(researchPaths.agents, defaultPaths.agents);
});
