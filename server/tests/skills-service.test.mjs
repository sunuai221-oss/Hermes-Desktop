import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import yaml from 'yaml';

import { createSkillsService } from '../services/skills.mjs';

const skillsService = createSkillsService({ fs, path, yaml });

async function withSkillsWorkspace(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-skills-'));
  const hermesHome = path.join(tempDir, '.hermes');
  const hermes = {
    home: hermesHome,
    paths: {
      skills: path.join(hermesHome, 'skills'),
      hooks: path.join(hermesHome, 'hooks'),
      config: path.join(hermesHome, 'config.yaml'),
    },
  };

  await fs.mkdir(hermes.paths.skills, { recursive: true });
  await fs.mkdir(hermes.paths.hooks, { recursive: true });
  await fs.writeFile(hermes.paths.config, '', 'utf-8');

  try {
    await run({ hermes, tempDir });
  } finally {
    delete process.env.HERMES_TEST_EXTERNAL_SKILLS;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('skills service can create, read, update, and delete a local skill safely', async () => {
  await withSkillsWorkspace(async ({ hermes }) => {
    const created = await skillsService.createLocalSkill(hermes, {
      name: 'Agent Planner',
      description: 'Plans the next execution steps.',
      category: 'Core Tools',
    });

    assert.match(created.path, /core-tools[\\/]agent-planner$/);
    assert.match(created.skillFile, /core-tools[\\/]agent-planner[\\/]SKILL\.md$/);

    const initial = await skillsService.readLocalSkill(hermes, created.path);
    assert.match(initial.content, /^---/);
    assert.match(initial.content, /# Agent Planner/);

    await skillsService.updateLocalSkill(hermes, created.path, '# Updated Skill\n');
    const updated = await skillsService.readLocalSkill(hermes, created.path);
    assert.equal(updated.content, '# Updated Skill\n');

    await skillsService.deleteLocalSkill(hermes, created.path);
    await assert.rejects(
      () => skillsService.readLocalSkill(hermes, created.path),
      error => error?.statusCode === 404 && error.message === 'Local skill not found'
    );
  });
});

test('skills service lists local and external skills while de-duplicating by name', async () => {
  await withSkillsWorkspace(async ({ hermes, tempDir }) => {
    await skillsService.createLocalSkill(hermes, {
      name: 'Alpha',
      description: 'Local alpha skill.',
    });

    const externalRoot = path.join(tempDir, 'external-skills');
    const alphaDir = path.join(externalRoot, 'alpha');
    const betaDir = path.join(externalRoot, 'beta');
    await fs.mkdir(alphaDir, { recursive: true });
    await fs.mkdir(betaDir, { recursive: true });
    await fs.writeFile(path.join(alphaDir, 'SKILL.md'), `---
name: Alpha
description: External duplicate
---

# Alpha
`, 'utf-8');
    await fs.writeFile(path.join(betaDir, 'SKILL.md'), `---
name: Beta
description: External beta
metadata:
  hermes:
    tags:
      - discovery
---

# Beta
`, 'utf-8');

    process.env.HERMES_TEST_EXTERNAL_SKILLS = externalRoot;
    await fs.writeFile(hermes.paths.config, `skills:
  external_dirs:
    - "\${HERMES_TEST_EXTERNAL_SKILLS}"
`, 'utf-8');

    const skills = await skillsService.listSkills(hermes);

    assert.equal(skills.length, 2);
    assert.deepEqual(skills.map(skill => skill.name), ['Alpha', 'Beta']);
    assert.equal(skills.find(skill => skill.name === 'Alpha')?.source, 'local');
    assert.deepEqual(skills.find(skill => skill.name === 'Beta')?.tags, ['discovery']);
  });
});

test('skills service lists gateway hooks with metadata and handler detection', async () => {
  await withSkillsWorkspace(async ({ hermes }) => {
    const deployHookDir = path.join(hermes.paths.hooks, 'deploy');
    const auditHookDir = path.join(hermes.paths.hooks, 'audit');
    await fs.mkdir(deployHookDir, { recursive: true });
    await fs.mkdir(auditHookDir, { recursive: true });

    await fs.writeFile(path.join(deployHookDir, 'HOOK.yaml'), `name: Deploy Hook
description: Runs deployment checks
events:
  - before_deploy
`, 'utf-8');
    await fs.writeFile(path.join(deployHookDir, 'handler.py'), 'print("ok")\n', 'utf-8');
    await fs.writeFile(path.join(auditHookDir, 'HOOK.yaml'), `description: Audit trail
events:
  - after_run
`, 'utf-8');

    const hooks = await skillsService.listGatewayHooks(hermes);

    assert.equal(hooks.length, 2);
    assert.deepEqual(hooks.map(hook => hook.name), ['audit', 'Deploy Hook']);
    assert.deepEqual(hooks[0].events, ['after_run']);
    assert.equal(hooks[1].hasHandler, true);
  });
});
