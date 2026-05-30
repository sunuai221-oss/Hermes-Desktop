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
      pipelineBrief: 'Planner leads backend then frontend then QA.',
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
    assert.equal(store.workspaces[0].pipelineBrief, 'Planner leads backend then frontend then QA.');
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

test('workspace auto-config preview normalizes model output into safe workspace patches', async () => {
  await withHermesFiles(async hermes => {
    const planner = await agentStudioService.createAgent(hermes, {
      name: 'Planner',
      soul: '# Planner Soul',
    });
    const implementer = await agentStudioService.createAgent(hermes, {
      name: 'Implementer',
      soul: '# Implementer Soul',
    });
    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Auto Config Workspace',
      nodes: [
        { id: 'node-planner', agentId: planner.agent.id, role: 'worker', position: { x: 10, y: 20 } },
        { id: 'node-implementer', agentId: implementer.agent.id, role: 'worker', position: { x: 260, y: 20 } },
      ],
    });

    const calls = [];
    const preview = await agentStudioService.previewWorkspaceAutoConfig(hermes, workspace.workspace.id, {
      pipelineBrief: 'Planner orchestrates, implementer builds, then review and QA.',
    }, {
      postGatewayChatCompletion: async (_hermes, body) => {
        calls.push(body);
        return ({
        choices: [{
          message: {
            content: [
              '```json',
              JSON.stringify({
                summary: 'Generated pipeline config',
                workspacePatch: {
                  defaultMode: 'delegate',
                  sharedContext: 'Deliver the feature with high confidence.',
                  commonRules: 'Escalate blockers quickly.',
                },
                nodes: [
                  { nodeId: 'node-planner', role: 'orchestrator', profileName: 'bad profile', skills: ['planning', 'synthesis'] },
                  { nodeId: 'node-implementer', role: 'worker', profileName: 'build-profile', toolsets: ['terminal', 'git'] },
                  { nodeId: 'node-missing', role: 'qa' },
                ],
                edges: [
                  { fromNodeId: 'node-planner', toNodeId: 'node-implementer', kind: 'handoff' },
                  { fromNodeId: 'node-planner', toNodeId: 'node-implementer', kind: 'handoff' },
                  { fromNodeId: 'node-implementer', toNodeId: 'node-planner', kind: 'review' },
                  { fromNodeId: 'node-implementer', toNodeId: 'node-ghost', kind: 'qa' },
                  { fromNodeId: 'node-planner', toNodeId: 'node-planner', kind: 'broadcast' },
                ],
              }, null, 2),
              '```',
            ].join('\n'),
          },
        }],
        });
      },
    });

    assert.equal(preview.success, true);
    assert.equal(preview.workspaceId, workspace.workspace.id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, 'agent-studio-auto-config');
    assert.equal(calls[0].workspace_id, workspace.workspace.id);
    assert.equal(calls[0].workspace_name, 'Auto Config Workspace');
    assert.equal(preview.suggestion.workspacePatch.defaultMode, 'delegate');
    assert.equal(preview.suggestion.nodes.length, 2);
    assert.equal(preview.suggestion.nodes[0].nodeId, 'node-planner');
    assert.equal(preview.suggestion.nodes[0].role, 'orchestrator');
    assert.equal(preview.suggestion.nodes[0].profileName, undefined);
    assert.equal(preview.suggestion.nodes[1].profileName, 'build-profile');
    assert.deepEqual(preview.suggestion.nodes[1].toolsets, ['terminal', 'git']);
    assert.deepEqual(preview.suggestion.nodes.map(node => node.nodeId), ['node-planner', 'node-implementer']);
    assert.equal(preview.suggestion.edges.length, 2);
    assert.equal(preview.suggestion.edges[0].fromNodeId, 'node-planner');
    assert.equal(preview.suggestion.edges[0].kind, 'handoff');
    assert.deepEqual(
      preview.suggestion.edges.map(edge => `${edge.fromNodeId}->${edge.toNodeId}:${edge.kind}`),
      ['node-planner->node-implementer:handoff', 'node-implementer->node-planner:review'],
    );
  });
});

