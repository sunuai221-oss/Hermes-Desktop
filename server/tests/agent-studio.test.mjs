import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import yaml from 'yaml';

import { createAgentStudioService } from '../services/agent-studio.mjs';

const agentStudioService = createAgentStudioService({ fs, path, yaml, bundledCatalogPath: null, autoSeedBundledCatalog: false });

function mockFetchResponse(body, { ok = true, status = 200, statusText = 'OK', json = typeof body !== 'string' } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => (json ? body : JSON.parse(body)),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

async function withHermesFiles(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-agent-studio-'));
  const appState = path.join(tempDir, '.hermes-builder');
  const hermes = {
    home: path.join(tempDir, '.hermes'),
    paths: {
      appState,
      agentStudioDir: path.join(appState, 'agent-studio'),
      agentStudioLibrary: path.join(appState, 'agent-studio', 'library.json'),
      agentStudioWorkspaces: path.join(appState, 'agent-studio', 'workspaces.json'),
    },
  };

  try {
    await run(hermes, tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('agent studio reads empty stores with schema version', async () => {
  await withHermesFiles(async hermes => {
    assert.deepEqual(await agentStudioService.readLibrary(hermes), {
      schemaVersion: 1,
      agents: [],
    });
    assert.deepEqual(await agentStudioService.readWorkspaces(hermes), {
      schemaVersion: 1,
      workspaces: [],
    });
  });
});

test('agent studio seeds the bundled offline catalog when the library is empty', async () => {
  await withHermesFiles(async (hermes, tempDir) => {
    const bundledCatalogPath = path.join(tempDir, 'agency-bundled.json');
    await fs.writeFile(bundledCatalogPath, JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-05-10T00:00:00.000Z',
      repoUrl: 'https://github.com/msitarzewski/agency-agents',
      branch: 'main',
      agents: [{
        id: 'agency_seeded',
        source: 'agency-agents',
        sourcePath: 'engineering/backend-architect.md',
        name: 'Backend Architect',
        slug: 'backend-architect',
        division: 'engineering',
        soul: 'Bundled soul',
        preferredSkills: [],
        preferredToolsets: [],
        tags: [],
        createdAt: '2026-05-10T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z',
      }],
    }, null, 2), 'utf-8');

    const service = createAgentStudioService({
      fs,
      path,
      yaml,
      bundledCatalogPath,
      autoSeedBundledCatalog: true,
    });

    const result = await service.readLibrary(hermes);
    const stored = JSON.parse(await fs.readFile(hermes.paths.agentStudioLibrary, 'utf-8'));

    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].name, 'Backend Architect');
    assert.match(String(stored.bundledCatalogSeededAt), /^2026|^20/);
  });
});

test('agent studio creates storage directory when writing', async () => {
  await withHermesFiles(async hermes => {
    const created = await agentStudioService.createAgent(hermes, {
      name: 'Planner',
      soul: '# Planner',
    });

    assert.equal(created.success, true);
    await fs.access(hermes.paths.agentStudioDir);
    const raw = JSON.parse(await fs.readFile(hermes.paths.agentStudioLibrary, 'utf-8'));
    assert.equal(raw.schemaVersion, 1);
    assert.equal(raw.agents[0].name, 'Planner');
  });
});

test('agency import parses frontmatter, body, divisions, and ignores excluded dirs', async () => {
  await withHermesFiles(async (hermes, tempDir) => {
    const agencyRoot = path.join(tempDir, 'agency-agents');
    await fs.mkdir(path.join(agencyRoot, 'engineering'), { recursive: true });
    await fs.mkdir(path.join(agencyRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(agencyRoot, 'engineering', 'backend-architect.md'), [
      '---',
      'name: Backend Architect',
      'description: Designs API boundaries',
      'color: blue',
      'emoji: BA',
      'vibe: rigorous',
      'tags:',
      '  - backend',
      '---',
      '# Identity',
      '',
      'Own the backend architecture.',
    ].join('\n'), 'utf-8');
    await fs.writeFile(path.join(agencyRoot, 'docs', 'ignored.md'), '# Ignored', 'utf-8');
    await fs.writeFile(path.join(agencyRoot, 'README.md'), '# Not an agent', 'utf-8');
    await fs.writeFile(path.join(agencyRoot, 'empty.md'), '', 'utf-8');

    const result = await agentStudioService.importAgencyAgents(hermes, { rootPath: agencyRoot });

    assert.equal(result.imported, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].name, 'Backend Architect');
    assert.equal(result.agents[0].description, 'Designs API boundaries');
    assert.equal(result.agents[0].division, 'engineering');
    assert.equal(result.agents[0].sourcePath, 'engineering/backend-architect.md');
    assert.match(result.agents[0].soul, /Own the backend architecture/);
  });
});

