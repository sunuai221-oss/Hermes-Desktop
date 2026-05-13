import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

import { createAgentStudioService } from '../services/agent-studio.mjs';

const defaultOutputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/agency-agents-bundled.json');
const sourceRoot = process.argv[2];
const outputPath = path.resolve(process.argv[3] || defaultOutputPath);
const repoUrl = process.argv[4] || 'https://github.com/msitarzewski/agency-agents';
const branch = process.argv[5] || 'main';

if (!sourceRoot) {
  console.error('Usage: node server/scripts/generate-agency-bundle.mjs <agency-agents-root> [output-path] [repo-url] [branch]');
  process.exit(1);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-agency-bundle-'));
const hermes = {
  profile: 'default',
  home: path.join(tempDir, '.hermes'),
  paths: {
    appState: path.join(tempDir, '.hermes-builder'),
    agentStudioDir: path.join(tempDir, '.hermes-builder', 'agent-studio'),
    agentStudioLibrary: path.join(tempDir, '.hermes-builder', 'agent-studio', 'library.json'),
    agentStudioWorkspaces: path.join(tempDir, '.hermes-builder', 'agent-studio', 'workspaces.json'),
  },
};

try {
  const service = createAgentStudioService({
    fs,
    path,
    yaml,
    bundledCatalogPath: null,
    autoSeedBundledCatalog: false,
  });

  const result = await service.importAgencyAgents(hermes, { rootPath: sourceRoot });
  const agents = result.agents
    .filter(agent => agent.source === 'agency-agents')
    .map(agent => ({
      id: agent.id,
      source: agent.source,
      ...(agent.sourcePath ? { sourcePath: agent.sourcePath } : {}),
      name: agent.name,
      slug: agent.slug,
      ...(agent.description ? { description: agent.description } : {}),
      ...(agent.division ? { division: agent.division } : {}),
      ...(agent.color ? { color: agent.color } : {}),
      ...(agent.emoji ? { emoji: agent.emoji } : {}),
      ...(agent.vibe ? { vibe: agent.vibe } : {}),
      soul: agent.soul,
      ...(agent.workflow ? { workflow: agent.workflow } : {}),
      ...(agent.deliverables ? { deliverables: agent.deliverables } : {}),
      ...(agent.successMetrics ? { successMetrics: agent.successMetrics } : {}),
      preferredSkills: agent.preferredSkills || [],
      preferredToolsets: agent.preferredToolsets || [],
      ...(agent.defaultModel ? { defaultModel: agent.defaultModel } : {}),
      tags: agent.tags || [],
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }));

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repoUrl,
    branch,
    agentCount: agents.length,
    agents,
  }, null, 2), 'utf-8');

  console.log(`Wrote ${agents.length} bundled agency agents to ${outputPath}`);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