test('workspace task runner executes prompt mode with task and relations', async () => {
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
    const started = [];
    const finished = [];
    assert.equal(typeof agentStudioService.chatWorkspace, 'function');
    const result = await agentStudioService.runWorkspaceTask(hermes, workspace.workspace.id, {
      task: 'Draft a launch plan.',
    }, {
      postGatewayChatCompletion: async (_hermes, body) => {
        calls.push(body);
        return { choices: [{ message: { content: 'workspace answer' } }] };
      },
      startWorkspaceRunSession: async (_hermes, payload) => {
        started.push(payload);
        return 'workspace-run-session';
      },
      finishWorkspaceRunSession: async (_hermes, payload) => {
        finished.push(payload);
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, 'prompt');
    assert.equal(result.output, 'workspace answer');
    assert.equal(result.session_id, 'workspace-run-session');
    assert.equal(calls[0].source, 'agent-studio-workspace-task-runner');
    assert.equal(calls[0].workspace_id, workspace.workspace.id);
    assert.equal(calls[0].workspace_name, 'Interface Workspace');
    assert.match(calls[0].messages[0].content, /Draft a launch plan/);
    assert.match(calls[0].messages[0].content, /Planner -> Reviewer \(review\)/);
    assert.equal(started.length, 1);
    assert.equal(started[0].source, 'agent-studio-workspace-task-runner');
    assert.equal(started[0].workspace.id, workspace.workspace.id);
    assert.match(started[0].userMessage, /Draft a launch plan/);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].sessionId, 'workspace-run-session');
    assert.equal(finished[0].toolResults.status, 'completed');
    assert.equal(finished[0].toolResults.mode, 'prompt');
    assert.equal(finished[0].toolResults.workspace.name, 'Interface Workspace');
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
    const started = [];
    const finished = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, {}, {
      postGatewayChatCompletion: async (_hermes, body) => {
        calls.push(body);
        return { choices: [{ message: { content: 'delegate done' } }] };
      },
      startWorkspaceRunSession: async (_hermes, payload) => {
        started.push(payload);
        return 'delegate-workspace-session';
      },
      finishWorkspaceRunSession: async (_hermes, payload) => {
        finished.push(payload);
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, 'delegate');
    assert.equal(result.output, 'delegate done');
    assert.equal(result.session_id, 'delegate-workspace-session');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, 'agent-studio-delegate');
    assert.equal(calls[0].workspace_id, workspace.workspace.id);
    assert.equal(calls[0].workspace_name, 'Delegate Workspace');
    assert.match(calls[0].messages[0].content, /delegate_task/);
    assert.match(calls[0].messages[0].content, /Delegate Workspace/);
    assert.equal(started.length, 1);
    assert.equal(started[0].source, 'agent-studio-delegate');
    assert.equal(finished.length, 1);
    assert.equal(finished[0].toolResults.mode, 'delegate');
    assert.equal(finished[0].toolResults.workspace.id, workspace.workspace.id);
  });
});

