import crypto from 'crypto';

const SCHEMA_VERSION = 1;
const EXCLUDED_IMPORT_DIRS = new Set(['.git', 'docs', 'strategy', 'integrations', 'examples', 'node_modules']);
const EXCLUDED_IMPORT_FILES = new Set(['readme.md', 'license.md', 'changelog.md', 'contributing.md']);
const MANAGED_CATALOG_SOURCES = new Set(['agency-agents', 'aliasrobotics-cai']);
const VALID_ROLES = new Set(['orchestrator', 'worker', 'reviewer', 'qa', 'observer']);
const VALID_EDGE_KINDS = new Set(['handoff', 'review', 'qa', 'broadcast', 'escalation']);
const VALID_MODES = new Set(['prompt', 'delegate', 'profiles']);
const DEFAULT_AGENCY_REPO_URL = 'https://github.com/msitarzewski/agency-agents';
const DEFAULT_AGENCY_REPO_BRANCH = 'main';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const GITHUB_MARKDOWN_CONCURRENCY = 8;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function cleanString(value) {
  return String(value ?? '').trim();
}

function optionalString(value) {
  const cleaned = cleanString(value);
  return cleaned || undefined;
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map(item => cleanString(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => cleanString(item)).filter(Boolean);
  return [];
}

function slugify(value, fallback = 'agent') {
  const slug = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Untitled Agent';
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12)}`;
}

function generatedId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function compareStrings(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function normalizeRelativePath(value) {
  return String(value || '').split(/[\\/]+/).filter(Boolean).join('/');
}

function normalizeSource(value, fallback = 'user') {
  const source = cleanString(value);
  if (!source) return fallback;
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(source) ? source : fallback;
}

function catalogSourcePathKey(source, sourcePath) {
  const normalizedPath = normalizeRelativePath(sourcePath).replace(/\.md$/i, '').toLowerCase();
  if (!normalizedPath) return '';
  return `${normalizeSource(source, 'agency-agents')}::${normalizedPath}`;
}

function isManagedCatalogAgent(agent) {
  return MANAGED_CATALOG_SOURCES.has(agent?.source) && Boolean(agent?.sourcePath);
}

function shouldImportMarkdownPath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const parts = normalizedPath.split('/').filter(Boolean);
  if (parts.length === 0) return false;

  const fileName = parts[parts.length - 1].toLowerCase();
  if (!fileName.endsWith('.md') || EXCLUDED_IMPORT_FILES.has(fileName)) return false;

  return !parts.slice(0, -1).some(part => EXCLUDED_IMPORT_DIRS.has(part.toLowerCase()));
}

function buildImportFile(relativePath, extra = {}) {
  const normalizedPath = normalizeRelativePath(relativePath);
  const parts = normalizedPath.split('/').filter(Boolean);
  return {
    relativePath: normalizedPath,
    division: parts[0] || undefined,
    ...extra,
  };
}

function sortAgentDefinitions(a, b) {
  return (
    compareStrings(a.division, b.division)
    || compareStrings(a.sourcePath, b.sourcePath)
    || compareStrings(a.name, b.name)
    || compareStrings(a.id, b.id)
  );
}

function normalizePosition(position) {
  return {
    x: Number.isFinite(Number(position?.x)) ? Number(position.x) : 48,
    y: Number.isFinite(Number(position?.y)) ? Number(position.y) : 48,
  };
}

function normalizeAgent(input, existing = null, defaults = {}) {
  const now = nowIso();
  const name = cleanString(input?.name || defaults.name);
  const soul = cleanString(input?.soul || defaults.soul);
  if (!name) throw createHttpError(400, 'Agent name is required');
  if (!soul) throw createHttpError(400, 'Agent soul is required');

  const source = normalizeSource(input?.source, defaults.source || 'user');
  const sourcePath = optionalString(input?.sourcePath ?? defaults.sourcePath);
  const slug = slugify(input?.slug || defaults.slug || name);

  return {
    id: cleanString(existing?.id || input?.id) || generatedId('agent'),
    source,
    ...(sourcePath ? { sourcePath } : {}),
    name,
    slug,
    ...(optionalString(input?.description ?? defaults.description) ? { description: optionalString(input?.description ?? defaults.description) } : {}),
    ...(optionalString(input?.division ?? defaults.division) ? { division: optionalString(input?.division ?? defaults.division) } : {}),
    ...(optionalString(input?.color ?? defaults.color) ? { color: optionalString(input?.color ?? defaults.color) } : {}),
    ...(optionalString(input?.emoji ?? defaults.emoji) ? { emoji: optionalString(input?.emoji ?? defaults.emoji) } : {}),
    ...(optionalString(input?.vibe ?? defaults.vibe) ? { vibe: optionalString(input?.vibe ?? defaults.vibe) } : {}),
    soul,
    ...(optionalString(input?.workflow ?? defaults.workflow) ? { workflow: optionalString(input?.workflow ?? defaults.workflow) } : {}),
    ...(optionalString(input?.deliverables ?? defaults.deliverables) ? { deliverables: optionalString(input?.deliverables ?? defaults.deliverables) } : {}),
    ...(optionalString(input?.successMetrics ?? defaults.successMetrics) ? { successMetrics: optionalString(input?.successMetrics ?? defaults.successMetrics) } : {}),
    preferredSkills: asStringArray(input?.preferredSkills ?? defaults.preferredSkills),
    preferredToolsets: asStringArray(input?.preferredToolsets ?? defaults.preferredToolsets),
    ...(optionalString(input?.defaultModel ?? defaults.defaultModel) ? { defaultModel: optionalString(input?.defaultModel ?? defaults.defaultModel) } : {}),
    tags: asStringArray(input?.tags ?? defaults.tags),
    createdAt: existing?.createdAt || optionalString(input?.createdAt) || now,
    updatedAt: now,
  };
}

function normalizeNode(input) {
  const agentId = cleanString(input?.agentId);
  if (!agentId) throw createHttpError(400, 'Workspace node agentId is required');
  return {
    id: cleanString(input?.id) || generatedId('node'),
    agentId,
    role: VALID_ROLES.has(input?.role) ? input.role : 'worker',
    ...(optionalString(input?.label) ? { label: optionalString(input.label) } : {}),
    ...(optionalString(input?.profileName) ? { profileName: optionalString(input.profileName) } : {}),
    ...(optionalString(input?.modelOverride) ? { modelOverride: optionalString(input.modelOverride) } : {}),
    toolsets: asStringArray(input?.toolsets),
    skills: asStringArray(input?.skills),
    position: normalizePosition(input?.position),
  };
}

function normalizeEdge(input) {
  const fromNodeId = cleanString(input?.fromNodeId);
  const toNodeId = cleanString(input?.toNodeId);
  if (!fromNodeId || !toNodeId) throw createHttpError(400, 'Workspace edge endpoints are required');
  return {
    id: cleanString(input?.id) || generatedId('edge'),
    fromNodeId,
    toNodeId,
    kind: VALID_EDGE_KINDS.has(input?.kind) ? input.kind : 'handoff',
    ...(optionalString(input?.template) ? { template: optionalString(input.template) } : {}),
  };
}

function normalizeWorkspace(input, existing = null) {
  const now = nowIso();
  const name = cleanString(input?.name || existing?.name || 'Untitled workspace');
  const nodes = Array.isArray(input?.nodes) ? input.nodes.map(normalizeNode) : (existing?.nodes || []);
  const nodeIds = new Set(nodes.map(node => node.id));
  const rawEdges = Array.isArray(input?.edges) ? input.edges : (existing?.edges || []);
  const edges = rawEdges
    .map(normalizeEdge)
    .filter(edge =>
      nodeIds.has(edge.fromNodeId)
      && nodeIds.has(edge.toNodeId)
      && edge.fromNodeId !== edge.toNodeId
    );

  return {
    id: cleanString(existing?.id || input?.id) || generatedId('workspace'),
    name,
    ...(optionalString(input?.description) ? { description: optionalString(input.description) } : {}),
    sharedContext: cleanString(input?.sharedContext),
    commonRules: cleanString(input?.commonRules),
    defaultMode: VALID_MODES.has(input?.defaultMode) ? input.defaultMode : 'prompt',
    nodes,
    edges,
    createdAt: existing?.createdAt || optionalString(input?.createdAt) || now,
    updatedAt: now,
  };
}

function parseFrontmatter(markdown, yaml) {
  const normalized = String(markdown || '').replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return { data: {}, body: normalized };

  const lines = normalized.split(/\r?\n/);
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      end = index;
      break;
    }
  }
  if (end === -1) return { data: {}, body: normalized };

  const frontmatter = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  return { data: yaml.parse(frontmatter) || {}, body };
}

function appendSection(lines, title, content) {
  const value = cleanString(content);
  if (!value) return;
  lines.push(`## ${title}`, '', value, '');
}

function extractAssistantContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function getNodeLabel(node, agentsById) {
  if (!node) return 'Missing node';
  const agent = agentsById.get(node.agentId);
  return cleanString(node.label) || agent?.name || 'Missing agent definition';
}

function appendWorkspaceFlow(lines, workspace, agentsById) {
  const nodesById = new Map((workspace.nodes || []).map(node => [node.id, node]));
  const edges = (workspace.edges || [])
    .filter(edge => nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId));
  if (edges.length === 0) return;

  lines.push('## Agent Flow', '');
  for (const edge of edges) {
    const from = getNodeLabel(nodesById.get(edge.fromNodeId), agentsById);
    const to = getNodeLabel(nodesById.get(edge.toNodeId), agentsById);
    lines.push(`- ${from} -> ${to} (${edge.kind})`);
    if (edge.template) lines.push(`  Template: ${edge.template}`);
  }
  lines.push('');
}

function appendNodeFlow(lines, workspace, node, agentsById) {
  const nodesById = new Map((workspace.nodes || []).map(item => [item.id, item]));
  const relevantEdges = (workspace.edges || [])
    .filter(edge => edge.fromNodeId === node.id || edge.toNodeId === node.id)
    .filter(edge => nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId));
  if (relevantEdges.length === 0) return;

  lines.push('## Node Relations', '');
  for (const edge of relevantEdges) {
    const from = getNodeLabel(nodesById.get(edge.fromNodeId), agentsById);
    const to = getNodeLabel(nodesById.get(edge.toNodeId), agentsById);
    lines.push(`- ${from} -> ${to} (${edge.kind})`);
  }
  lines.push('');
}

