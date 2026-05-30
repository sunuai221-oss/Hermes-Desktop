import { useCallback, useState } from 'react';
import type { AgentDefinition, AgentWorkspace } from '../../../types';
import {
  resolveTeam,
  type ResolvedTeam,
  type ResolvedTeamAgentAmbiguity,
  type TeamDefinition,
} from '../teams/teamDefinitions';

type LoadTemplatesResult =
  | { ok: true; templates: AgentDefinition[] }
  | { ok: false; error: string };

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

interface UseTeamWorkspaceCreationOptions {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmUnsavedChanges: (action: string) => Promise<boolean>;
  discardActiveWorkspaceChanges: () => void;
  clearLibraryError: () => void;
  loadTemplates: () => Promise<LoadTemplatesResult>;
  createWorkspace: (draft?: Partial<AgentWorkspace>) => Promise<AgentWorkspace | null>;
  switchWorkspaceModeSafely: (nextMode: 'quick' | 'advanced', action: string) => Promise<boolean>;
  onError: (message: string) => void;
  onWorkspaceCreated?: (workspace: AgentWorkspace) => void;
}

function formatError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; details?: string } } }).response;
    return response?.data?.error || response?.data?.details || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function createEdgeId() {
  return `edge_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function formatTeamAmbiguityDetails(ambiguousAgents: ResolvedTeamAgentAmbiguity[]) {
  return ambiguousAgents
    .map(entry => {
      const candidates = entry.matches
        .map(match => {
          const parts = [
            match.name,
            match.source || 'template',
            match.sourcePath || match.slug || match.id,
          ].filter(Boolean);
          return parts.join(' · ');
        })
        .join(' | ');
      return `${entry.agentName}: ${candidates}`;
    })
    .join('; ');
}

function buildTeamWorkspaceDraft(resolved: ResolvedTeam): Partial<AgentWorkspace> {
  return {
    name: resolved.name,
    description: resolved.description,
    pipelineBrief: resolved.pipelineBrief,
    sharedContext: resolved.sharedContext,
    commonRules: resolved.commonRules,
    defaultMode: resolved.defaultMode,
    nodes: resolved.nodes.map(node => ({
      id: node.id,
      agentId: node.agentId,
      role: node.role,
      label: node.label,
      modelOverride: node.modelOverride || '',
      skills: node.skills || [],
      toolsets: node.toolsets || [],
      position: node.position,
    })),
    edges: resolved.edges.map(edge => ({
      id: createEdgeId(),
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      kind: edge.kind,
    })),
  };
}

export function useTeamWorkspaceCreation({
  confirm,
  confirmUnsavedChanges,
  discardActiveWorkspaceChanges,
  clearLibraryError,
  loadTemplates,
  createWorkspace,
  switchWorkspaceModeSafely,
  onError,
  onWorkspaceCreated,
}: UseTeamWorkspaceCreationOptions) {
  const [creatingFromTeam, setCreatingFromTeam] = useState(false);

  const createFromTeam = useCallback(async (team: TeamDefinition) => {
    const canCreate = await confirmUnsavedChanges('create a workspace from a team');
    if (!canCreate) return;

    const confirmedCreate = await confirm({
      title: 'Create team workspace',
      message: `Create "${team.name}" as a saved workspace?\n\nThis is useful for testing, and you can delete it afterwards from Quick Start or Advanced mode.`,
      confirmLabel: 'Create workspace',
      cancelLabel: 'Cancel',
    });
    if (!confirmedCreate) return;

    discardActiveWorkspaceChanges();

    setCreatingFromTeam(true);
    onError('');
    clearLibraryError();

    try {
      const result = await loadTemplates();
      if (!result.ok) {
        onError(result.error || 'Could not load agent templates.');
        return;
      }

      const resolved = resolveTeam(team, result.templates);

      if (resolved.missingAgents.length > 0) {
        onError(
          `Certains agents sont introuvables : ${resolved.missingAgents.join(', ')}. `
          + 'Utilise "Load bundled" ou "Import default agency" dans la bibliothèque de templates.',
        );
        return;
      }

      if (resolved.ambiguousAgents.length > 0) {
        const ambiguityDetails = formatTeamAmbiguityDetails(resolved.ambiguousAgents);
        onError(
          `Certains agents sont ambigus : ${ambiguityDetails}. `
          + 'Renomme, désambiguïse ou supprime les doublons de templates avant de créer cette équipe.',
        );
        return;
      }

      const draft = buildTeamWorkspaceDraft(resolved);
      const newWorkspace = await createWorkspace(draft);
      if (!newWorkspace) return;

      const canOpenAdvanced = await switchWorkspaceModeSafely('advanced', 'open Advanced mode');
      if (!canOpenAdvanced) return;
      onWorkspaceCreated?.(newWorkspace);
    } catch (createError) {
      onError(formatError(createError, 'Could not create workspace from team.'));
    } finally {
      setCreatingFromTeam(false);
    }
  }, [
    clearLibraryError,
    confirm,
    confirmUnsavedChanges,
    createWorkspace,
    discardActiveWorkspaceChanges,
    loadTemplates,
    onError,
    onWorkspaceCreated,
    switchWorkspaceModeSafely,
  ]);

  return {
    creatingFromTeam,
    createFromTeam,
  };
}