test('workspace profile execution uses topological edge order and returns structured node runs', async () => {
  await withHermesFiles(async hermes => {
    hermes.profile = 'default';
    const planner = await agentStudioService.createAgent(hermes, {
      name: 'Planner',
      soul: '# Planner Soul',
    });
    const reviewer = await agentStudioService.createAgent(hermes, {
      name: 'Reviewer',
      soul: '# Reviewer Soul',
    });
    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Profile Workspace',
      defaultMode: 'profiles',
      nodes: [
        {
          id: 'node-reviewer',
          agentId: reviewer.agent.id,
          role: 'reviewer',
          label: 'Runtime Reviewer',
          profileName: 'review-profile',
          modelOverride: 'review-model',
          position: { x: 1, y: 2 },
        },
        {
          id: 'node-planner',
          agentId: planner.agent.id,
          role: 'orchestrator',
          label: 'Runtime Planner',
          profileName: 'plan-profile',
          position: { x: 20, y: 30 },
        },
      ],
      edges: [
        { fromNodeId: 'node-planner', toNodeId: 'node-reviewer', kind: 'review' },
      ],
    });

    const calls = [];
    const started = [];
    const finished = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, {}, {
      getHermesContext: async profileName => ({ ...hermes, profile: profileName }),
      postGatewayChatCompletion: async (targetHermes, body) => {
        calls.push({ profile: targetHermes.profile, body });
        return { choices: [{ message: { content: `ran on ${targetHermes.profile}` } }] };
      },
      startWorkspaceRunSession: async (_hermes, payload) => {
        started.push(payload);
        return 'profile-workspace-session';
      },
      finishWorkspaceRunSession: async (_hermes, payload) => {
        finished.push(payload);
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.mode, 'profiles');
    assert.equal(result.status, 'completed');
    assert.equal(result.runs.length, 2);
    assert.equal(result.session_id, 'profile-workspace-session');

    // Topological order follows edge planner -> reviewer, even if node array order is reviewer then planner.
    assert.equal(result.runs[0].nodeId, 'node-planner');
    assert.equal(result.runs[1].nodeId, 'node-reviewer');

    assert.equal(result.runs[0].status, 'completed');
    assert.equal(result.runs[0].profileName, 'plan-profile');
    assert.equal(result.runs[0].output, 'ran on plan-profile');
    assert.match(result.runs[0].prompt, /Runtime Planner/);
    assert.match(result.runs[0].startedAt, /^20/);
    assert.match(result.runs[0].finishedAt, /^20/);
    assert.equal(result.runs[0].error, '');
    assert.deepEqual(result.runs[0].inputs, {
      handoff: [],
      review: [],
      qa: [],
      broadcast: [],
      escalation: [],
    });

    assert.equal(result.runs[1].status, 'completed');
    assert.equal(result.runs[1].profileName, 'review-profile');
    assert.equal(result.runs[1].output, 'ran on review-profile');
    assert.match(result.runs[1].prompt, /Runtime Reviewer/);
    assert.match(result.runs[1].startedAt, /^20/);
    assert.match(result.runs[1].finishedAt, /^20/);
    assert.equal(result.runs[1].error, '');
    assert.equal(result.runs[1].inputs.review.length, 1);
    assert.equal(result.runs[1].inputs.review[0].nodeId, 'node-planner');
    assert.equal(result.runs[1].inputs.review[0].output, 'ran on plan-profile');

    assert.equal(calls[0].profile, 'plan-profile');
    assert.equal(calls[0].body.workspace_id, workspace.workspace.id);
    assert.equal(calls[0].body.workspace_name, 'Profile Workspace');
    assert.equal(calls[1].profile, 'review-profile');
    assert.equal(calls[1].body.model, 'review-model');

    // Downstream reviewer prompt includes review input context and reviewer-specific guidance.
    assert.match(calls[1].body.messages[0].content, /Review Inputs/);
    assert.match(calls[1].body.messages[0].content, /ran on plan-profile/);
    assert.match(calls[1].body.messages[0].content, /Downstream Assembly Rules/);
    assert.match(calls[1].body.messages[0].content, /Reviewer Focus/);
    assert.equal(started.length, 1);
    assert.equal(started[0].source, 'agent-studio-profile-runtime');
    assert.equal(finished.length, 1);
    assert.equal(finished[0].toolResults.status, 'completed');
    assert.equal(finished[0].toolResults.runs.length, 2);
    assert.equal(finished[0].toolResults.runs[0].response, undefined);
  });
});

test('workspace creation rejects invalid node profile names', async () => {
  await withHermesFiles(async hermes => {
    const agent = await agentStudioService.createAgent(hermes, {
      name: 'Planner',
      soul: '# Planner Soul',
    });

    await assert.rejects(
      agentStudioService.createWorkspace(hermes, {
        name: 'Invalid Profile Workspace',
        defaultMode: 'profiles',
        nodes: [
          {
            agentId: agent.agent.id,
            role: 'worker',
            profileName: 'bad profile',
            position: { x: 1, y: 1 },
          },
        ],
      }),
      error => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /letters, numbers, ".", "_" and "-"/);
        return true;
      },
    );
  });
});

test('workspace profile execution falls back to the current app profile when a node is not pinned', async () => {
  await withHermesFiles(async hermes => {
    hermes.profile = 'ops-profile';
    const agent = await agentStudioService.createAgent(hermes, {
      name: 'Planner',
      soul: '# Planner Soul',
    });
    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Fallback Profile Workspace',
      defaultMode: 'profiles',
      nodes: [
        {
          id: 'node-planner',
          agentId: agent.agent.id,
          role: 'worker',
          label: 'Fallback Planner',
          position: { x: 1, y: 1 },
        },
      ],
    });

    const requestedProfiles = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, { task: 'Ship it' }, {
      getHermesContext: async profileName => {
        requestedProfiles.push(profileName);
        return { ...hermes, profile: profileName };
      },
      postGatewayChatCompletion: async (targetHermes) => ({
        choices: [{ message: { content: `ran on ${targetHermes.profile}` } }],
      }),
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].profileName, 'ops-profile');
    assert.equal(result.runs[0].output, 'ran on ops-profile');
    assert.deepEqual(requestedProfiles, []);
  });
});