test('agency import upserts by source path and preserves ids', async () => {
  await withHermesFiles(async (hermes, tempDir) => {
    const agencyRoot = path.join(tempDir, 'agency-agents');
    await fs.mkdir(path.join(agencyRoot, 'creative'), { recursive: true });
    const agentPath = path.join(agencyRoot, 'creative', 'writer.md');
    await fs.writeFile(agentPath, '---\nname: Writer\n---\nFirst soul', 'utf-8');

    const first = await agentStudioService.importAgencyAgents(hermes, { rootPath: agencyRoot });
    const firstId = first.agents[0].id;

    await fs.writeFile(agentPath, '---\nname: Senior Writer\n---\nSecond soul', 'utf-8');
    const second = await agentStudioService.importAgencyAgents(hermes, { rootPath: agencyRoot });

    assert.equal(second.imported, 0);
    assert.equal(second.updated, 1);
    assert.equal(second.agents[0].id, firstId);
    assert.equal(second.agents[0].name, 'Senior Writer');
    assert.equal(second.agents[0].soul, 'Second soul');
  });
});

test('agency import can load the bundled offline catalog explicitly', async () => {
  await withHermesFiles(async (hermes, tempDir) => {
    const bundledCatalogPath = path.join(tempDir, 'agency-bundled.json');
    await fs.writeFile(bundledCatalogPath, JSON.stringify({
      schemaVersion: 1,
      generatedAt: '2026-05-10T00:00:00.000Z',
      repoUrl: 'https://github.com/msitarzewski/agency-agents',
      branch: 'main',
      agents: [{
        id: 'agency_unity_architect',
        source: 'agency-agents',
        sourcePath: 'game-development/unity/unity-architect.md',
        name: 'Unity Architect',
        slug: 'unity-architect',
        description: 'Designs Unity systems',
        division: 'game-development',
        soul: 'Build robust Unity systems.',
        preferredSkills: [],
        preferredToolsets: [],
        tags: [],
        createdAt: '2026-05-10T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z',
      }],
    }, null, 2), 'utf-8');

    const service = createAgentStudioService({
      fs,
      path,
      yaml,
      bundledCatalogPath,
      autoSeedBundledCatalog: false,
    });

    const result = await service.importAgencyAgents(hermes, { bundled: true });

    assert.equal(result.imported, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.agents[0].sourcePath, 'game-development/unity/unity-architect.md');
    assert.equal(result.agents[0].name, 'Unity Architect');
  });
});

