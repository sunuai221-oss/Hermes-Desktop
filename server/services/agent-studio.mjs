import crypto from 'crypto';

const SCHEMA_VERSION = 1;
const EXCLUDED_IMPORT_DIRS = new Set(['.git', 'docs', 'strategy', 'integrations', 'examples', 'node_modules']);
const EXCLUDED_IMPORT_FILES = new Set(['readme.md', 'license.md', 'changelog.md', 'contributing.md']);
const MANAGED_CATALOG_SOURCES = new Set(['agency-agents', 'aliasrobotics-cai']);
const VALID_ROLES = new Set(['orchestrator', 'worker', 'reviewer', 'qa', 'observer']);
const VALID_EDGE_KINDS = new Set(['handoff', 'review', 'qa', 'broadcast', 'escalation']);
const VALID_MODES = new Set(['prompt', 'delegate', 'profiles']);
const VALID_PROFILE_NAME_PATTERN = /^[\w.-]+$/;
const BLOCKING_EXECUTION_EDGE_KINDS = new Set(['handoff', 'review', 'qa']);
const CONTEXTUAL_EXECUTION_EDGE_KINDS = new Set(['broadcast', 'escalation']);
const ACTIVE_RUN_STATUSES = new Set(['queued', 'running']);
const OPEN_PANDAS_DATASET_EXTENSIONS = new Set([
  '.csv',
  '.tsv',
  '.txt',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.json',
  '.parquet',
]);
const TOOLSET_MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;
const TOOLSET_OPEN_PANDAS_TIMEOUT_MS = 8 * 60 * 1000;
const TOOLSET_OPEN_PANDAS_POLL_INTERVAL_MS = 1200;
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

function normalizeProfileName(value, {
  fieldLabel = 'Workspace node profileName',
  onInvalid = 'throw',
} = {}) {
  const cleaned = optionalString(value);
  if (!cleaned) return undefined;
  if (VALID_PROFILE_NAME_PATTERN.test(cleaned)) return cleaned;
  if (onInvalid === 'ignore') return undefined;
  throw createHttpError(400, `${fieldLabel} can only contain letters, numbers, ".", "_" and "-".`);
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

function sanitizeUploadFileName(value, fallback = 'attachment.bin') {
  const raw = cleanString(value);
  const normalized = raw
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+/, '')
    .replace(/\.+$/, '');
  if (!normalized) return fallback;
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function parseDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || '').toLowerCase() || 'application/octet-stream',
    base64: match[2].replace(/\s+/g, ''),
  };
}

function decodeAttachmentBytes(rawPayload, label) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : null;
  if (!payload) return null;

  let base64 = cleanString(payload.base64);
  let mimeType = cleanString(payload.mimeType).toLowerCase() || 'application/octet-stream';
  if (!base64) {
    const parsedDataUrl = parseDataUrl(payload.dataUrl);
    if (parsedDataUrl) {
      base64 = parsedDataUrl.base64;
      mimeType = mimeType || parsedDataUrl.mimeType;
    }
  }
  if (!base64) return null;

  let bytes;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw createHttpError(400, `${label} contains invalid base64 data`);
  }
  if (!bytes.length) throw createHttpError(400, `${label} is empty`);
  if (bytes.length > TOOLSET_MAX_ATTACHMENT_BYTES) {
    throw createHttpError(413, `${label} exceeds ${TOOLSET_MAX_ATTACHMENT_BYTES} bytes`);
  }

  const fileName = sanitizeUploadFileName(payload.fileName, `${label}.bin`);
  const extensionMatch = fileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
  return {
    fileName,
    extension,
    mimeType,
    bytes,
  };
}

function extractDatasetCandidatesFromText(content) {
  const text = String(content || '');
  if (!text) return [];

  const matches = text.match(/[A-Za-z0-9_\-./\\]+\.(csv|tsv|txt|xls|xlsx|xlsm|json|parquet)\b/gi) || [];
  const deduped = [];
  const seen = new Set();
  for (const match of matches) {
    const normalized = String(match || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= 12) break;
  }
  return deduped;
}

function summarizeOpenPandasPayload(payload) {
  const summaryText = cleanString(payload?.summary?.text || payload?.summary?.interpretation);
  const status = cleanString(payload?.status || 'unknown');
  const shape = Array.isArray(payload?.dataset?.shape)
    ? payload.dataset.shape.join(' x ')
    : '';
  const chartCount = Array.isArray(payload?.charts) ? payload.charts.length : 0;
  const warningsCount = Array.isArray(payload?.warnings) ? payload.warnings.length : 0;

  const lines = [`Open_Pandas_AI status: ${status}.`];
  if (shape) lines.push(`Dataset shape: ${shape}.`);
  if (summaryText) lines.push(`Summary: ${summaryText}`);
  if (chartCount > 0) lines.push(`Charts generated: ${chartCount}.`);
  if (warningsCount > 0) lines.push(`Warnings: ${warningsCount}.`);
  return lines.join('\n');
}

function parseToolsetOptions(payload) {
  const options = payload?.toolsetOptions;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return {};
  return options;
}