test('workspace profile execution rejects cycles in workspace relations', async () => {
  await withHermesFiles(async hermes => {
    const first = await agentStudioService.createAgent(hermes, {
      name: 'First',
      soul: '# First Soul',
    });
    const second = await agentStudioService.createAgent(hermes, {
      name: 'Second',
      soul: '# Second Soul',
    });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Cyclic Profile Workspace',
      defaultMode: 'profiles',
      nodes: [
        { id: 'node-a', agentId: first.agent.id, role: 'worker', position: { x: 1, y: 2 } },
        { id: 'node-b', agentId: second.agent.id, role: 'worker', position: { x: 3, y: 4 } },
      ],
      edges: [
        { fromNodeId: 'node-a', toNodeId: 'node-b', kind: 'handoff' },
        { fromNodeId: 'node-b', toNodeId: 'node-a', kind: 'review' },
      ],
    });

    await assert.rejects(
      agentStudioService.executeWorkspace(hermes, workspace.workspace.id, {}, {
        postGatewayChatCompletion: async () => ({ choices: [{ message: { content: 'should not run' } }] }),
      }),
      error => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /contain a cycle/);
        return true;
      },
    );
  });
});

test('workspace profile execution ignores cycles formed only by broadcast and escalation edges', async () => {
  await withHermesFiles(async hermes => {
    const first = await agentStudioService.createAgent(hermes, {
      name: 'First',
      soul: '# First Soul',
    });
    const second = await agentStudioService.createAgent(hermes, {
      name: 'Second',
      soul: '# Second Soul',
    });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Contextual Cycle Workspace',
      defaultMode: 'profiles',
      nodes: [
        { id: 'node-a', agentId: first.agent.id, role: 'worker', label: 'First', position: { x: 1, y: 1 } },
        { id: 'node-b', agentId: second.agent.id, role: 'observer', label: 'Second', position: { x: 2, y: 1 } },
      ],
      edges: [
        { fromNodeId: 'node-a', toNodeId: 'node-b', kind: 'broadcast', template: 'FYI from A to B.' },
        { fromNodeId: 'node-b', toNodeId: 'node-a', kind: 'escalation', template: 'Risk escalation from B to A.' },
      ],
    });

    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, { task: 'Handle contextual-only graph' }, {
      postGatewayChatCompletion: async (_targetHermes, body) => {
        const prompt = body.messages?.[0]?.content || '';
        if (prompt.includes('Profile Runtime Workspace Node: First')) return { choices: [{ message: { content: 'first complete' } }] };
        return { choices: [{ message: { content: 'second complete' } }] };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.runs.length, 2);
    assert.deepEqual(result.runs.map(run => run.status), ['completed', 'completed']);
  });
});

test('workspace profile execution injects upstream output into qa node prompt', async () => {
  await withHermesFiles(async hermes => {
    const builder = await agentStudioService.createAgent(hermes, {
      name: 'Builder',
      soul: '# Builder Soul',
    });
    const qa = await agentStudioService.createAgent(hermes, {
      name: 'QA',
      soul: '# QA Soul',
    });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'QA Profile Workspace',
      defaultMode: 'profiles',
      nodes: [
        { id: 'node-builder', agentId: builder.agent.id, role: 'worker', position: { x: 1, y: 1 } },
        { id: 'node-qa', agentId: qa.agent.id, role: 'qa', position: { x: 2, y: 2 } },
      ],
      edges: [
        { fromNodeId: 'node-builder', toNodeId: 'node-qa', kind: 'qa' },
      ],
    });

    const calls = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, { task: 'Ship safely' }, {
      postGatewayChatCompletion: async (_targetHermes, body) => {
        calls.push(body);
        if (calls.length === 1) return { choices: [{ message: { content: 'artifact v1 ready' } }] };
        return { choices: [{ message: { content: 'qa pass with checks' } }] };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.runs[0].nodeId, 'node-builder');
    assert.equal(result.runs[1].nodeId, 'node-qa');
    assert.match(calls[1].messages[0].content, /QA Inputs/);
    assert.match(calls[1].messages[0].content, /artifact v1 ready/);
    assert.match(calls[1].messages[0].content, /QA Focus/);
  });
});