test('bundled import refreshes managed catalog entries and preserves user templates', async () => {
  await withHermesFiles(async (hermes, tempDir) => {
    const bundledCatalogPath = path.join(tempDir, 'agency-bundled.json');
    await fs.mkdir(hermes.paths.agentStudioDir, { recursive: true });
    await fs.writeFile(hermes.paths.agentStudioLibrary, JSON.stringify({
      schemaVersion: 1,
      agents: [
        {
          id: 'agency_backend_old',
          source: 'agency-agents',
          sourcePath: 'engineering/backend-architect.md',
          name: 'Old Backend Architect',
          slug: 'backend-architect',
          division: 'engineering',
          soul: 'Old soul',
          preferredSkills: [],
          preferredToolsets: [],
          tags: [],
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
        {
          id: 'agency_stale_security',
          source: 'agency-agents',
          sourcePath: 'SECURITY.md',
          name: 'Security',
          slug: 'security',
          division: 'SECURITY.md',
          soul: 'Security policy, not an agent',
          preferredSkills: [],
          preferredToolsets: [],
          tags: [],
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
        {
          id: 'user_custom',
          source: 'user',
          name: 'Custom Local Agent',
          slug: 'custom-local-agent',
          division: 'custom',
          soul: 'Keep this user template',
          preferredSkills: [],
          preferredToolsets: [],
          tags: [],
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
      ],
      bundledCatalogSeededAt: '2026-05-10T00:00:00.000Z',
    }, null, 2), 'utf-8');

    await fs.writeFile(bundledCatalogPath, JSON.stringify({
      agents: [
        {
          id: 'agency_backend_new',
          source: 'agency-agents',
          sourcePath: 'engineering/backend-architect',
          name: 'Backend Architect',
          slug: 'backend-architect',
          division: 'engineering',
          soul: 'New bundled soul',
          preferredSkills: [],
          preferredToolsets: [],
          tags: [],
        },
        {
          id: 'agency_cai_blue',
          source: 'aliasrobotics-cai',
          sourcePath: 'src/cai/prompts/system_blue_team_agent',
          name: 'Blue Team Agent',
          slug: 'blue-team-agent',
          division: 'security',
          soul: 'Cyber defense soul',
          preferredSkills: [],
          preferredToolsets: [],
          tags: ['security'],
        },
      ],
    }, null, 2), 'utf-8');

    const service = createAgentStudioService({
      fs,
      path,
      yaml,
      bundledCatalogPath,
      autoSeedBundledCatalog: false,
    });

    const result = await service.importAgencyAgents(hermes, { bundled: true });

    assert.equal(result.imported, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.agents.length, 3);
    assert.equal(result.agents.some(agent => agent.sourcePath === 'SECURITY.md'), false);

    const backend = result.agents.find(agent => agent.slug === 'backend-architect');
    assert.equal(backend.id, 'agency_backend_old');
    assert.equal(backend.sourcePath, 'engineering/backend-architect');
    assert.equal(backend.soul, 'New bundled soul');

    const cyber = result.agents.find(agent => agent.slug === 'blue-team-agent');
    assert.equal(cyber.source, 'aliasrobotics-cai');
    assert.equal(cyber.division, 'security');

    const custom = result.agents.find(agent => agent.id === 'user_custom');
    assert.equal(custom.name, 'Custom Local Agent');
  });
});

test('bulk preferred skill updates write the agent library once', async () => {
  await withHermesFiles(async hermes => {
    const first = await agentStudioService.createAgent(hermes, {
      name: 'Researcher',
      soul: '# Researcher',
      preferredSkills: ['arxiv'],
    });
    const second = await agentStudioService.createAgent(hermes, {
      name: 'Designer',
      soul: '# Designer',
      preferredSkills: [],
    });

    const result = await agentStudioService.updatePreferredSkills(hermes, {
      updates: [
        { id: first.agent.id, preferredSkills: ['arxiv', 'llm-wiki'] },
        { id: second.agent.id, preferredSkills: ['design-md'] },
        { id: 'missing-agent', preferredSkills: ['ignored'] },
      ],
    });

    assert.equal(result.updated, 2);
    assert.equal(result.skipped, 1);
    assert.deepEqual(
      result.agents.find(agent => agent.id === first.agent.id)?.preferredSkills,
      ['arxiv', 'llm-wiki'],
    );
    assert.deepEqual(
      result.agents.find(agent => agent.id === second.agent.id)?.preferredSkills,
      ['design-md'],
    );
  });
});

test('agency import can sync a GitHub repository without a local clone', async () => {
  await withHermesFiles(async hermes => {
    const service = createAgentStudioService({
      fs,
      path,
      yaml,
      bundledCatalogPath: null,
      autoSeedBundledCatalog: false,
      fetchImpl: async (url) => {
        if (url === 'https://api.github.com/repos/msitarzewski/agency-agents') {
          return mockFetchResponse({ default_branch: 'main' });
        }
        if (url === 'https://api.github.com/repos/msitarzewski/agency-agents/git/trees/main?recursive=1') {
          return mockFetchResponse({
            tree: [
              { path: 'engineering/backend-architect.md', type: 'blob' },
              { path: 'game-development/unity/unity-architect.md', type: 'blob' },
              { path: 'docs/ignore-me.md', type: 'blob' },
              { path: 'engineering/empty.md', type: 'blob' },
            ],
          });
        }
        if (url === 'https://raw.githubusercontent.com/msitarzewski/agency-agents/main/engineering/backend-architect.md') {
          return mockFetchResponse('---\nname: Backend Architect\n---\nOwn the backend architecture.', { json: false });
        }
        if (url === 'https://raw.githubusercontent.com/msitarzewski/agency-agents/main/game-development/unity/unity-architect.md') {
          return mockFetchResponse('---\nname: Unity Architect\ndescription: Owns the Unity runtime\n---\nDesign the Unity game loop.', { json: false });
        }
        if (url === 'https://raw.githubusercontent.com/msitarzewski/agency-agents/main/engineering/empty.md') {
          return mockFetchResponse('', { json: false });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    const result = await service.importAgencyAgents(hermes, {
      repoUrl: 'https://github.com/msitarzewski/agency-agents',
    });

    assert.equal(result.imported, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.agents.length, 2);
    assert.equal(result.agents[0].division, 'engineering');
    assert.equal(result.agents[0].sourcePath, 'engineering/backend-architect.md');
    assert.equal(result.agents[1].division, 'game-development');
    assert.equal(result.agents[1].sourcePath, 'game-development/unity/unity-architect.md');
    assert.match(result.agents[1].soul, /Unity game loop/);
  });
});

test('applying an agent definition writes the active profile soul and model', async () => {
  await withHermesFiles(async (hermes, tempDir) => {
    hermes.profile = 'research';
    hermes.paths.soul = path.join(tempDir, 'SOUL.md');
    hermes.paths.config = path.join(tempDir, 'config.yaml');

    const writes = [];
    const service = createAgentStudioService({
      fs,
      path,
      yaml,
      bundledCatalogPath: null,
      autoSeedBundledCatalog: false,
      runtimeFilesService: {
        readYamlConfig: async () => ({ model: { provider: 'ollama' } }),
        writeYamlConfig: async (_hermes, config) => {
          writes.push(config);
          await fs.writeFile(hermes.paths.config, yaml.stringify(config), 'utf-8');
        },
      },
    });

    const created = await service.createAgent(hermes, {
      name: 'Researcher',
      soul: '# Researcher',
      defaultModel: 'qwen3',
    });

    const result = await service.applyAgent(hermes, created.agent.id);

    assert.equal(result.success, true);
    assert.equal(result.applied.profile, 'research');
    assert.equal(await fs.readFile(hermes.paths.soul, 'utf-8'), '# Researcher');
    assert.equal(writes[0].model.default, 'qwen3');
  });
});

test('workspace CRUD persists nodes, roles, positions, and shared context', async () => {
  await withHermesFiles(async hermes => {
    const created = await agentStudioService.createWorkspace(hermes, {
      name: 'Launch Team',
      sharedContext: 'Ship the feature',
      commonRules: 'Keep evidence',
      nodes: [{
        id: 'node-1',
        agentId: 'agent-1',
        role: 'reviewer',
        position: { x: 120, y: 80 },
      }],
      edges: [{
        id: 'edge-dangling',
        fromNodeId: 'node-1',
        toNodeId: 'missing-node',
        kind: 'handoff',
      }],
    });

    const updated = await agentStudioService.updateWorkspace(hermes, created.workspace.id, {
      ...created.workspace,
      nodes: [
        { ...created.workspace.nodes[0], role: 'qa', position: { x: 200, y: 140 } },
        { id: 'node-2', agentId: 'agent-2', role: 'worker', position: { x: 320, y: 140 } },
      ],
      edges: [{ id: 'edge-1', fromNodeId: 'node-1', toNodeId: 'node-2', kind: 'review' }],
    });
    const store = await agentStudioService.readWorkspaces(hermes);

    assert.equal(store.workspaces.length, 1);
    assert.equal(updated.workspace.nodes[0].role, 'qa');
    assert.deepEqual(updated.workspace.nodes[0].position, { x: 200, y: 140 });
    assert.equal(updated.workspace.edges[0].kind, 'review');
    assert.equal(store.workspaces[0].sharedContext, 'Ship the feature');

    await agentStudioService.deleteWorkspace(hermes, created.workspace.id);
    assert.equal((await agentStudioService.readWorkspaces(hermes)).workspaces.length, 0);
  });
});

test('workspace prompt includes context, roles, agents, souls, and missing definitions', async () => {
  await withHermesFiles(async hermes => {
    const agent = await agentStudioService.createAgent(hermes, {
      name: 'Reviewer',
      description: 'Reviews implementation quality',
      soul: '# Reviewer Soul',
    });
    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Review Workspace',
      sharedContext: 'Review a code change',
      commonRules: 'Be specific',
      nodes: [
        {
          id: 'node-reviewer',
          agentId: agent.agent.id,
          role: 'reviewer',
          label: 'Primary Reviewer',
          skills: ['code-review'],
          toolsets: ['file'],
          position: { x: 10, y: 20 },
        },
        {
          id: 'node-missing',
          agentId: 'missing-agent',
          role: 'qa',
          position: { x: 40, y: 60 },
        },
      ],
      edges: [{
        fromNodeId: 'node-reviewer',
        toNodeId: 'node-missing',
        kind: 'qa',
      }],
    });

    const result = await agentStudioService.generateWorkspacePrompt(hermes, workspace.workspace.id);

    assert.match(result.prompt, /Review Workspace/);
    assert.match(result.prompt, /Review a code change/);
    assert.match(result.prompt, /Primary Reviewer \(reviewer\)/);
    assert.match(result.prompt, /Primary Reviewer -> Missing agent definition \(qa\)/);
    assert.match(result.prompt, /# Reviewer Soul/);
    assert.match(result.prompt, /Missing agent definition for missing-agent/);
  });
});

test('workspace chat executes prompt mode with task and relations', async () => {
  await withHermesFiles(async hermes => {
    const planner = await agentStudioService.createAgent(hermes, {
      name: 'Planner',
      soul: '# Planner Soul',
    });
    const reviewer = await agentStudioService.createAgent(hermes, {
      name: 'Reviewer',
      soul: '# Reviewer Soul',
    });
    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Interface Workspace',
      defaultMode: 'prompt',
      nodes: [
        { id: 'node-planner', agentId: planner.agent.id, role: 'orchestrator', position: { x: 10, y: 20 } },
        { id: 'node-reviewer', agentId: reviewer.agent.id, role: 'reviewer', position: { x: 260, y: 20 } },
      ],
      edges: [{ fromNodeId: 'node-planner', toNodeId: 'node-reviewer', kind: 'review' }],
    });

    const calls = [];
    const result = await agentStudioService.chatWorkspace(hermes, workspace.workspace.id, {
      task: 'Draft a launch plan.',
    }, {
      postGatewayChatCompletion: async (_hermes, body) => {
        calls.push(body);
        return { choices: [{ message: { content: 'workspace answer' } }] };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, 'prompt');
    assert.equal(result.output, 'workspace answer');
    assert.equal(calls[0].source, 'agent-studio-workspace-interface');
    assert.match(calls[0].messages[0].content, /Draft a launch plan/);
    assert.match(calls[0].messages[0].content, /Planner -> Reviewer \(review\)/);
  });
});


test('workspace delegate execution calls gateway with delegate bridge prompt', async () => {
  await withHermesFiles(async hermes => {
    const agent = await agentStudioService.createAgent(hermes, {
      name: 'Implementer',
      soul: '# Implementer Soul',
      preferredToolsets: ['terminal'],
    });
    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Delegate Workspace',
      defaultMode: 'delegate',
      sharedContext: 'Build the feature',
      nodes: [{ agentId: agent.agent.id, role: 'worker', position: { x: 1, y: 2 } }],
    });

    const calls = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, {}, {
      postGatewayChatCompletion: async (_hermes, body) => {
        calls.push(body);
        return { choices: [{ message: { content: 'delegate done' } }] };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, 'delegate');
    assert.equal(result.output, 'delegate done');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, 'agent-studio-delegate');
    assert.match(calls[0].messages[0].content, /delegate_task/);
    assert.match(calls[0].messages[0].content, /Delegate Workspace/);
  });
});

test('workspace profile execution dispatches nodes to configured profiles', async () => {
  await withHermesFiles(async hermes => {
    hermes.profile = 'default';
    const agent = await agentStudioService.createAgent(hermes, {
      name: 'Reviewer',
      soul: '# Reviewer Soul',
    });
    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Profile Workspace',
      defaultMode: 'profiles',
      nodes: [{
        id: 'node-profile',
        agentId: agent.agent.id,
        role: 'reviewer',
        label: 'Runtime Reviewer',
        profileName: 'review-profile',
        modelOverride: 'review-model',
        position: { x: 1, y: 2 },
      }],
    });

    const calls = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, {}, {
      getHermesContext: async profileName => ({ ...hermes, profile: profileName }),
      postGatewayChatCompletion: async (targetHermes, body) => {
        calls.push({ profile: targetHermes.profile, body });
        return { choices: [{ message: { content: `ran on ${targetHermes.profile}` } }] };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, 'profiles');
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].profileName, 'review-profile');
    assert.equal(result.runs[0].output, 'ran on review-profile');
    assert.equal(calls[0].profile, 'review-profile');
    assert.equal(calls[0].body.model, 'review-model');
    assert.match(calls[0].body.messages[0].content, /Runtime Reviewer/);
  });
});
