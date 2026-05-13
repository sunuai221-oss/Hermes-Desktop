import { Loader2, MessageSquare, Plus, Save, Trash2, Wand2 } from 'lucide-react';
import type { AgentWorkspace } from '../../../types';

type WorkspaceListPanelProps = {
  workspaces: AgentWorkspace[];
  activeWorkspaceId: string | null;
  saving: boolean;
  generating: boolean;
  hasActiveWorkspace: boolean;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onSaveWorkspace: () => void;
  onGeneratePrompt: () => void;
  onOpenInterface: () => void;
  onDeleteWorkspace: () => void;
};

export function WorkspaceListPanel({
  workspaces,
  activeWorkspaceId,
  saving,
  generating,
  hasActiveWorkspace,
  onSelectWorkspace,
  onCreateWorkspace,
  onSaveWorkspace,
  onGeneratePrompt,
  onOpenInterface,
  onDeleteWorkspace,
}: WorkspaceListPanelProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <WorkspaceSelector
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelect={onSelectWorkspace}
        onCreate={onCreateWorkspace}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSaveWorkspace}
          disabled={!hasActiveWorkspace || saving}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save
        </button>
        <button
          onClick={onGeneratePrompt}
          disabled={!hasActiveWorkspace || generating}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          Generate prompt
        </button>
        <button
          onClick={onOpenInterface}
          disabled={!hasActiveWorkspace}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <MessageSquare size={15} />
          Generate interface
        </button>
        <button
          onClick={onDeleteWorkspace}
          disabled={!hasActiveWorkspace}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 size={15} />
          Delete
        </button>
      </div>
    </div>
  );
}

function WorkspaceSelector({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onCreate,
}: {
  workspaces: AgentWorkspace[];
  activeWorkspaceId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={activeWorkspaceId || ''}
        onChange={event => {
          const nextId = event.target.value;
          if (nextId) onSelect(nextId);
        }}
        className="min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {workspaces.length === 0 && <option value="">No workspace</option>}
        {workspaces.map(workspace => (
          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
        ))}
      </select>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
      >
        <Plus size={15} />
        New workspace
      </button>
    </div>
  );
}