test('workspace profile execution assembles downstream context by edge kind with templates', async () => {
  await withHermesFiles(async hermes => {
    const implementer = await agentStudioService.createAgent(hermes, { name: 'Implementer', soul: '# Implementer Soul' });
    const reviewer = await agentStudioService.createAgent(hermes, { name: 'Reviewer', soul: '# Reviewer Soul' });
    const qa = await agentStudioService.createAgent(hermes, { name: 'QA', soul: '# QA Soul' });
    const orchestrator = await agentStudioService.createAgent(hermes, { name: 'Orchestrator', soul: '# Orchestrator Soul' });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Edge Kind Assembly Workspace',
      defaultMode: 'profiles',
      nodes: [
        { id: 'node-impl', agentId: implementer.agent.id, role: 'worker', label: 'Implementer', position: { x: 1, y: 1 } },
        { id: 'node-rev', agentId: reviewer.agent.id, role: 'reviewer', label: 'Reviewer', position: { x: 2, y: 1 } },
        { id: 'node-qa', agentId: qa.agent.id, role: 'qa', label: 'QA', position: { x: 3, y: 1 } },
        { id: 'node-orch', agentId: orchestrator.agent.id, role: 'orchestrator', label: 'Orchestrator', position: { x: 4, y: 1 } },
      ],
      edges: [
        { fromNodeId: 'node-impl', toNodeId: 'node-orch', kind: 'handoff', template: 'Continue implementation from this draft.' },
        { fromNodeId: 'node-rev', toNodeId: 'node-orch', kind: 'review', template: 'Address critical reviewer findings first.' },
        { fromNodeId: 'node-qa', toNodeId: 'node-orch', kind: 'qa', template: 'Satisfy failing QA checks before finalize.' },
      ],
    });

    const calls = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, { task: 'Deliver release candidate' }, {
      postGatewayChatCompletion: async (_targetHermes, body) => {
        calls.push(body);
        const prompt = body.messages?.[0]?.content || '';
        if (prompt.includes('Profile Runtime Workspace Node: Implementer')) return { choices: [{ message: { content: 'implementation draft' } }] };
        if (prompt.includes('Profile Runtime Workspace Node: Reviewer')) return { choices: [{ message: { content: 'review findings' } }] };
        if (prompt.includes('Profile Runtime Workspace Node: QA')) return { choices: [{ message: { content: 'qa checklist' } }] };
        return { choices: [{ message: { content: 'orchestrated result' } }] };
      },
    });

    assert.equal(result.success, true);
    const orchestratorPrompt = calls[calls.length - 1].messages[0].content;
    assert.match(orchestratorPrompt, /Handoff Inputs/);
    assert.match(orchestratorPrompt, /Review Inputs/);
    assert.match(orchestratorPrompt, /QA Inputs/);
    assert.match(orchestratorPrompt, /implementation draft/);
    assert.match(orchestratorPrompt, /review findings/);
    assert.match(orchestratorPrompt, /qa checklist/);
    assert.match(orchestratorPrompt, /Continue implementation from this draft/);
    assert.match(orchestratorPrompt, /Address critical reviewer findings first/);
    assert.match(orchestratorPrompt, /Satisfy failing QA checks before finalize/);
    assert.match(orchestratorPrompt, /Downstream Assembly Rules/);

    const orchestratorRun = result.runs.find(run => run.nodeId === 'node-orch');
    assert.equal(orchestratorRun.inputs.handoff.length, 1);
    assert.equal(orchestratorRun.inputs.review.length, 1);
    assert.equal(orchestratorRun.inputs.qa.length, 1);
    assert.equal(orchestratorRun.inputs.handoff[0].template, 'Continue implementation from this draft.');
    assert.equal(orchestratorRun.inputs.review[0].template, 'Address critical reviewer findings first.');
    assert.equal(orchestratorRun.inputs.qa[0].template, 'Satisfy failing QA checks before finalize.');
  });
});

