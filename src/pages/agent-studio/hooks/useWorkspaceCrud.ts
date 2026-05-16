import { useCallback, useMemo, useState, type MutableRefObject } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import * as api from '../../../api';
import type {
  AgentDefinition,
  AgentWorkspace,
  WorkspaceAgentEdge,
  WorkspaceAgentNode,
  WorkspaceEdgeKind,
} from '../../../types';

type TemplatesLoadResult = { ok: boolean; error?: string };

type DragData = {
  type?: 'library-agent' | 'workspace-node';
  agentId?: string;
  nodeId?: string;
};

interface UseWorkspaceCrudOptions {
  loadTemplates: () => Promise<TemplatesLoadResult>;
  clearLibraryError: () => void;
  onWorkspaceContextReset?: () => void;
}

function createWorkspaceDraft(): Partial<AgentWorkspace> {
  const now = new Date().toISOString();
  return {
    name: `Workspace ${now.slice(11, 16)}`,
    description: '',
    pipelineBrief: '',
    sharedContext: '',
    commonRules: '',
    defaultMode: 'prompt',
    nodes: [],
    edges: [],
  };
}

function createNode(agent: AgentDefinition, position: { x: number; y: number }): WorkspaceAgentNode {
  return {
    id: `node_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    agentId: agent.id,
    role: 'worker',
    label: agent.name,
    modelOverride: agent.defaultModel || '',
    toolsets: agent.preferredToolsets || [],
    skills: agent.preferredSkills || [],
    position,
  };
}

function createEdge(fromNodeId: string, toNodeId: string, kind: WorkspaceEdgeKind): WorkspaceAgentEdge {
  return {
    id: `edge_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    fromNodeId,
    toNodeId,
    kind,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; details?: string } } }).response;
    return response?.data?.error || response?.data?.details || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function cleanComparableString(value: unknown) {
  return String(value ?? '').trim();
}

function cleanComparableArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => cleanComparableString(item)).filter(Boolean);
}

function comparableWorkspace(workspace: AgentWorkspace) {
  return {
    id: workspace.id,
    name: cleanComparableString(workspace.name),
    description: cleanComparableString(workspace.description),
    pipelineBrief: cleanComparableString(workspace.pipelineBrief),
    sharedContext: cleanComparableString(workspace.sharedContext),
    commonRules: cleanComparableString(workspace.commonRules),
    defaultMode: workspace.defaultMode,
    nodes: (workspace.nodes || []).map(node => ({
      id: node.id,
      agentId: node.agentId,
      role: node.role,
      label: cleanComparableString(node.label),
      profileName: cleanComparableString(node.profileName),
      modelOverride: cleanComparableString(node.modelOverride),
      toolsets: cleanComparableArray(node.toolsets),
      skills: cleanComparableArray(node.skills),
      position: {
        x: Number(node.position?.x) || 0,
        y: Number(node.position?.y) || 0,
      },
    })),
    edges: (workspace.edges || []).map(edge => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: edge.kind,
      template: cleanComparableString(edge.template),
    })),
  };
}

function workspaceFingerprint(workspace: AgentWorkspace) {
  return JSON.stringify(comparableWorkspace(workspace));
}

function cloneWorkspace(workspace: AgentWorkspace): AgentWorkspace {
  return JSON.parse(JSON.stringify(workspace)) as AgentWorkspace;
}

function mapWorkspacesById(workspaces: AgentWorkspace[]) {
  return Object.fromEntries(workspaces.map(workspace => [workspace.id, cloneWorkspace(workspace)]));
}

