import type {
  AgentDefinition,
  AgentWorkspace,
  WorkspaceAgentEdge,
  WorkspaceAutoConfigDiffItem,
  WorkspaceAutoConfigPlan,
  WorkspaceAutoConfigPreviewResult,
} from '../../types';

const WORKSPACE_FIELD_LABELS = {
  description: 'Description',
  pipelineBrief: 'Pipeline brief',
  sharedContext: 'Shared context',
  commonRules: 'Common rules',
} as const;

const NODE_FIELD_LABELS = {
  role: 'Role',
  label: 'Label',
  profileName: 'Profile',
  modelOverride: 'Model',
  skills: 'Skills',
  toolsets: 'Toolsets',
} as const;

function hasOwn(value: unknown, key: string) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function formatDiffValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty)';
  const text = String(value ?? '').trim();
  return text || '(empty)';
}

function valuesEqual(left: unknown, right: unknown) {
  return formatDiffValue(left) === formatDiffValue(right);
}

function sanitizeEdgeIdPart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'node';
}

function makeAutoConfigEdgeId(edge: Omit<WorkspaceAgentEdge, 'id'>, index: number) {
  return [
    'edge_auto',
    String(index),
    sanitizeEdgeIdPart(edge.fromNodeId),
    sanitizeEdgeIdPart(edge.toNodeId),
    sanitizeEdgeIdPart(edge.kind),
  ].join('_');
}

function edgeSignature(edge: Omit<WorkspaceAgentEdge, 'id'>) {
  return [
    edge.fromNodeId,
    edge.toNodeId,
    edge.kind,
    String(edge.template || '').trim(),
  ].join('::');
}

function edgeSetSignature(edges: Array<Omit<WorkspaceAgentEdge, 'id'>>) {
  return edges.map(edgeSignature).sort().join('|');
}

function getWorkspaceNodeLabel(node: AgentWorkspace['nodes'][number], agentsById: Map<string, AgentDefinition>) {
  return node.label || agentsById.get(node.agentId)?.name || node.id;
}

function formatEdgeForDiff(
  edge: Omit<WorkspaceAgentEdge, 'id'>,
  nodesById: Map<string, AgentWorkspace['nodes'][number]>,
  agentsById: Map<string, AgentDefinition>,
) {
  const from = nodesById.get(edge.fromNodeId);
  const to = nodesById.get(edge.toNodeId);
  const fromLabel = from ? getWorkspaceNodeLabel(from, agentsById) : edge.fromNodeId;
  const toLabel = to ? getWorkspaceNodeLabel(to, agentsById) : edge.toNodeId;
  const template = String(edge.template || '').trim();
  return template
    ? `${fromLabel} -> ${toLabel} (${edge.kind}) - ${template}`
    : `${fromLabel} -> ${toLabel} (${edge.kind})`;
}

export function buildWorkspaceAutoConfigPlan(
  workspace: AgentWorkspace,
  preview: WorkspaceAutoConfigPreviewResult,
  agentsById: Map<string, AgentDefinition>,
): WorkspaceAutoConfigPlan {
  const suggestion = preview.suggestion;
  const workspacePatch = suggestion.workspacePatch || {};
  const items: WorkspaceAutoConfigDiffItem[] = [];
  const nodesById = new Map(workspace.nodes.map(node => [node.id, node] as const));
  const patch: WorkspaceAutoConfigPlan['patch'] = {
    nodes: workspace.nodes,
    edges: workspace.edges || [],
  };

  for (const field of Object.keys(WORKSPACE_FIELD_LABELS) as Array<keyof typeof WORKSPACE_FIELD_LABELS>) {
    if (!hasOwn(workspacePatch, field)) continue;
    const nextValue = workspacePatch[field];
    if (valuesEqual(workspace[field], nextValue)) continue;
    patch[field] = nextValue;
    items.push({
      id: `workspace:${field}`,
      category: 'workspace',
      title: WORKSPACE_FIELD_LABELS[field],
      before: formatDiffValue(workspace[field]),
      after: formatDiffValue(nextValue),
    });
  }

  if (hasOwn(workspacePatch, 'defaultMode') && !valuesEqual(workspace.defaultMode, workspacePatch.defaultMode)) {
    patch.defaultMode = workspacePatch.defaultMode;
    items.push({
      id: 'workspace:defaultMode',
      category: 'mode',
      title: 'Execution mode',
      before: formatDiffValue(workspace.defaultMode),
      after: formatDiffValue(workspacePatch.defaultMode),
    });
  }

  const nodePatchesById = new Map((suggestion.nodes || []).map(nodePatch => [nodePatch.nodeId, nodePatch] as const));
  const nodes = workspace.nodes.map(node => {
    const nodePatch = nodePatchesById.get(node.id);
    if (!nodePatch) return node;

    let nextNode = node;
    for (const field of Object.keys(NODE_FIELD_LABELS) as Array<keyof typeof NODE_FIELD_LABELS>) {
      if (!hasOwn(nodePatch, field)) continue;
      const nextValue = nodePatch[field];
      if (valuesEqual(node[field], nextValue)) continue;
      nextNode = { ...nextNode, [field]: nextValue };
      items.push({
        id: `node:${node.id}:${field}`,
        category: 'node',
        title: `${getWorkspaceNodeLabel(node, agentsById)}: ${NODE_FIELD_LABELS[field]}`,
        before: formatDiffValue(node[field]),
        after: formatDiffValue(nextValue),
      });
    }

    return nextNode;
  });
  patch.nodes = nodes;

  const hasSuggestedEdges = hasOwn(suggestion, 'edges') && Array.isArray(suggestion.edges);
  const suggestedEdges = Array.isArray(suggestion.edges) ? suggestion.edges : [];
  let edges = workspace.edges || [];
  if (hasSuggestedEdges) {
    const nextEdges = suggestedEdges.map((edge, index) => ({
      id: makeAutoConfigEdgeId(edge, index),
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: edge.kind,
      ...(edge.template ? { template: edge.template } : {}),
    }));
    const currentSignature = edgeSetSignature(edges);
    const nextSignature = edgeSetSignature(nextEdges);

    if (currentSignature !== nextSignature) {
      edges = nextEdges;
      const currentEdgesCount = workspace.edges?.length || 0;
      if (nextEdges.length === 0) {
        items.push({
          id: 'edges:cleared',
          category: 'edge',
          title: 'Relations cleared',
          before: `${currentEdgesCount} current relation(s)`,
          after: '0 relation(s)',
          detail: 'All existing relations will be removed by this preview.',
        });
      } else {
        items.push({
          id: 'edges:replace',
          category: 'edge',
          title: 'Relations',
          before: `${currentEdgesCount} current relation(s)`,
          after: `${nextEdges.length} suggested relation(s)`,
          detail: 'Existing relations will be replaced by the preview.',
        });
        nextEdges.forEach((edge, index) => {
          items.push({
            id: `edge:${index}:${edgeSignature(edge)}`,
            category: 'edge',
            title: `Suggested relation ${index + 1}`,
            after: formatEdgeForDiff(edge, nodesById, agentsById),
          });
        });
      }
    }
  }
  patch.edges = edges;

  return {
    patch,
    nextWorkspace: {
      ...workspace,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
    items,
    hasChanges: items.length > 0,
  };
}