test('workspace profile execution keeps broadcast and escalation as contextual non-blocking inputs', async () => {
  await withHermesFiles(async hermes => {
    const implementer = await agentStudioService.createAgent(hermes, { name: 'Implementer', soul: '# Implementer Soul' });
    const announcer = await agentStudioService.createAgent(hermes, { name: 'Announcer', soul: '# Announcer Soul' });
    const reviewer = await agentStudioService.createAgent(hermes, { name: 'Reviewer', soul: '# Reviewer Soul' });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Contextual Inputs Workspace',
      defaultMode: 'profiles',
      nodes: [
        { id: 'node-impl', agentId: implementer.agent.id, role: 'worker', label: 'Implementer', position: { x: 1, y: 1 } },
        { id: 'node-ann', agentId: announcer.agent.id, role: 'observer', label: 'Announcer', position: { x: 2, y: 1 } },
        { id: 'node-rev', agentId: reviewer.agent.id, role: 'reviewer', label: 'Reviewer', position: { x: 3, y: 1 } },
      ],
      edges: [
        { fromNodeId: 'node-impl', toNodeId: 'node-rev', kind: 'review', template: 'Review the implementation output.' },
        { fromNodeId: 'node-ann', toNodeId: 'node-rev', kind: 'broadcast', template: 'Shared context from announcements.' },
        { fromNodeId: 'node-ann', toNodeId: 'node-rev', kind: 'escalation', template: 'Escalated production risk.' },
      ],
    });

    const calls = [];
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, { task: 'Assess the release' }, {
      postGatewayChatCompletion: async (_targetHermes, body) => {
        calls.push(body);
        const prompt = body.messages?.[0]?.content || '';
        if (prompt.includes('Profile Runtime Workspace Node: Implementer')) return { choices: [{ message: { content: 'implementation complete' } }] };
        if (prompt.includes('Profile Runtime Workspace Node: Announcer')) return { choices: [{ message: { content: 'broadcast context and escalation details' } }] };
        return { choices: [{ message: { content: 'review outcome' } }] };
      },
    });

    assert.equal(result.success, true);
    const reviewerPrompt = calls[calls.length - 1].messages[0].content;
    assert.match(reviewerPrompt, /Review Inputs/);
    assert.match(reviewerPrompt, /Broadcast Inputs/);
    assert.match(reviewerPrompt, /Escalation Inputs/);
    assert.match(reviewerPrompt, /Shared context from announcements/);
    assert.match(reviewerPrompt, /Escalated production risk/);

    const reviewerRun = result.runs.find(run => run.nodeId === 'node-rev');
    assert.equal(reviewerRun.inputs.review.length, 1);
    assert.equal(reviewerRun.inputs.broadcast.length, 1);
    assert.equal(reviewerRun.inputs.escalation.length, 1);
    assert.equal(reviewerRun.inputs.broadcast[0].template, 'Shared context from announcements.');
    assert.equal(reviewerRun.inputs.escalation[0].template, 'Escalated production risk.');
    assert.equal(reviewerRun.status, 'completed');
  });
});

test('workspace profile execution runs independent layer nodes in parallel and emits workflow aggregate', async () => {
  await withHermesFiles(async hermes => {
    const first = await agentStudioService.createAgent(hermes, { name: 'First', soul: '# First Soul' });
    const second = await agentStudioService.createAgent(hermes, { name: 'Second', soul: '# Second Soul' });
    const qa = await agentStudioService.createAgent(hermes, { name: 'QA', soul: '# QA Soul' });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Parallel Layer Workspace',
      defaultMode: 'profiles',
      nodes: [
        { id: 'node-first', agentId: first.agent.id, role: 'worker', label: 'First', position: { x: 1, y: 1 } },
        { id: 'node-second', agentId: second.agent.id, role: 'worker', label: 'Second', position: { x: 2, y: 1 } },
        { id: 'node-qa', agentId: qa.agent.id, role: 'qa', label: 'QA', position: { x: 3, y: 1 } },
      ],
      edges: [
        { fromNodeId: 'node-first', toNodeId: 'node-qa', kind: 'qa' },
        { fromNodeId: 'node-second', toNodeId: 'node-qa', kind: 'qa' },
      ],
    });

    let active = 0;
    let maxActive = 0;
    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, { task: 'Run in parallel' }, {
      postGatewayChatCompletion: async (_targetHermes, body) => {
        const prompt = body.messages?.[0]?.content || '';
        active += 1;
        if (active > maxActive) maxActive = active;
        const delay = prompt.includes('Profile Runtime Workspace Node: QA') ? 5 : 40;
        await new Promise(resolve => setTimeout(resolve, delay));
        active -= 1;
        if (prompt.includes('Profile Runtime Workspace Node: First')) return { choices: [{ message: { content: 'first out' } }] };
        if (prompt.includes('Profile Runtime Workspace Node: Second')) return { choices: [{ message: { content: 'second out' } }] };
        return { choices: [{ message: { content: 'qa out' } }] };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.ok(maxActive >= 2);
    assert.equal(result.workflow.status, 'completed');
    assert.equal(result.workflow.counts.total, 3);
    assert.equal(result.workflow.counts.completed, 3);
    assert.equal(result.workflow.counts.failed, 0);
    assert.equal(result.workflow.counts.blocked, 0);
    assert.equal(result.workflow.qaGate.required, true);
    assert.equal(result.workflow.qaGate.status, 'passed');
  });
});