function normalizeNodeToolsets(node) {
  return asStringArray(node?.toolsets).map(item => cleanString(item).toLowerCase()).filter(Boolean);
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
    ...(normalizeProfileName(input?.profileName) ? { profileName: normalizeProfileName(input.profileName) } : {}),
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
    ...(optionalString(input?.pipelineBrief) ? { pipelineBrief: optionalString(input.pipelineBrief) } : {}),
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
  appendSection(lines, 'Pipeline Brief', workspace.pipelineBrief);
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

  const upstreamByKind = options.upstreamByKind || {};
  const handoffInputs = Array.isArray(upstreamByKind.handoff) ? upstreamByKind.handoff : [];
  const reviewInputs = Array.isArray(upstreamByKind.review) ? upstreamByKind.review : [];
  const qaInputs = Array.isArray(upstreamByKind.qa) ? upstreamByKind.qa : [];
  const broadcastInputs = Array.isArray(upstreamByKind.broadcast) ? upstreamByKind.broadcast : [];
  const escalationInputs = Array.isArray(upstreamByKind.escalation) ? upstreamByKind.escalation : [];

  const appendUpstreamSection = (title, items) => {
    if (!Array.isArray(items) || items.length === 0) return;
    lines.push(`## ${title}`, '');
    for (const item of items) {
      const upstreamLabel = cleanString(item?.label) || item?.nodeId || 'Upstream node';
      const upstreamProfile = cleanString(item?.profileName) || 'default';
      const upstreamStatus = cleanString(item?.status) || 'unknown';
      const upstreamOutput = cleanString(item?.output) || '(no output)';
      const template = cleanString(item?.template);
      lines.push(`### ${upstreamLabel} (${upstreamProfile}) [${upstreamStatus}]`, '');
      if (template) lines.push(`Edge instruction: ${template}`, '');
      lines.push(upstreamOutput, '');
    }
  };

  appendUpstreamSection('Handoff Inputs', handoffInputs);
  appendUpstreamSection('Review Inputs', reviewInputs);
  appendUpstreamSection('QA Inputs', qaInputs);
  appendUpstreamSection('Broadcast Inputs', broadcastInputs);
  appendUpstreamSection('Escalation Inputs', escalationInputs);

  if (handoffInputs.length || reviewInputs.length || qaInputs.length || broadcastInputs.length || escalationInputs.length) {
    lines.push('## Downstream Assembly Rules', '');
    if (handoffInputs.length) lines.push('- Treat Handoff Inputs as primary implementation context to continue from.');
    if (reviewInputs.length) lines.push('- Treat Review Inputs as critiques to address explicitly; mark resolved vs unresolved points.');
    if (qaInputs.length) lines.push('- Treat QA Inputs as validation constraints and test obligations before finalizing.');
    if (broadcastInputs.length) lines.push('- Treat Broadcast Inputs as shared situational context; incorporate only the relevant signals into your response.');
    if (escalationInputs.length) lines.push('- Treat Escalation Inputs as risk or severity alerts that must be acknowledged explicitly if they affect your outcome.');
    lines.push('');
  }

  if (node.role === 'reviewer') {
    lines.push('## Reviewer Focus', '', 'Review upstream outputs for correctness, gaps, and risk. Return concrete fixes and clear pass/fail reasoning.', '');
  }
  if (node.role === 'qa') {
    lines.push('## QA Focus', '', 'Validate acceptance criteria, edge cases, and testability. Return explicit verification steps and any blocking issues.', '');
  }

  const toolsetContext = cleanString(options.toolsetContext);
  if (toolsetContext) lines.push(toolsetContext, '');
  if (node.skills?.length) lines.push('## Skills', '', node.skills.join(', '), '');
  if (node.toolsets?.length) lines.push('## Toolsets', '', node.toolsets.join(', '), '');
  if (agent?.soul) appendSection(lines, 'Agent Identity', agent.soul);
  lines.push('## Task', '', options.task || 'Execute your part of this workspace and return a concise result for the orchestrator.', '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildWorkspaceRunSessionSource(mode) {
  if (mode === 'delegate') return 'agent-studio-delegate';
  if (mode === 'profiles') return 'agent-studio-profile-runtime';
  return 'agent-studio-workspace-task-runner';
}

function buildWorkspaceRunSessionTitle(workspace, mode) {
  if (mode === 'delegate') return `Workspace Delegate: ${workspace.name}`;
  if (mode === 'profiles') return `Workspace Profile Runtime: ${workspace.name}`;
  return `Workspace Task Run: ${workspace.name}`;
}

function buildWorkspaceRunSessionUserMessage(workspace, { mode, task, prompt }) {
  const lines = [
    `Workspace run requested for ${workspace.name}.`,
    `Mode: ${mode}`,
  ];
  if (task) lines.push('', 'Task:', task);
  if (prompt) lines.push('', 'Execution prompt:', prompt);
  return lines.join('\n').trim();
}

function buildWorkspaceRunSessionAssistantMessage(workspace, result) {
  const lines = [`Workspace run for ${workspace.name} ${result.status} in ${result.mode} mode.`];

  if (result.workflow?.counts) {
    const counts = result.workflow.counts;
    lines.push(
      '',
      `Workflow summary: ${counts.completed}/${counts.total} completed, ${counts.failed} failed, ${counts.blocked} blocked.`,
    );
    if (result.workflow.qaGate?.required) {
      lines.push(`QA gate: ${result.workflow.qaGate.status}.`);
    }
  }

  const output = cleanString(result.output);
  const error = cleanString(result.error);
  if (output) {
    lines.push('', output);
  } else if (error) {
    lines.push('', error);
  }

  return lines.join('\n').trim();
}

function sanitizeWorkspaceRunForSession(run) {
  if (!run || typeof run !== 'object') return run;
  const { response, ...rest } = run;
  return rest;
}

function buildWorkspaceRunSessionToolResults(workspace, result, { task }) {
  return {
    type: 'workspace_run',
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    mode: result.mode,
    status: result.status,
    success: Boolean(result.success),
    task: task || null,
    prompt: result.prompt || '',
    output: result.output || '',
    error: cleanString(result.error) || null,
    workflow: result.workflow || null,
    runs: Array.isArray(result.runs) ? result.runs.map(sanitizeWorkspaceRunForSession) : [],
  };
}

function buildProfilesExecutionPlan(workspace) {
  const nodes = Array.isArray(workspace?.nodes) ? workspace.nodes : [];
  const edges = Array.isArray(workspace?.edges) ? workspace.edges : [];
  const nodeById = new Map(nodes.map((node, index) => [node.id, { node, index }]));

  const incoming = new Map(nodes.map(node => [node.id, 0]));
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  const incomingEdgesByNodeId = new Map(nodes.map(node => [node.id, []]));

  for (const edge of edges) {
    const fromNodeId = cleanString(edge?.fromNodeId);
    const toNodeId = cleanString(edge?.toNodeId);
    if (!fromNodeId || !toNodeId) continue;
    if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) {
      throw createHttpError(400, `Workspace relation references missing node endpoint: ${fromNodeId} -> ${toNodeId}`);
    }
    const kind = VALID_EDGE_KINDS.has(edge?.kind) ? edge.kind : 'handoff';
    incomingEdgesByNodeId.get(toNodeId).push({
      fromNodeId,
      toNodeId,
      kind,
      template: cleanString(edge?.template),
    });
    if (!BLOCKING_EXECUTION_EDGE_KINDS.has(kind)) continue;
    adjacency.get(fromNodeId).push(toNodeId);
    incoming.set(toNodeId, (incoming.get(toNodeId) || 0) + 1);
  }

  const queue = nodes
    .filter(node => (incoming.get(node.id) || 0) === 0)
    .sort((left, right) => nodeById.get(left.id).index - nodeById.get(right.id).index)
    .map(node => node.id);

  const orderedNodeIds = [];
  const layers = [];
  while (queue.length > 0) {
    const currentLayer = [...queue].sort((leftId, rightId) => nodeById.get(leftId).index - nodeById.get(rightId).index);
    queue.length = 0;
    layers.push(currentLayer);

    for (const nodeId of currentLayer) {
      orderedNodeIds.push(nodeId);
      const neighbors = adjacency.get(nodeId) || [];
      for (const nextId of neighbors) {
        incoming.set(nextId, (incoming.get(nextId) || 0) - 1);
        if ((incoming.get(nextId) || 0) === 0) queue.push(nextId);
      }
    }
  }

  if (orderedNodeIds.length !== nodes.length) {
    const unresolvedNodeIds = nodes
      .map(node => node.id)
      .filter(nodeId => !orderedNodeIds.includes(nodeId));
    throw createHttpError(400, `Workspace relations contain a cycle. Nodes involved: ${unresolvedNodeIds.join(', ')}`);
  }

  return {
    orderedNodes: orderedNodeIds.map(nodeId => nodeById.get(nodeId).node),
    layers: layers.map(layer => layer.map(nodeId => nodeById.get(nodeId).node)),
    incomingEdgesByNodeId,
  };
}

