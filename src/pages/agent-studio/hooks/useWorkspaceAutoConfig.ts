import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../../api';
import type {
  AgentDefinition,
  AgentWorkspace,
  WorkspaceAutoConfigPreviewResult,
} from '../../../types';
import { buildWorkspaceAutoConfigPlan } from '../workspaceAutoConfigPlan';

interface UseWorkspaceAutoConfigOptions {
  activeWorkspace: AgentWorkspace | null;
  agentsById: Map<string, AgentDefinition>;
  saveWorkspace: () => Promise<AgentWorkspace | null>;
  saveWorkspaceDraft: (workspace: AgentWorkspace) => Promise<AgentWorkspace | null>;
  patchActiveWorkspace: (patch: Partial<AgentWorkspace>) => void;
  patchSelectedNode: (patch: Partial<AgentWorkspace['nodes'][number]>) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (fromNodeId: string, toNodeId: string, kind?: AgentWorkspace['edges'][number]['kind']) => void;
  removeEdge: (edgeId: string) => void;
  clearLibraryError: () => void;
  onError: (message: string) => void;
}

function formatError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; details?: string } } }).response;
    return response?.data?.error || response?.data?.details || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useWorkspaceAutoConfig({
  activeWorkspace,
  agentsById,
  saveWorkspace,
  saveWorkspaceDraft,
  patchActiveWorkspace,
  patchSelectedNode,
  removeNode,
  addEdge,
  removeEdge,
  clearLibraryError,
  onError,
}: UseWorkspaceAutoConfigOptions) {
  const [autoConfigBusy, setAutoConfigBusy] = useState(false);
  const [autoConfigPreview, setAutoConfigPreview] = useState<WorkspaceAutoConfigPreviewResult | null>(null);

  const clearAutoConfigPreview = useCallback(() => {
    setAutoConfigPreview(null);
  }, []);

  const activeWorkspaceId = activeWorkspace?.id || null;
  useEffect(() => {
    setAutoConfigPreview(null);
  }, [activeWorkspaceId]);

  const autoConfigPlan = useMemo(
    () => (activeWorkspace && autoConfigPreview
      ? buildWorkspaceAutoConfigPlan(activeWorkspace, autoConfigPreview, agentsById)
      : null),
    [activeWorkspace, agentsById, autoConfigPreview],
  );

  const generateAutoConfig = useCallback(async () => {
    if (!activeWorkspace) return;
    clearAutoConfigPreview();
    setAutoConfigBusy(true);
    onError('');
    clearLibraryError();
    try {
      const saved = await saveWorkspace();
      if (!saved) return;
      const pipelineBrief = String(saved.pipelineBrief || '').trim();
      if (!pipelineBrief) {
        onError('Pipeline brief is required before auto-configuration.');
        return;
      }
      const response = await api.agentStudio.autoConfigWorkspace(saved.id, { pipelineBrief });
      setAutoConfigPreview(response.data);
    } catch (previewError) {
      clearAutoConfigPreview();
      onError(formatError(previewError, 'Could not auto-configure workspace.'));
    } finally {
      setAutoConfigBusy(false);
    }
  }, [activeWorkspace, clearAutoConfigPreview, clearLibraryError, onError, saveWorkspace]);

  const applyAutoConfig = useCallback(async (saveAfterApply = false) => {
    if (!autoConfigPlan?.hasChanges) return;

    if (saveAfterApply) {
      const saved = await saveWorkspaceDraft(autoConfigPlan.nextWorkspace);
      if (saved) clearAutoConfigPreview();
      return;
    }

    patchActiveWorkspace(autoConfigPlan.patch);
    clearAutoConfigPreview();
  }, [autoConfigPlan, clearAutoConfigPreview, patchActiveWorkspace, saveWorkspaceDraft]);

  const applyAutoConfigPreview = useCallback(async () => {
    await applyAutoConfig(false);
  }, [applyAutoConfig]);

  const applyAndSaveAutoConfigPreview = useCallback(async () => {
    await applyAutoConfig(true);
  }, [applyAutoConfig]);

  const patchWorkspaceAndInvalidatePreview = useCallback((patch: Partial<AgentWorkspace>) => {
    clearAutoConfigPreview();
    patchActiveWorkspace(patch);
  }, [clearAutoConfigPreview, patchActiveWorkspace]);

  const patchNodeAndInvalidatePreview = useCallback((patch: Partial<AgentWorkspace['nodes'][number]>) => {
    clearAutoConfigPreview();
    patchSelectedNode(patch);
  }, [clearAutoConfigPreview, patchSelectedNode]);

  const removeNodeAndInvalidatePreview = useCallback((nodeId: string) => {
    clearAutoConfigPreview();
    removeNode(nodeId);
  }, [clearAutoConfigPreview, removeNode]);

  const addEdgeAndInvalidatePreview = useCallback((
    fromNodeId: string,
    toNodeId: string,
    kind?: AgentWorkspace['edges'][number]['kind'],
  ) => {
    clearAutoConfigPreview();
    addEdge(fromNodeId, toNodeId, kind);
  }, [addEdge, clearAutoConfigPreview]);

  const removeEdgeAndInvalidatePreview = useCallback((edgeId: string) => {
    clearAutoConfigPreview();
    removeEdge(edgeId);
  }, [clearAutoConfigPreview, removeEdge]);

  return {
    autoConfigBusy,
    autoConfigPreview,
    autoConfigPlan,
    clearAutoConfigPreview,
    invalidateAutoConfigPreview: clearAutoConfigPreview,
    generateAutoConfig,
    applyAutoConfig,
    applyAutoConfigPreview,
    applyAndSaveAutoConfigPreview,
    patchWorkspaceAndInvalidatePreview,
    patchNodeAndInvalidatePreview,
    removeNodeAndInvalidatePreview,
    addEdgeAndInvalidatePreview,
    removeEdgeAndInvalidatePreview,
  };
}