test('workspace profile execution marks downstream node blocked when upstream failed', async () => {
  await withHermesFiles(async hermes => {
    const impl = await agentStudioService.createAgent(hermes, { name: 'Impl', soul: '# Impl Soul' });
    const reviewer = await agentStudioService.createAgent(hermes, { name: 'Reviewer', soul: '# Reviewer Soul' });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Blocked Workspace',
      defaultMode: 'profiles',
      nodes: [
        { id: 'node-impl', agentId: impl.agent.id, role: 'worker', label: 'Impl', position: { x: 1, y: 1 } },
        { id: 'node-rev', agentId: reviewer.agent.id, role: 'reviewer', label: 'Reviewer', position: { x: 2, y: 1 } },
      ],
      edges: [
        { fromNodeId: 'node-impl', toNodeId: 'node-rev', kind: 'review', template: 'Must pass implementation before review.' },
      ],
    });

    const result = await agentStudioService.executeWorkspace(hermes, workspace.workspace.id, { task: 'Fail upstream' }, {
      postGatewayChatCompletion: async (_targetHermes, body) => {
        const prompt = body.messages?.[0]?.content || '';
        if (prompt.includes('Profile Runtime Workspace Node: Impl')) throw new Error('impl failed hard');
        return { choices: [{ message: { content: 'should not execute' } }] };
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'failed');
    const implRun = result.runs.find(run => run.nodeId === 'node-impl');
    const reviewerRun = result.runs.find(run => run.nodeId === 'node-rev');
    assert.equal(implRun.status, 'failed');
    assert.equal(reviewerRun.status, 'blocked');
    assert.match(reviewerRun.error, /Blocked by upstream dependencies/);
    assert.equal(reviewerRun.inputs.review.length, 1);
    assert.equal(reviewerRun.inputs.review[0].status, 'failed');
    assert.equal(result.workflow.counts.failed, 1);
    assert.equal(result.workflow.counts.blocked, 1);
  });
});

test('workspace profile execution runs document_parse then open_pandas_analysis toolsets with attachments', async () => {
  await withHermesFiles(async hermes => {
    const parserAgent = await agentStudioService.createAgent(hermes, {
      name: 'Parser',
      soul: '# Parser Soul',
    });
    const analystAgent = await agentStudioService.createAgent(hermes, {
      name: 'Analyst',
      soul: '# Analyst Soul',
    });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Data Intelligence Runtime Workspace',
      defaultMode: 'profiles',
      nodes: [
        {
          id: 'node-parse',
          agentId: parserAgent.agent.id,
          role: 'worker',
          label: 'Parse Document',
          toolsets: ['document_parse'],
          position: { x: 1, y: 1 },
        },
        {
          id: 'node-analyze',
          agentId: analystAgent.agent.id,
          role: 'worker',
          label: 'Analyze Dataset',
          toolsets: ['open_pandas_analysis'],
          position: { x: 2, y: 1 },
        },
      ],
      edges: [
        { fromNodeId: 'node-parse', toNodeId: 'node-analyze', kind: 'handoff' },
      ],
    });

    const documentParserCalls = [];
    const openPandasStartCalls = [];
    const prompts = [];
    const datasetBase64 = Buffer.from('city,revenue\nDakar,42', 'utf-8').toString('base64');

    const result = await agentStudioService.runWorkspaceTask(hermes, workspace.workspace.id, {
      task: 'Analyze attached files and produce actionable insights.',
      mode: 'profiles',
      attachments: {
        document: {
          fileName: 'brief.pdf',
          base64: Buffer.from('fake-pdf-content', 'utf-8').toString('base64'),
          mimeType: 'application/pdf',
        },
        dataset: {
          fileName: 'sales.csv',
          base64: datasetBase64,
          mimeType: 'text/csv',
        },
      },
    }, {
      documentParserService: {
        isSupportedDocumentPath: () => true,
        parseDocument: async (_targetHermes, payload) => {
          documentParserCalls.push(payload);
          return {
            content: 'Source dataset is sales.csv. Use it for revenue metrics.',
            charCount: 58,
            meta: { pageCount: 2 },
          };
        },
      },
      openPandasAiService: {
        startAnalysis: async (_targetHermes, payload) => {
          openPandasStartCalls.push(payload);
          return { runId: 'opa_run_1', status: 'queued', createdAt: '2026-05-29T10:00:00.000Z' };
        },
        getRun: async () => ({
          runId: 'opa_run_1',
          status: 'succeeded',
          result: {
            status: 'success',
            summary: { text: 'Revenue is concentrated in two cities.' },
            dataset: { shape: [10, 5] },
            charts: [{ id: 'chart-1' }],
          },
        }),
      },
      postGatewayChatCompletion: async (_targetHermes, body) => {
        prompts.push(body.messages?.[0]?.content || '');
        return { choices: [{ message: { content: 'node done' } }] };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.runs.length, 2);
    assert.equal(documentParserCalls.length, 1);
    assert.equal(openPandasStartCalls.length, 1);
    assert.equal(openPandasStartCalls[0].dataset.fileName, 'sales.csv');
    assert.match(openPandasStartCalls[0].question, /Analyze attached files/);

    const parseRun = result.runs.find(run => run.nodeId === 'node-parse');
    const analyzeRun = result.runs.find(run => run.nodeId === 'node-analyze');
    assert.equal(parseRun.status, 'completed');
    assert.equal(analyzeRun.status, 'completed');
    assert.equal(parseRun.toolsetOutputs[0].toolset, 'document_parse');
    assert.equal(parseRun.toolsetOutputs[0].status, 'completed');
    assert.equal(analyzeRun.toolsetOutputs[0].toolset, 'open_pandas_analysis');
    assert.equal(analyzeRun.toolsetOutputs[0].status, 'completed');
    assert.match(prompts[1], /Toolset Runtime Results/);
    assert.match(prompts[1], /Open_Pandas_AI status: success/);
  });
});