function buildWorkspaceAutoConfigPrompt(workspace, agentsById, pipelineBrief) {
  const lines = [
    `# Workspace Auto-Config Planner: ${workspace.name}`,
    '',
    'You are configuring a multi-agent workspace from a user pipeline brief.',
    `Pipeline brief: ${pipelineBrief}`,
    '',
    'Constraints:',
    '- Use only existing node ids listed below.',
    '- Use only roles: orchestrator, worker, reviewer, qa, observer.',
    '- Use only relation kinds: handoff, review, qa, broadcast, escalation.',
    '- Use only execution modes: prompt, delegate, profiles.',
    '- Keep suggestions concise and practical.',
    '- Return strict JSON only (no markdown fences, no commentary).',
    '',
    'JSON schema:',
    '{',
    '  "summary": "short summary",',
    '  "workspacePatch": {',
    '    "description": "optional",',
    '    "pipelineBrief": "optional",',
    '    "sharedContext": "optional",',
    '    "commonRules": "optional",',
    '    "defaultMode": "prompt|delegate|profiles"',
    '  },',
    '  "nodes": [',
    '    {',
    '      "nodeId": "required existing node id",',
    '      "role": "optional role",',
    '      "label": "optional label",',
    '      "profileName": "optional profile name",',
    '      "modelOverride": "optional model",',
    '      "skills": ["optional", "skills"],',
    '      "toolsets": ["optional", "toolsets"]',
    '    }',
    '  ],',
    '  "edges": [',
    '    {',
    '      "fromNodeId": "required existing node id",',
    '      "toNodeId": "required existing node id",',
    '      "kind": "handoff|review|qa|broadcast|escalation",',
    '      "template": "optional short instruction"',
    '    }',
    '  ]',
    '}',
    '',
    'Current workspace snapshot:',
    '',
    `- Description: ${workspace.description || '(empty)'}`,
    `- Shared Context: ${workspace.sharedContext || '(empty)'}`,
    `- Common Rules: ${workspace.commonRules || '(empty)'}`,
    `- Default Mode: ${workspace.defaultMode || 'prompt'}`,
    '',
    'Nodes:',
  ];

  for (const node of workspace.nodes || []) {
    const agent = agentsById.get(node.agentId);
    lines.push(
      `- id=${node.id}; label=${getNodeLabel(node, agentsById)}; role=${node.role}; agentId=${node.agentId}; agentName=${agent?.name || 'missing'}`,
    );
    if (node.skills?.length) lines.push(`  skills=${node.skills.join(', ')}`);
    if (node.toolsets?.length) lines.push(`  toolsets=${node.toolsets.join(', ')}`);
    if (node.modelOverride) lines.push(`  model=${node.modelOverride}`);
  }

  if ((workspace.edges || []).length > 0) {
    lines.push('', 'Existing edges:');
    for (const edge of workspace.edges) {
      lines.push(`- ${edge.fromNodeId} -> ${edge.toNodeId} (${edge.kind})`);
    }
  }

  return lines.join('\n').trim();
}