function buildWorkspacePrompt(workspace, agentsById, options = {}) {
  const lines = [
    `# Agent Workspace: ${workspace.name}`,
    '',
  ];

  appendSection(lines, 'Description', workspace.description);
  appendSection(lines, 'Shared Context', workspace.sharedContext);
  appendSection(lines, 'Common Rules', workspace.commonRules);
  appendSection(lines, 'Current Task', options.task);

  lines.push('## Agent Roster', '');
  for (const node of workspace.nodes) {
    const agent = agentsById.get(node.agentId);
    const label = getNodeLabel(node, agentsById);
    lines.push(`- ${label} (${node.role})`);
    if (agent?.description) lines.push(`  Description: ${agent.description}`);
    if (node.profileName) lines.push(`  Profile: ${node.profileName}`);
    if (node.modelOverride) lines.push(`  Model: ${node.modelOverride}`);
    if (node.skills?.length) lines.push(`  Skills: ${node.skills.join(', ')}`);
    if (node.toolsets?.length) lines.push(`  Toolsets: ${node.toolsets.join(', ')}`);
    if (!agent) lines.push(`  Note: Missing agent definition for ${node.agentId}.`);
  }
  lines.push('');

  appendWorkspaceFlow(lines, workspace, agentsById);

  lines.push('## Agent Instructions', '');
  for (const node of workspace.nodes) {
    const agent = agentsById.get(node.agentId);
    const label = getNodeLabel(node, agentsById);
    lines.push(`### ${label}`, '');
    lines.push(`Role: ${node.role}`, '');
    if (!agent) {
      lines.push(`Missing agent definition for ${node.agentId}.`, '');
      continue;
    }
    lines.push(agent.soul, '');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildDelegateBridgePrompt(workspace, prompt) {
  return [
    `# Execute Workspace via delegate_task: ${workspace.name}`,
    '',
    'You are the workspace orchestrator. Execute this multi-agent workspace using the delegate_task tool when available.',
    '',
    'Rules:',
    '- Spawn focused subagents for worker/reviewer/qa nodes instead of doing all work yourself.',
    '- Pass each subagent its role, relevant workspace context, toolsets, skills, and expected deliverable.',
    '- Synthesize the subagent outputs into one final result.',
    '- If delegate_task is unavailable, explicitly say so and continue as a single-agent fallback.',
    '',
    prompt,
  ].join('\n').trim();
}

function buildProfileNodePrompt(workspace, node, agent, agentsById, options = {}) {
  const label = cleanString(node.label) || agent?.name || 'Workspace agent';
  const lines = [
    `# Profile Runtime Workspace Node: ${label}`,
    '',
    `Workspace: ${workspace.name}`,
    `Role: ${node.role}`,
    '',
  ];
  appendSection(lines, 'Workspace Description', workspace.description);
  appendSection(lines, 'Shared Context', workspace.sharedContext);
  appendSection(lines, 'Common Rules', workspace.commonRules);
  appendSection(lines, 'Current Task', options.task);
  appendNodeFlow(lines, workspace, node, agentsById);
  if (node.skills?.length) lines.push('## Skills', '', node.skills.join(', '), '');
  if (node.toolsets?.length) lines.push('## Toolsets', '', node.toolsets.join(', '), '');
  if (agent?.soul) appendSection(lines, 'Agent Identity', agent.soul);
  lines.push('## Task', '', options.task || 'Execute your part of this workspace and return a concise result for the orchestrator.', '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function createAgentStudioService({
  fs,
  path,
  yaml,
  runtimeFilesService = null,
  fetchImpl = globalThis.fetch,
  bundledCatalogPath = new URL('../data/agency-agents-bundled.json', import.meta.url),
  autoSeedBundledCatalog = true,
}) {
  async function fetchJson(url) {
    if (typeof fetchImpl !== 'function') throw createHttpError(501, 'GitHub import is not available in this runtime');
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Hermes-Desktop',
      },
    });
    if (!response?.ok) {
      const details = await response?.text?.().catch(() => '');
      throw createHttpError(
        502,
        `GitHub request failed (${response?.status || 'unknown'}): ${details || response?.statusText || url}`,
      );
    }
    return response.json();
  }

  async function fetchText(url) {
    if (typeof fetchImpl !== 'function') throw createHttpError(501, 'GitHub import is not available in this runtime');
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Hermes-Desktop',
      },
    });
    if (!response?.ok) {
      const details = await response?.text?.().catch(() => '');
      throw createHttpError(
        502,
        `GitHub request failed (${response?.status || 'unknown'}): ${details || response?.statusText || url}`,
      );
    }
    return response.text();
  }

  function parseGitHubRepoUrl(repoUrl) {
    let url;
    try {
      url = new URL(repoUrl);
    } catch {
      throw createHttpError(400, 'repoUrl must be a valid GitHub repository URL');
    }

    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
      throw createHttpError(400, 'repoUrl must point to github.com');
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw createHttpError(400, 'repoUrl must point to a GitHub repository');
    }

    const owner = cleanString(parts[0]);
    const repo = cleanString(parts[1]).replace(/\.git$/i, '');
    if (!owner || !repo) throw createHttpError(400, 'repoUrl must point to a GitHub repository');

    const treeIndex = parts.findIndex(part => part === 'tree');
    const branch = treeIndex !== -1 ? cleanString(parts[treeIndex + 1]) : '';

    return { owner, repo, branch: branch || undefined };
  }

  async function resolveGitHubRepo(payload = {}) {
    const requestedBranch = cleanString(payload?.branch);
    const requestedRepoUrl = cleanString(payload?.repoUrl);
    const parsedRepo = requestedRepoUrl
      ? parseGitHubRepoUrl(requestedRepoUrl)
      : parseGitHubRepoUrl(DEFAULT_AGENCY_REPO_URL);

    const repoMeta = await fetchJson(`${GITHUB_API_BASE}/repos/${parsedRepo.owner}/${parsedRepo.repo}`);
    return {
      owner: parsedRepo.owner,
      repo: parsedRepo.repo,
      branch: requestedBranch || parsedRepo.branch || cleanString(repoMeta?.default_branch) || DEFAULT_AGENCY_REPO_BRANCH,
      repoUrl: requestedRepoUrl || DEFAULT_AGENCY_REPO_URL,
    };
  }

  async function listGitHubMarkdownFiles({ owner, repo, branch }) {
    const tree = await fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const files = [];

    for (const item of Array.isArray(tree?.tree) ? tree.tree : []) {
      if (item?.type !== 'blob' || !shouldImportMarkdownPath(item?.path)) continue;
      files.push(buildImportFile(item.path, {
        downloadUrl: `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${normalizeRelativePath(item.path)}`,
      }));
    }

    return files;
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let cursor = 0;

    async function worker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    }

    const workerCount = Math.max(1, Math.min(limit, items.length || 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  async function readBundledAgencyCatalog() {
    if (!bundledCatalogPath) {
      return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: null,
        repoUrl: DEFAULT_AGENCY_REPO_URL,
        branch: DEFAULT_AGENCY_REPO_BRANCH,
        agents: [],
      };
    }

    const parsed = await readJson(bundledCatalogPath, {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: null,
      repoUrl: DEFAULT_AGENCY_REPO_URL,
      branch: DEFAULT_AGENCY_REPO_BRANCH,
      agents: [],
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: optionalString(parsed?.generatedAt) || null,
      repoUrl: optionalString(parsed?.repoUrl) || DEFAULT_AGENCY_REPO_URL,
      branch: optionalString(parsed?.branch) || DEFAULT_AGENCY_REPO_BRANCH,
      agents: Array.isArray(parsed?.agents) ? parsed.agents : [],
    };
  }

  async function ensureAgentStudioDir(hermes) {
    await fs.mkdir(hermes.paths.agentStudioDir, { recursive: true });
  }

  async function readJson(filePath, fallback) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch {
      return fallback;
    }
  }

  async function writeJson(filePath, value) {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  }

  async function seedLibraryFromBundledCatalog(hermes) {
    const bundledCatalog = await readBundledAgencyCatalog();
    const agents = Array.isArray(bundledCatalog.agents)
      ? [...bundledCatalog.agents].sort(sortAgentDefinitions)
      : [];
    const bundledCatalogSeededAt = nowIso();

    await ensureAgentStudioDir(hermes);
    await writeJson(hermes.paths.agentStudioLibrary, {
      schemaVersion: SCHEMA_VERSION,
      agents,
      bundledCatalogSeededAt,
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      agents,
      bundledCatalogSeededAt,
    };
  }

  async function readLibrary(hermes) {
    const parsed = await readJson(hermes.paths.agentStudioLibrary, { schemaVersion: SCHEMA_VERSION, agents: [] });
    const agents = Array.isArray(parsed?.agents) ? parsed.agents : [];
    const bundledCatalogSeededAt = optionalString(parsed?.bundledCatalogSeededAt);

    if (agents.length === 0 && !bundledCatalogSeededAt && autoSeedBundledCatalog) {
      return seedLibraryFromBundledCatalog(hermes);
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      agents,
      ...(bundledCatalogSeededAt ? { bundledCatalogSeededAt } : {}),
    };
  }

  async function writeLibrary(hermes, agents, metadata = {}) {
    await ensureAgentStudioDir(hermes);
    const current = metadata?.bundledCatalogSeededAt === undefined
      ? await readJson(hermes.paths.agentStudioLibrary, { schemaVersion: SCHEMA_VERSION, agents: [] })
      : null;
    const bundledCatalogSeededAt = metadata?.bundledCatalogSeededAt === undefined
      ? optionalString(current?.bundledCatalogSeededAt)
      : optionalString(metadata?.bundledCatalogSeededAt);

    await writeJson(hermes.paths.agentStudioLibrary, {
      schemaVersion: SCHEMA_VERSION,
      agents,
      ...(bundledCatalogSeededAt ? { bundledCatalogSeededAt } : {}),
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      agents,
      ...(bundledCatalogSeededAt ? { bundledCatalogSeededAt } : {}),
    };
  }

  async function readWorkspaces(hermes) {
    const parsed = await readJson(hermes.paths.agentStudioWorkspaces, { schemaVersion: SCHEMA_VERSION, workspaces: [] });
    return {
      schemaVersion: SCHEMA_VERSION,
      workspaces: Array.isArray(parsed?.workspaces) ? parsed.workspaces : [],
    };
  }

  async function writeWorkspaces(hermes, workspaces) {
    await ensureAgentStudioDir(hermes);
    await writeJson(hermes.paths.agentStudioWorkspaces, { schemaVersion: SCHEMA_VERSION, workspaces });
    return { schemaVersion: SCHEMA_VERSION, workspaces };
  }

  async function createAgent(hermes, payload) {
    const store = await readLibrary(hermes);
    const agent = normalizeAgent(payload);
    const nextAgents = [agent, ...store.agents];
    await writeLibrary(hermes, nextAgents);
    return { success: true, agent };
  }

  async function updateAgent(hermes, id, patch) {
    const store = await readLibrary(hermes);
    const index = store.agents.findIndex(agent => agent.id === id);
    if (index === -1) throw createHttpError(404, 'Agent definition not found');
    const agent = normalizeAgent({ ...store.agents[index], ...patch, id }, store.agents[index]);
    const nextAgents = [...store.agents];
    nextAgents[index] = agent;
    await writeLibrary(hermes, nextAgents);
    return { success: true, agent };
  }

  async function updatePreferredSkills(hermes, payload = {}) {
    const updates = Array.isArray(payload?.updates) ? payload.updates : [];
    const updatesById = new Map();
    for (const update of updates) {
      const id = cleanString(update?.id);
      if (!id) continue;
      updatesById.set(id, asStringArray(update?.preferredSkills));
    }
    if (updatesById.size === 0) throw createHttpError(400, 'No preferred skill updates provided');

    const store = await readLibrary(hermes);
    let updated = 0;
    let skipped = 0;
    const nextAgents = store.agents.map(agent => {
      if (!updatesById.has(agent.id)) return agent;
      const preferredSkills = updatesById.get(agent.id);
      if (arraysEqual(agent.preferredSkills || [], preferredSkills)) {
        skipped += 1;
        return agent;
      }
      updated += 1;
      return normalizeAgent({ ...agent, preferredSkills }, agent);
    });

    const foundIds = new Set(store.agents.map(agent => agent.id));
    for (const id of updatesById.keys()) {
      if (!foundIds.has(id)) skipped += 1;
    }

    await writeLibrary(hermes, nextAgents);
    return { success: true, updated, skipped, agents: nextAgents };
  }

  async function deleteAgent(hermes, id) {
    const store = await readLibrary(hermes);
    const nextAgents = store.agents.filter(agent => agent.id !== id);
    if (nextAgents.length === store.agents.length) throw createHttpError(404, 'Agent definition not found');
    await writeLibrary(hermes, nextAgents);
    return { success: true };
  }

  async function applyAgent(hermes, id) {
    const store = await readLibrary(hermes);
    const agent = store.agents.find(item => item.id === id);
    if (!agent) throw createHttpError(404, 'Agent definition not found');

    await fs.writeFile(hermes.paths.soul, agent.soul || '', 'utf-8');

    let updatedConfig = false;
    if (agent.defaultModel && runtimeFilesService) {
      const config = await runtimeFilesService.readYamlConfig(hermes);
      if (!config.model) config.model = {};
      config.model.default = agent.defaultModel;
      await runtimeFilesService.writeYamlConfig(hermes, config);
      updatedConfig = true;
    }

    return {
      success: true,
      applied: {
        id: agent.id,
        name: agent.name,
        wroteSoul: true,
        updatedConfig,
        profile: hermes.profile,
      },
    };
  }

  async function listMarkdownFiles(rootPath) {
    const files = [];
    async function walk(dir, relativeParts = []) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (EXCLUDED_IMPORT_DIRS.has(entry.name.toLowerCase())) continue;
          await walk(path.join(dir, entry.name), [...relativeParts, entry.name]);
          continue;
        }
        const relativePath = [...relativeParts, entry.name].join('/');
        if (entry.isFile() && shouldImportMarkdownPath(relativePath)) {
          files.push(buildImportFile(relativePath, { absolutePath: path.join(dir, entry.name) }));
        }
      }
    }
    await walk(rootPath);
    return files;
  }

  async function importAgencyAgents(hermes, payload) {
    const rootPath = cleanString(payload?.rootPath);
    const repoUrl = cleanString(payload?.repoUrl);
    const bundled = payload?.bundled === true;
    const mode = bundled ? 'bundled' : (rootPath ? 'local' : 'github');

    const store = await readLibrary(hermes);
    const existingBySourcePath = new Map(
      store.agents
        .map(agent => [catalogSourcePathKey(agent.source, agent.sourcePath), agent])
        .filter(([key]) => key)
    );
    const nextById = new Map(
      store.agents
        .filter(agent => mode !== 'bundled' || !isManagedCatalogAgent(agent))
        .map(agent => [agent.id, agent])
    );
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    if (mode === 'bundled') {
      const bundledCatalog = await readBundledAgencyCatalog();
      for (const bundledAgent of bundledCatalog.agents) {
        try {
          const source = normalizeSource(bundledAgent?.source, 'agency-agents');
          const sourcePath = cleanString(bundledAgent?.sourcePath);
          if (!sourcePath) {
            skipped += 1;
            continue;
          }

          const existing = existingBySourcePath.get(catalogSourcePathKey(source, sourcePath));
          const importedAgent = normalizeAgent({
            ...bundledAgent,
            id: existing?.id || bundledAgent?.id || stableId('agency', sourcePath),
            source,
            sourcePath,
          }, existing);

          nextById.set(importedAgent.id, importedAgent);
          if (existing) updated += 1;
          else imported += 1;
        } catch {
          skipped += 1;
        }
      }

      const agents = Array.from(nextById.values()).sort(sortAgentDefinitions);
      await writeLibrary(hermes, agents, { bundledCatalogSeededAt: nowIso() });
      return { imported, updated, skipped, agents };
    }

    let markdownFiles = [];
    let readMarkdown;

    if (mode === 'local') {
      const stat = await fs.stat(rootPath).catch(() => null);
      if (!stat?.isDirectory()) throw createHttpError(400, 'rootPath must be an existing directory');
      markdownFiles = await listMarkdownFiles(rootPath);
      readMarkdown = file => fs.readFile(file.absolutePath, 'utf-8');
    } else {
      const repo = await resolveGitHubRepo({ repoUrl, branch: payload?.branch });
      markdownFiles = await listGitHubMarkdownFiles(repo);
      readMarkdown = file => fetchText(file.downloadUrl);
    }

    await mapWithConcurrency(markdownFiles, GITHUB_MARKDOWN_CONCURRENCY, async (file) => {
      try {
        const markdown = await readMarkdown(file);
        const { data, body } = parseFrontmatter(markdown, yaml);
        const slug = slugify(path.basename(file.relativePath, '.md'));
        const soul = cleanString(body);
        if (!soul) {
          skipped += 1;
          return;
        }

        const existing = existingBySourcePath.get(catalogSourcePathKey('agency-agents', file.relativePath));
        const importedAgent = normalizeAgent({
          id: existing?.id || stableId('agency', file.relativePath),
          source: 'agency-agents',
          sourcePath: file.relativePath,
          slug,
          name: cleanString(data?.name) || titleFromSlug(slug),
          description: data?.description,
          division: cleanString(data?.division) || file.division,
          color: data?.color,
          emoji: data?.emoji,
          vibe: data?.vibe,
          soul,
          workflow: data?.workflow,
          deliverables: data?.deliverables,
          successMetrics: data?.successMetrics,
          preferredSkills: data?.preferredSkills,
          preferredToolsets: data?.preferredToolsets,
          defaultModel: data?.defaultModel,
          tags: data?.tags,
        }, existing);

        nextById.set(importedAgent.id, importedAgent);
        if (existing) updated += 1;
        else imported += 1;
      } catch {
        skipped += 1;
      }
    });

    const agents = Array.from(nextById.values()).sort(sortAgentDefinitions);
    await writeLibrary(hermes, agents);
    return { imported, updated, skipped, agents };
  }

  async function createWorkspace(hermes, payload) {
    const store = await readWorkspaces(hermes);
    const workspace = normalizeWorkspace(payload || {});
    const nextWorkspaces = [workspace, ...store.workspaces];
    await writeWorkspaces(hermes, nextWorkspaces);
    return { success: true, workspace };
  }

  async function updateWorkspace(hermes, id, patch) {
    const store = await readWorkspaces(hermes);
    const index = store.workspaces.findIndex(workspace => workspace.id === id);
    if (index === -1) throw createHttpError(404, 'Workspace not found');
    const workspace = normalizeWorkspace({ ...store.workspaces[index], ...patch, id }, store.workspaces[index]);
    const nextWorkspaces = [...store.workspaces];
    nextWorkspaces[index] = workspace;
    await writeWorkspaces(hermes, nextWorkspaces);
    return { success: true, workspace };
  }

  async function deleteWorkspace(hermes, id) {
    const store = await readWorkspaces(hermes);
    const nextWorkspaces = store.workspaces.filter(workspace => workspace.id !== id);
    if (nextWorkspaces.length === store.workspaces.length) throw createHttpError(404, 'Workspace not found');
    await writeWorkspaces(hermes, nextWorkspaces);
    return { success: true };
  }

  async function getWorkspaceExecutionContext(hermes, id) {
    const workspaceStore = await readWorkspaces(hermes);
    const workspace = workspaceStore.workspaces.find(item => item.id === id);
    if (!workspace) throw createHttpError(404, 'Workspace not found');
    if (!Array.isArray(workspace.nodes) || workspace.nodes.length === 0) {
      throw createHttpError(400, 'Workspace has no agents');
    }

    const library = await readLibrary(hermes);
    const agentsById = new Map(library.agents.map(agent => [agent.id, agent]));
    return { workspace, agentsById };
  }

  async function generateWorkspacePrompt(hermes, id) {
    const { workspace, agentsById } = await getWorkspaceExecutionContext(hermes, id);
    return { prompt: buildWorkspacePrompt(workspace, agentsById) };
  }

  async function runWorkspaceWithGateway(hermes, workspace, agentsById, payload = {}, runners = {}, { executePromptMode = false } = {}) {
    const mode = VALID_MODES.has(payload?.mode) ? payload.mode : workspace.defaultMode;
    const task = cleanString(payload?.task);
    const prompt = buildWorkspacePrompt(workspace, agentsById, { task });

    if (mode === 'prompt' && !executePromptMode) {
      return { success: true, mode, status: 'ready', prompt };
    }

    if (!runners.postGatewayChatCompletion) {
      throw createHttpError(501, 'Workspace execution bridge is not configured');
    }

    if (mode === 'prompt') {
      const response = await runners.postGatewayChatCompletion(hermes, {
        ...(payload?.model ? { model: cleanString(payload.model) } : {}),
        source: 'agent-studio-workspace-interface',
        session_title: `Workspace Chat: ${workspace.name}`,
        messages: [{ role: 'user', content: prompt }],
      });
      return {
        success: true,
        mode,
        status: 'completed',
        prompt,
        output: extractAssistantContent(response),
        response,
      };
    }

    if (mode === 'delegate') {
      const delegatePrompt = buildDelegateBridgePrompt(workspace, prompt);
      const response = await runners.postGatewayChatCompletion(hermes, {
        ...(payload?.model ? { model: cleanString(payload.model) } : {}),
        source: 'agent-studio-delegate',
        session_title: `Workspace Delegate: ${workspace.name}`,
        messages: [{ role: 'user', content: delegatePrompt }],
      });
      return {
        success: true,
        mode,
        status: 'completed',
        prompt: delegatePrompt,
        output: extractAssistantContent(response),
        response,
      };
    }

    const runs = [];
    for (const node of workspace.nodes) {
      const agent = agentsById.get(node.agentId);
      const profileName = cleanString(node.profileName) || hermes.profile || 'default';
      const targetHermes = node.profileName && runners.getHermesContext
        ? await runners.getHermesContext(profileName)
        : hermes;
      const nodePrompt = buildProfileNodePrompt(workspace, node, agent, agentsById, { task });
      const response = await runners.postGatewayChatCompletion(targetHermes, {
        ...(node.modelOverride ? { model: node.modelOverride } : {}),
        source: 'agent-studio-profile-runtime',
        session_title: `Workspace ${workspace.name}: ${cleanString(node.label) || agent?.name || node.id}`,
        messages: [{ role: 'user', content: nodePrompt }],
      });
      runs.push({
        nodeId: node.id,
        agentId: node.agentId,
        label: cleanString(node.label) || agent?.name || node.id,
        role: node.role,
        profileName,
        output: extractAssistantContent(response),
        response,
      });
    }

    return {
      success: true,
      mode,
      status: 'completed',
      prompt,
      runs,
      output: runs.map(run => `## ${run.label} (${run.profileName})\n${run.output || '(no output)'}`).join('\n\n'),
    };
  }

  async function executeWorkspace(hermes, id, payload = {}, runners = {}) {
    const { workspace, agentsById } = await getWorkspaceExecutionContext(hermes, id);
    return runWorkspaceWithGateway(hermes, workspace, agentsById, payload, runners);
  }

  async function chatWorkspace(hermes, id, payload = {}, runners = {}) {
    const task = cleanString(payload?.task);
    if (!task) throw createHttpError(400, 'Workspace chat task is required');
    const { workspace, agentsById } = await getWorkspaceExecutionContext(hermes, id);
    return runWorkspaceWithGateway(hermes, workspace, agentsById, payload, runners, { executePromptMode: true });
  }

  return {
    readLibrary,
    createAgent,
    updateAgent,
    updatePreferredSkills,
    deleteAgent,
    applyAgent,
    importAgencyAgents,
    readWorkspaces,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    generateWorkspacePrompt,
    executeWorkspace,
    chatWorkspace,
  };
}