test('workspace profile execution rejects malformed toolset attachments', async () => {
  await withHermesFiles(async hermes => {
    const analystAgent = await agentStudioService.createAgent(hermes, {
      name: 'Attachment Guard',
      soul: '# Attachment Guard Soul',
    });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Attachment Guard Workspace',
      defaultMode: 'profiles',
      nodes: [{
        id: 'node-analyze',
        agentId: analystAgent.agent.id,
        role: 'worker',
        toolsets: ['open_pandas_analysis'],
        position: { x: 1, y: 1 },
      }],
    });

    const runners = {
      postGatewayChatCompletion: async () => ({ choices: [{ message: { content: 'should not run' } }] }),
    };

    await assert.rejects(
      agentStudioService.runWorkspaceTask(hermes, workspace.workspace.id, {
        task: 'Analyze this attachment.',
        mode: 'profiles',
        attachments: {
          dataset: {
            fileName: 'sales.csv',
            base64: 'not valid !!!',
            mimeType: 'text/csv',
          },
        },
      }, runners),
      error => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /invalid base64/i);
        return true;
      },
    );

    await assert.rejects(
      agentStudioService.runWorkspaceTask(hermes, workspace.workspace.id, {
        task: 'Analyze this attachment.',
        mode: 'profiles',
        attachments: {
          dataset: {
            fileName: 'sales.csv',
            dataUrl: 'data:text/csv;base64,@@@',
          },
        },
      }, runners),
      error => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /valid base64 data URL/i);
        return true;
      },
    );
  });
});

test('workspace profile execution fails a node when its configured toolset fails', async () => {
  await withHermesFiles(async hermes => {
    const analystAgent = await agentStudioService.createAgent(hermes, {
      name: 'Analyst',
      soul: '# Analyst Soul',
    });

    const workspace = await agentStudioService.createWorkspace(hermes, {
      name: 'Toolset Failure Workspace',
      defaultMode: 'profiles',
      nodes: [
        {
          id: 'node-analyze',
          agentId: analystAgent.agent.id,
          role: 'worker',
          label: 'Analyze Dataset',
          toolsets: ['open_pandas_analysis'],
          position: { x: 1, y: 1 },
        },
      ],
    });

    let gatewayCalls = 0;
    const result = await agentStudioService.runWorkspaceTask(hermes, workspace.workspace.id, {
      task: 'Analyze this attachment.',
      mode: 'profiles',
      attachments: {
        dataset: {
          fileName: 'notes.pdf',
          base64: Buffer.from('not-a-dataset', 'utf-8').toString('base64'),
          mimeType: 'application/pdf',
        },
      },
    }, {
      openPandasAiService: {
        startAnalysis: async () => ({ runId: 'should_not_start', status: 'queued' }),
        getRun: async () => ({ status: 'succeeded' }),
      },
      postGatewayChatCompletion: async () => {
        gatewayCalls += 1;
        return { choices: [{ message: { content: 'should not run' } }] };
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'failed');
    assert.equal(gatewayCalls, 0);
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].status, 'failed');
    assert.equal(result.runs[0].toolsetOutputs[0].toolset, 'open_pandas_analysis');
    assert.equal(result.runs[0].toolsetOutputs[0].status, 'failed');
    assert.match(result.runs[0].error, /unsupported(_| )dataset(_| )extension/i);
  });
});