function extractJsonCandidate(text) {
  const content = cleanString(text);
  if (!content) return '';

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return cleanString(fenced[1]);

  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return '';
  return content.slice(first, last + 1);
}

function normalizeAutoConfigWorkspacePatch(input, pipelineBrief) {
  const workspacePatch = {};
  const description = optionalString(input?.description);
  const sharedContext = optionalString(input?.sharedContext);
  const commonRules = optionalString(input?.commonRules);
  const suggestedBrief = optionalString(input?.pipelineBrief);

  if (description) workspacePatch.description = description;
  if (sharedContext) workspacePatch.sharedContext = sharedContext;
  if (commonRules) workspacePatch.commonRules = commonRules;
  if (VALID_MODES.has(input?.defaultMode)) workspacePatch.defaultMode = input.defaultMode;
  workspacePatch.pipelineBrief = suggestedBrief || pipelineBrief;
  return workspacePatch;
}

function normalizeAutoConfigNodePatches(input, workspace) {
  const validNodeIds = new Set((workspace.nodes || []).map(node => node.id));
  const nodePatches = [];
  const seen = new Set();

  for (const entry of Array.isArray(input) ? input : []) {
    const nodeId = cleanString(entry?.nodeId || entry?.id);
    if (!nodeId || !validNodeIds.has(nodeId) || seen.has(nodeId)) continue;

    const patch = { nodeId };
    if (VALID_ROLES.has(entry?.role)) patch.role = entry.role;
    if (optionalString(entry?.label)) patch.label = optionalString(entry.label);
    const profileName = normalizeProfileName(entry?.profileName, {
      fieldLabel: 'Workspace auto-config node profileName',
      onInvalid: 'ignore',
    });
    if (profileName) patch.profileName = profileName;
    if (optionalString(entry?.modelOverride)) patch.modelOverride = optionalString(entry.modelOverride);
    if (Object.prototype.hasOwnProperty.call(entry || {}, 'skills')) patch.skills = asStringArray(entry?.skills);
    if (Object.prototype.hasOwnProperty.call(entry || {}, 'toolsets')) patch.toolsets = asStringArray(entry?.toolsets);

    nodePatches.push(patch);
    seen.add(nodeId);
  }

  return nodePatches;
}