export function useWorkspaceCrud({
  loadTemplates,
  clearLibraryError,
  onWorkspaceContextReset,
}: UseWorkspaceCrudOptions) {
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const [savedWorkspacesById, setSavedWorkspacesById] = useState<Record<string, AgentWorkspace>>({});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const activeWorkspace = useMemo(
    () => workspaces.find(workspace => workspace.id === activeWorkspaceId) || null,
    [activeWorkspaceId, workspaces],
  );

  const selectedNode = useMemo(
    () => activeWorkspace?.nodes.find(node => node.id === selectedNodeId) || null,
    [activeWorkspace, selectedNodeId],
  );

  const activeWorkspaceDirty = useMemo(() => {
    if (!activeWorkspace) return false;
    const savedWorkspace = savedWorkspacesById[activeWorkspace.id];
    if (!savedWorkspace) return false;
    return workspaceFingerprint(activeWorkspace) !== workspaceFingerprint(savedWorkspace);
  }, [activeWorkspace, savedWorkspacesById]);

  const replaceWorkspace = useCallback((workspace: AgentWorkspace) => {
    setWorkspaces(current => current.map(item => (item.id === workspace.id ? workspace : item)));
  }, []);

  const markWorkspaceSaved = useCallback((workspace: AgentWorkspace) => {
    setSavedWorkspacesById(current => ({
      ...current,
      [workspace.id]: cloneWorkspace(workspace),
    }));
  }, []);

  const discardActiveWorkspaceChanges = useCallback(() => {
    if (!activeWorkspace) return;
    const savedWorkspace = savedWorkspacesById[activeWorkspace.id];
    if (!savedWorkspace) return;
    replaceWorkspace(cloneWorkspace(savedWorkspace));
  }, [activeWorkspace, replaceWorkspace, savedWorkspacesById]);

  const patchActiveWorkspace = useCallback((patch: Partial<AgentWorkspace>) => {
    if (!activeWorkspace) return;
    replaceWorkspace({ ...activeWorkspace, ...patch, updatedAt: new Date().toISOString() });
  }, [activeWorkspace, replaceWorkspace]);

  const patchSelectedNode = useCallback((patch: Partial<WorkspaceAgentNode>) => {
    if (!activeWorkspace || !selectedNode) return;
    const nodes = activeWorkspace.nodes.map(node =>
      node.id === selectedNode.id ? { ...node, ...patch } : node,
    );
    patchActiveWorkspace({ nodes });
  }, [activeWorkspace, patchActiveWorkspace, selectedNode]);

  const selectWorkspace = useCallback((id: string) => {
    setActiveWorkspaceId(id);
    setSelectedNodeId(null);
    onWorkspaceContextReset?.();
  }, [onWorkspaceContextReset]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    clearLibraryError();
    try {
      const [libraryLoad, workspacesRes] = await Promise.all([
        loadTemplates(),
        api.agentStudio.workspaces(),
      ]);
      const nextWorkspaces = Array.isArray(workspacesRes.data.workspaces) ? workspacesRes.data.workspaces : [];
      setWorkspaces(nextWorkspaces);
      setSavedWorkspacesById(mapWorkspacesById(nextWorkspaces));
      setActiveWorkspaceId(current => current || nextWorkspaces[0]?.id || null);
      if (!libraryLoad.ok) {
        setError(libraryLoad.error || 'Could not load templates library.');
      }
    } catch (loadError) {
      setError(formatError(loadError, 'Could not load workspaces.'));
    } finally {
      setLoading(false);
    }
  }, [clearLibraryError, loadTemplates]);

  const createWorkspace = useCallback(async () => {
    setError('');
    clearLibraryError();
    try {
      const res = await api.agentStudio.createWorkspace(createWorkspaceDraft());
      setWorkspaces(current => [res.data.workspace, ...current]);
      markWorkspaceSaved(res.data.workspace);
      setActiveWorkspaceId(res.data.workspace.id);
      setSelectedNodeId(null);
      onWorkspaceContextReset?.();
    } catch (createError) {
      setError(formatError(createError, 'Could not create workspace.'));
    }
  }, [clearLibraryError, markWorkspaceSaved, onWorkspaceContextReset]);

  const saveWorkspace = useCallback(async () => {
    if (!activeWorkspace) return null;
    setSaving(true);
    setError('');
    clearLibraryError();
    try {
      const res = await api.agentStudio.updateWorkspace(activeWorkspace.id, activeWorkspace);
      replaceWorkspace(res.data.workspace);
      markWorkspaceSaved(res.data.workspace);
      return res.data.workspace;
    } catch (saveError) {
      setError(formatError(saveError, 'Could not save workspace.'));
      return null;
    } finally {
      setSaving(false);
    }
  }, [activeWorkspace, clearLibraryError, markWorkspaceSaved, replaceWorkspace]);

  const saveWorkspaceDraft = useCallback(async (workspace: AgentWorkspace) => {
    setSaving(true);
    setError('');
    clearLibraryError();
    try {
      const res = await api.agentStudio.updateWorkspace(workspace.id, workspace);
      replaceWorkspace(res.data.workspace);
      markWorkspaceSaved(res.data.workspace);
      return res.data.workspace;
    } catch (saveError) {
      setError(formatError(saveError, 'Could not save workspace.'));
      return null;
    } finally {
      setSaving(false);
    }
  }, [clearLibraryError, markWorkspaceSaved, replaceWorkspace]);

  const deleteWorkspace = useCallback(async () => {
    if (!activeWorkspace) return;
    setError('');
    clearLibraryError();
    try {
      await api.agentStudio.deleteWorkspace(activeWorkspace.id);
      const remaining = workspaces.filter(workspace => workspace.id !== activeWorkspace.id);
      setWorkspaces(remaining);
      setSavedWorkspacesById(current => {
        const next = { ...current };
        delete next[activeWorkspace.id];
        return next;
      });
      setActiveWorkspaceId(remaining[0]?.id || null);
      setSelectedNodeId(null);
      onWorkspaceContextReset?.();
    } catch (deleteError) {
      setError(formatError(deleteError, 'Could not delete workspace.'));
    }
  }, [activeWorkspace, clearLibraryError, onWorkspaceContextReset, workspaces]);

  const removeNode = useCallback((nodeId: string) => {
    if (!activeWorkspace) return;
    patchActiveWorkspace({
      nodes: activeWorkspace.nodes.filter(node => node.id !== nodeId),
      edges: (activeWorkspace.edges || []).filter(edge => edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId),
    });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [activeWorkspace, patchActiveWorkspace, selectedNodeId]);

  const addEdge = useCallback((fromNodeId: string, toNodeId: string, kind: WorkspaceEdgeKind = 'handoff') => {
    if (!activeWorkspace || fromNodeId === toNodeId) return;
    const hasEndpoints = activeWorkspace.nodes.some(node => node.id === fromNodeId)
      && activeWorkspace.nodes.some(node => node.id === toNodeId);
    if (!hasEndpoints) return;
    const edges = activeWorkspace.edges || [];
    const exists = edges.some(edge =>
      edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId && edge.kind === kind,
    );
    if (exists) return;
    patchActiveWorkspace({ edges: [...edges, createEdge(fromNodeId, toNodeId, kind)] });
  }, [activeWorkspace, patchActiveWorkspace]);

  const removeEdge = useCallback((edgeId: string) => {
    if (!activeWorkspace) return;
    patchActiveWorkspace({ edges: (activeWorkspace.edges || []).filter(edge => edge.id !== edgeId) });
  }, [activeWorkspace, patchActiveWorkspace]);

  const handleDragEnd = useCallback((
    event: DragEndEvent,
    agentsById: Map<string, AgentDefinition>,
    canvasRef: MutableRefObject<HTMLDivElement | null>,
    zoom = 1,
  ) => {
    if (!activeWorkspace) return;
    const data = event.active.data.current as DragData | undefined;

    if (data?.type === 'workspace-node' && data.nodeId) {
      const nodes = activeWorkspace.nodes.map(node =>
        node.id === data.nodeId
          ? {
              ...node,
              position: {
                x: Math.max(0, node.position.x + event.delta.x / zoom),
                y: Math.max(0, node.position.y + event.delta.y / zoom),
              },
            }
          : node,
      );
      patchActiveWorkspace({ nodes });
      return;
    }

    if (data?.type !== 'library-agent' || event.over?.id !== 'workspace-canvas' || !data.agentId) return;
    const agent = agentsById.get(data.agentId);
    if (!agent || !canvasRef.current) return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const dragRect = event.active.rect.current.translated || event.active.rect.current.initial;
    const x = dragRect ? dragRect.left - canvasRect.left : 40;
    const y = dragRect ? dragRect.top - canvasRect.top : 40;
    const node = createNode(agent, {
      x: clamp(x, 12, Math.max(12, canvasRect.width - 240)),
      y: clamp(y, 12, Math.max(12, canvasRect.height - 140)),
    });

    patchActiveWorkspace({ nodes: [...activeWorkspace.nodes, node] });
    setSelectedNodeId(node.id);
  }, [activeWorkspace, patchActiveWorkspace]);

  return {
    workspaces,
    activeWorkspaceId,
    selectedNodeId,
    loading,
    saving,
    error,
    setError,
    activeWorkspace,
    activeWorkspaceDirty,
    selectedNode,
    setSelectedNodeId,
    load,
    selectWorkspace,
    createWorkspace,
    saveWorkspace,
    saveWorkspaceDraft,
    discardActiveWorkspaceChanges,
    deleteWorkspace,
    patchActiveWorkspace,
    patchSelectedNode,
    removeNode,
    addEdge,
    removeEdge,
    handleDragEnd,
  };
}