function normalizeAutoConfigEdges(input, workspace) {
  const validNodeIds = new Set((workspace.nodes || []).map(node => node.id));
  const edges = [];
  const seen = new Set();

  for (const entry of Array.isArray(input) ? input : []) {
    const fromNodeId = cleanString(entry?.fromNodeId || entry?.from);
    const toNodeId = cleanString(entry?.toNodeId || entry?.to);
    if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) continue;
    if (!validNodeIds.has(fromNodeId) || !validNodeIds.has(toNodeId)) continue;

    const kind = VALID_EDGE_KINDS.has(entry?.kind) ? entry.kind : 'handoff';
    const dedupeKey = `${fromNodeId}::${toNodeId}::${kind}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    edges.push({
      fromNodeId,
      toNodeId,
      kind,
      ...(optionalString(entry?.template) ? { template: optionalString(entry.template) } : {}),
    });
  }

  return edges;
}

function normalizeAutoConfigSuggestion(input, workspace, pipelineBrief) {
  const source = (input && typeof input === 'object' && input.suggestion && typeof input.suggestion === 'object')
    ? input.suggestion
    : input;
  const summary = optionalString(source?.summary) || 'Auto-configuration generated from pipeline brief.';
  return {
    summary,
    workspacePatch: normalizeAutoConfigWorkspacePatch(source?.workspacePatch || {}, pipelineBrief),
    nodes: normalizeAutoConfigNodePatches(source?.nodes, workspace),
    edges: normalizeAutoConfigEdges(source?.edges, workspace),
  };
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

  async function previewWorkspaceAutoConfig(hermes, id, payload = {}, runners = {}) {
    const { workspace, agentsById } = await getWorkspaceExecutionContext(hermes, id);
    const pipelineBrief = cleanString(payload?.pipelineBrief || workspace.pipelineBrief);
    if (!pipelineBrief) throw createHttpError(400, 'Pipeline brief is required');
    if (!runners.postGatewayChatCompletion) {
      throw createHttpError(501, 'Workspace auto-config bridge is not configured');
    }

    const prompt = buildWorkspaceAutoConfigPrompt(workspace, agentsById, pipelineBrief);
    const response = await runners.postGatewayChatCompletion(hermes, {
      ...(payload?.model ? { model: cleanString(payload.model) } : {}),
      source: 'agent-studio-auto-config',
      session_title: `Workspace Auto Config: ${workspace.name}`,
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = extractAssistantContent(response);
    const jsonCandidate = extractJsonCandidate(raw);
    if (!jsonCandidate) throw createHttpError(502, 'Auto-config response did not include valid JSON');

    let parsed;
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch {
      throw createHttpError(502, 'Auto-config response JSON could not be parsed');
    }

    return {
      success: true,
      workspaceId: workspace.id,
      pipelineBrief,
      prompt,
      suggestion: normalizeAutoConfigSuggestion(parsed, workspace, pipelineBrief),
      raw,
    };
  }

  function resolveWorkspaceRunAttachments(payload = {}) {
    const attachments = payload?.attachments && typeof payload.attachments === 'object' && !Array.isArray(payload.attachments)
      ? payload.attachments
      : {};

    const documentAttachment = decodeAttachmentBytes(
      attachments.document || payload.document,
      'document attachment',
    );
    let datasetAttachment = decodeAttachmentBytes(
      attachments.dataset || payload.dataset,
      'dataset attachment',
    );
    if (!datasetAttachment && documentAttachment && OPEN_PANDAS_DATASET_EXTENSIONS.has(documentAttachment.extension)) {
      datasetAttachment = documentAttachment;
    }

    return {
      document: documentAttachment,
      dataset: datasetAttachment,
    };
  }

  async function waitForOpenPandasRun(hermes, runId, runners, timeoutMs = TOOLSET_OPEN_PANDAS_TIMEOUT_MS) {
    if (!runners?.openPandasAiService?.getRun) {
      throw createHttpError(501, 'Open_Pandas_AI service is not available in this runtime');
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await runners.openPandasAiService.getRun(hermes, runId);
      if (!ACTIVE_RUN_STATUSES.has(run?.status)) return run;
      await new Promise(resolve => setTimeout(resolve, TOOLSET_OPEN_PANDAS_POLL_INTERVAL_MS));
    }

    throw createHttpError(504, `Open_Pandas_AI run ${runId} timed out after ${timeoutMs} ms`);
  }

  async function runDocumentParseToolset({
    hermes,
    sharedRuntimeState,
    runners,
    runDir,
  }) {
    const startedAt = nowIso();
    if (!runners?.documentParserService) {
      return {
        toolset: 'document_parse',
        status: 'skipped',
        summary: 'LiteParse parser service is not configured.',
        startedAt,
        finishedAt: nowIso(),
      };
    }

    const attachment = sharedRuntimeState?.attachments?.document || sharedRuntimeState?.attachments?.dataset || null;
    if (!attachment) {
      return {
        toolset: 'document_parse',
        status: 'skipped',
        summary: 'No document attachment provided for parsing.',
        startedAt,
        finishedAt: nowIso(),
      };
    }

    const parser = runners.documentParserService;
    const docDir = path.join(runDir, 'document-parse');
    await fs.mkdir(docDir, { recursive: true });
    const targetPath = path.join(docDir, attachment.fileName);
    await fs.writeFile(targetPath, attachment.bytes);

    if (typeof parser.isSupportedDocumentPath === 'function' && !parser.isSupportedDocumentPath(targetPath)) {
      return {
        toolset: 'document_parse',
        status: 'failed',
        summary: `Unsupported document extension for ${attachment.fileName}.`,
        error: 'unsupported_document_extension',
        startedAt,
        finishedAt: nowIso(),
      };
    }

    try {
      const parsed = await parser.parseDocument(hermes, {
        referenceValue: attachment.fileName,
        resolvedPath: targetPath,
        maxChars: 16000,
      });
      const datasetCandidates = extractDatasetCandidatesFromText(parsed?.content || '');

      sharedRuntimeState.parsedDocument = {
        fileName: attachment.fileName,
        content: String(parsed?.content || ''),
        warning: cleanString(parsed?.warning) || undefined,
        charCount: Number(parsed?.charCount || 0),
        pageCount: Number(parsed?.meta?.pageCount || 0),
        datasetCandidates,
      };

      if (!sharedRuntimeState.attachments.dataset && OPEN_PANDAS_DATASET_EXTENSIONS.has(attachment.extension)) {
        sharedRuntimeState.attachments.dataset = attachment;
      }

      const summaryParts = [
        `Parsed ${attachment.fileName}.`,
        sharedRuntimeState.parsedDocument.pageCount > 0
          ? `${sharedRuntimeState.parsedDocument.pageCount} page(s) extracted.`
          : `${sharedRuntimeState.parsedDocument.charCount} chars extracted.`,
      ];
      if (datasetCandidates.length > 0) {
        summaryParts.push(`Detected dataset references: ${datasetCandidates.join(', ')}.`);
      }

      return {
        toolset: 'document_parse',
        status: 'completed',
        summary: summaryParts.join(' '),
        data: {
          fileName: attachment.fileName,
          pageCount: sharedRuntimeState.parsedDocument.pageCount,
          charCount: sharedRuntimeState.parsedDocument.charCount,
          datasetCandidates,
          warning: sharedRuntimeState.parsedDocument.warning || null,
        },
        startedAt,
        finishedAt: nowIso(),
      };
    } catch (error) {
      return {
        toolset: 'document_parse',
        status: 'failed',
        summary: `LiteParse failed for ${attachment.fileName}.`,
        error: error?.message || 'document_parse_failed',
        startedAt,
        finishedAt: nowIso(),
      };
    }
  }

  async function runOpenPandasAnalysisToolset({
    hermes,
    task,
    payload,
    sharedRuntimeState,
    runners,
  }) {
    const startedAt = nowIso();
    if (!runners?.openPandasAiService?.startAnalysis || !runners?.openPandasAiService?.getRun) {
      return {
        toolset: 'open_pandas_analysis',
        status: 'skipped',
        summary: 'Open_Pandas_AI connector is not available in this runtime.',
        startedAt,
        finishedAt: nowIso(),
      };
    }

    const datasetAttachment = sharedRuntimeState?.attachments?.dataset || null;
    if (!datasetAttachment) {
      return {
        toolset: 'open_pandas_analysis',
        status: 'skipped',
        summary: 'No dataset attachment available for Open_Pandas_AI.',
        startedAt,
        finishedAt: nowIso(),
      };
    }

    if (!OPEN_PANDAS_DATASET_EXTENSIONS.has(datasetAttachment.extension)) {
      return {
        toolset: 'open_pandas_analysis',
        status: 'failed',
        summary: `Dataset extension ${datasetAttachment.extension || '(none)'} is not supported by Open_Pandas_AI.`,
        error: 'unsupported_dataset_extension',
        startedAt,
        finishedAt: nowIso(),
      };
    }

    const toolsetOptions = parseToolsetOptions(payload);
    const openPandasOptions = (
      toolsetOptions.open_pandas_analysis
      && typeof toolsetOptions.open_pandas_analysis === 'object'
      && !Array.isArray(toolsetOptions.open_pandas_analysis)
    ) ? toolsetOptions.open_pandas_analysis : {};

    const question = cleanString(
      payload?.analysisQuestion
      || openPandasOptions.question
      || task
      || `Analyze dataset ${datasetAttachment.fileName} and report actionable insights`,
    );
    const options = (
      openPandasOptions.options
      && typeof openPandasOptions.options === 'object'
      && !Array.isArray(openPandasOptions.options)
    ) ? openPandasOptions.options : {};

    try {
      const started = await runners.openPandasAiService.startAnalysis(hermes, {
        question,
        dataset: {
          fileName: datasetAttachment.fileName,
          base64: datasetAttachment.bytes.toString('base64'),
          mimeType: datasetAttachment.mimeType,
        },
        options,
      });
      const run = await waitForOpenPandasRun(hermes, started.runId, runners, TOOLSET_OPEN_PANDAS_TIMEOUT_MS);
      const resultPayload = run?.result && typeof run.result === 'object' ? run.result : null;
      const engineStatus = cleanString(resultPayload?.status || run?.engineStatus || run?.status || 'unknown');
      const success = run?.status === 'succeeded' && engineStatus === 'success';
      const summary = resultPayload
        ? summarizeOpenPandasPayload(resultPayload)
        : `Open_Pandas_AI run status: ${run?.status || 'unknown'}.`;

      sharedRuntimeState.openPandas = {
        runId: started.runId,
        question,
        status: run?.status || 'unknown',
        engineStatus,
        payload: resultPayload,
      };

      if (!success) {
        const errorMessage = cleanString(
          run?.error?.message
          || resultPayload?.errors?.message
          || `Open_Pandas_AI run finished with status ${run?.status || 'unknown'}`,
        );
        return {
          toolset: 'open_pandas_analysis',
          status: 'failed',
          summary,
          error: errorMessage,
          data: {
            runId: started.runId,
            runStatus: run?.status || null,
            engineStatus,
          },
          startedAt,
          finishedAt: nowIso(),
        };
      }

      return {
        toolset: 'open_pandas_analysis',
        status: 'completed',
        summary,
        data: {
          runId: started.runId,
          runStatus: run?.status || null,
          engineStatus,
          contractVersion: resultPayload?.contract_version || null,
        },
        startedAt,
        finishedAt: nowIso(),
      };
    } catch (error) {
      return {
        toolset: 'open_pandas_analysis',
        status: 'failed',
        summary: 'Open_Pandas_AI analysis failed before completion.',
        error: error?.message || 'open_pandas_analysis_failed',
        startedAt,
        finishedAt: nowIso(),
      };
    }
  }

  async function executeNodeToolsets({
    hermes,
    node,
    task,
    payload,
    sharedRuntimeState,
    runners,
    runDir,
  }) {
    const configuredToolsets = normalizeNodeToolsets(node);
    if (configuredToolsets.length === 0) return [];

    const outputs = [];
    for (const toolset of configuredToolsets) {
      if (toolset === 'document_parse') {
        outputs.push(await runDocumentParseToolset({
          hermes,
          sharedRuntimeState,
          runners,
          runDir,
        }));
        continue;
      }

      if (toolset === 'open_pandas_analysis') {
        outputs.push(await runOpenPandasAnalysisToolset({
          hermes,
          task,
          payload,
          sharedRuntimeState,
          runners,
        }));
        continue;
      }

      outputs.push({
        toolset,
        status: 'skipped',
        summary: `No runtime executor configured for toolset "${toolset}".`,
        startedAt: nowIso(),
        finishedAt: nowIso(),
      });
    }
    return outputs;
  }

  function buildToolsetPromptContext(toolsetOutputs) {
    const outputs = Array.isArray(toolsetOutputs) ? toolsetOutputs : [];
    if (outputs.length === 0) return '';

    const lines = ['## Toolset Runtime Results', ''];
    for (const output of outputs) {
      lines.push(`### ${output.toolset} [${output.status}]`, '');
      if (output.summary) lines.push(output.summary, '');
      if (output.error) lines.push(`Error: ${output.error}`, '');
    }
    return lines.join('\n').trim();
  }

  async function runWorkspaceWithGateway(hermes, workspace, agentsById, payload = {}, runners = {}, { executePromptMode = false } = {}) {
    const mode = VALID_MODES.has(payload?.mode) ? payload.mode : workspace.defaultMode;
    const task = cleanString(payload?.task);
    const prompt = buildWorkspacePrompt(workspace, agentsById, { task });
    const runModel = cleanString(payload?.model) || null;
    const delegatePrompt = mode === 'delegate' ? buildDelegateBridgePrompt(workspace, prompt) : '';
    const sessionPrompt = delegatePrompt || prompt;

    if (mode === 'prompt' && !executePromptMode) {
      return { success: true, mode, status: 'ready', prompt };
    }

    if (!runners.postGatewayChatCompletion) {
      throw createHttpError(501, 'Workspace execution bridge is not configured');
    }

    const sessionSource = buildWorkspaceRunSessionSource(mode);
    const sessionTitle = buildWorkspaceRunSessionTitle(workspace, mode);
    const sessionId = runners.startWorkspaceRunSession
      ? await runners.startWorkspaceRunSession(hermes, {
          source: sessionSource,
          title: sessionTitle,
          model: runModel,
          workspace,
          mode,
          task,
          prompt: sessionPrompt,
          userMessage: buildWorkspaceRunSessionUserMessage(workspace, { mode, task, prompt: sessionPrompt }),
        })
      : null;

    const finishWorkspaceRunSession = async (result) => {
      if (!sessionId || !runners.finishWorkspaceRunSession) return sessionId;
      await runners.finishWorkspaceRunSession(hermes, {
        sessionId,
        source: sessionSource,
        title: sessionTitle,
        model: runModel,
        workspace,
        mode,
        task,
        prompt: result.prompt || sessionPrompt,
        assistantMessage: buildWorkspaceRunSessionAssistantMessage(workspace, result),
        toolName: 'workspace_run',
        toolResults: buildWorkspaceRunSessionToolResults(workspace, result, { task }),
      });
      return sessionId;
    };
    let persistingCompletion = false;
    const sharedRuntimeState = {
      attachments: mode === 'profiles'
        ? resolveWorkspaceRunAttachments(payload)
        : { document: null, dataset: null },
      parsedDocument: null,
      openPandas: null,
    };
    const profileRuntimeRunRoot = path.join(
      hermes?.paths?.appState || hermes?.home || '.',
      'agent-studio',
      'workspace-runs',
      generatedId('workspace_run'),
    );

    try {
      if (mode === 'prompt') {
        const response = await runners.postGatewayChatCompletion(hermes, {
          ...(runModel ? { model: runModel } : {}),
          source: sessionSource,
          session_title: sessionTitle,
          workspace_id: workspace.id,
          workspace_name: workspace.name,
          messages: [{ role: 'user', content: prompt }],
        });
        const result = {
          success: true,
          mode,
          status: 'completed',
          prompt,
          output: extractAssistantContent(response),
          response,
        };
        persistingCompletion = true;
        await finishWorkspaceRunSession(result);
        return sessionId ? { ...result, session_id: sessionId } : result;
      }

      if (mode === 'delegate') {
        const response = await runners.postGatewayChatCompletion(hermes, {
          ...(runModel ? { model: runModel } : {}),
          source: sessionSource,
          session_title: sessionTitle,
          workspace_id: workspace.id,
          workspace_name: workspace.name,
          messages: [{ role: 'user', content: delegatePrompt }],
        });
        const result = {
          success: true,
          mode,
          status: 'completed',
          prompt: delegatePrompt,
          output: extractAssistantContent(response),
          response,
        };
        persistingCompletion = true;
        await finishWorkspaceRunSession(result);
        return sessionId ? { ...result, session_id: sessionId } : result;
      }

      const { orderedNodes, layers, incomingEdgesByNodeId } = buildProfilesExecutionPlan(workspace);
      const runs = [];
      const runByNodeId = new Map();
      const workflowStartedAt = nowIso();

      const executeNode = async (node) => {
        const startedAt = nowIso();
        const agent = agentsById.get(node.agentId);
        const profileName = cleanString(node.profileName) || hermes.profile || 'default';
        const label = cleanString(node.label) || agent?.name || node.id;
        const incomingEdges = incomingEdgesByNodeId.get(node.id) || [];
        const upstreamByKind = { handoff: [], review: [], qa: [], broadcast: [], escalation: [] };
        const structuredInputs = { handoff: [], review: [], qa: [], broadcast: [], escalation: [] };

        for (const edge of incomingEdges) {
          const upstreamRun = runByNodeId.get(edge.fromNodeId);
          if (!upstreamRun) continue;
          if (!upstreamByKind[edge.kind]) continue;
          const sharedInput = {
            nodeId: upstreamRun.nodeId,
            label: upstreamRun.label,
            role: upstreamRun.role,
            profileName: upstreamRun.profileName,
            status: upstreamRun.status,
            output: upstreamRun.output,
            error: upstreamRun.error,
            startedAt: upstreamRun.startedAt,
            finishedAt: upstreamRun.finishedAt,
            template: edge.template,
          };
          upstreamByKind[edge.kind].push({ ...sharedInput, kind: edge.kind });
          structuredInputs[edge.kind].push(sharedInput);
        }

        const blockingKinds = [...BLOCKING_EXECUTION_EDGE_KINDS];
        const blockingInputs = blockingKinds.flatMap(kind => structuredInputs[kind].filter(input => input.status !== 'completed'));
        let nodePrompt = buildProfileNodePrompt(workspace, node, agent, agentsById, { task, upstreamByKind });

        if (blockingInputs.length > 0) {
          const reasons = blockingInputs.map(input => `${input.label} [${input.status}]`).join(', ');
          return {
            nodeId: node.id,
            agentId: node.agentId,
            label,
            role: node.role,
            profileName,
            status: 'blocked',
            prompt: nodePrompt,
            inputs: structuredInputs,
            output: '',
            error: `Blocked by upstream dependencies: ${reasons}`,
            startedAt,
            finishedAt: nowIso(),
            toolsetOutputs: [],
          };
        }

        let toolsetOutputs = [];
        try {
          const targetHermes = node.profileName && runners.getHermesContext
            ? await runners.getHermesContext(profileName)
            : hermes;
          const nodeRunDir = path.join(profileRuntimeRunRoot, sanitizeUploadFileName(node.id, 'node'));
          toolsetOutputs = await executeNodeToolsets({
            hermes: targetHermes,
            node,
            task,
            payload,
            sharedRuntimeState,
            runners,
            runDir: nodeRunDir,
          });
          nodePrompt = buildProfileNodePrompt(workspace, node, agent, agentsById, {
            task,
            upstreamByKind,
            toolsetContext: buildToolsetPromptContext(toolsetOutputs),
          });
          const failedToolset = toolsetOutputs.find(output => output?.status === 'failed');
          if (failedToolset) {
            return {
              nodeId: node.id,
              agentId: node.agentId,
              label,
              role: node.role,
              profileName,
              status: 'failed',
              prompt: nodePrompt,
              inputs: structuredInputs,
              output: '',
              error: cleanString(failedToolset.error) || `Toolset "${failedToolset.toolset}" failed.`,
              startedAt,
              finishedAt: nowIso(),
              toolsetOutputs,
            };
          }

          const response = await runners.postGatewayChatCompletion(targetHermes, {
            ...(node.modelOverride ? { model: node.modelOverride } : {}),
            source: sessionSource,
            session_title: `Workspace ${workspace.name}: ${label}`,
            workspace_id: workspace.id,
            workspace_name: workspace.name,
            messages: [{ role: 'user', content: nodePrompt }],
          });

          return {
            nodeId: node.id,
            agentId: node.agentId,
            label,
            role: node.role,
            profileName,
            status: 'completed',
            prompt: nodePrompt,
            inputs: structuredInputs,
            output: extractAssistantContent(response),
            error: '',
            startedAt,
            finishedAt: nowIso(),
            response,
            toolsetOutputs,
          };
        } catch (error) {
          const message = error?.message || 'Node execution failed';
          return {
            nodeId: node.id,
            agentId: node.agentId,
            label,
            role: node.role,
            profileName,
            status: 'failed',
            prompt: nodePrompt,
            inputs: structuredInputs,
            output: '',
            error: message,
            startedAt,
            finishedAt: nowIso(),
            toolsetOutputs,
          };
        }
      };

      for (const layer of layers) {
        const layerRuns = await Promise.all(layer.map(node => executeNode(node)));
        for (const run of layerRuns) {
          runs.push(run);
          runByNodeId.set(run.nodeId, run);
        }
      }

      const counts = {
        total: runs.length,
        completed: runs.filter(run => run.status === 'completed').length,
        failed: runs.filter(run => run.status === 'failed').length,
        blocked: runs.filter(run => run.status === 'blocked').length,
      };
      const hasQaNodes = orderedNodes.some(node => node.role === 'qa');
      const qaRuns = runs.filter(run => run.role === 'qa');
      const qaGate = hasQaNodes
        ? {
            required: true,
            status: qaRuns.length > 0 && qaRuns.every(run => run.status === 'completed') ? 'passed' : 'failed',
          }
        : {
            required: false,
            status: 'not_required',
          };

      const workflowStatus = counts.failed > 0
        ? 'failed'
        : counts.blocked > 0
          ? 'blocked'
          : 'completed';

      const workflow = {
        status: workflowStatus,
        startedAt: workflowStartedAt,
        finishedAt: nowIso(),
        counts,
        qaGate,
      };

      const result = {
        success: workflowStatus === 'completed',
        mode,
        status: workflowStatus,
        prompt,
        workflow,
        runs,
        ...(workflowStatus !== 'completed'
          ? { error: `Workspace profile execution finished with status ${workflowStatus}.` }
          : {}),
        output: runs.map(run => {
          const body = run.status === 'completed'
            ? (run.output || '(no output)')
            : `(${run.status}) ${run.error || 'unknown issue'}`;
          return `## ${run.label} (${run.profileName})\n${body}`;
        }).join('\n\n'),
      };
      persistingCompletion = true;
      await finishWorkspaceRunSession(result);
      return sessionId ? { ...result, session_id: sessionId } : result;
    } catch (error) {
      if (persistingCompletion) throw error;
      const failedResult = {
        success: false,
        mode,
        status: 'failed',
        prompt: sessionPrompt,
        output: '',
        error: error?.message || 'Workspace execution failed.',
      };
      await finishWorkspaceRunSession(failedResult);
      throw error;
    }
  }

  async function executeWorkspace(hermes, id, payload = {}, runners = {}) {
    const { workspace, agentsById } = await getWorkspaceExecutionContext(hermes, id);
    return runWorkspaceWithGateway(hermes, workspace, agentsById, payload, runners);
  }

  async function runWorkspaceTask(hermes, id, payload = {}, runners = {}) {
    const task = cleanString(payload?.task);
    if (!task) throw createHttpError(400, 'Workspace task is required');
    const { workspace, agentsById } = await getWorkspaceExecutionContext(hermes, id);
    return runWorkspaceWithGateway(hermes, workspace, agentsById, payload, runners, { executePromptMode: true });
  }

  // Legacy alias kept for compatibility with older route/service call sites.
  const chatWorkspace = runWorkspaceTask;

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
    previewWorkspaceAutoConfig,
    executeWorkspace,
    runWorkspaceTask,
    chatWorkspace,
  };
}
