import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, MessageSquare, Plus, Save, Search, Trash2, Wand2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AgentWorkspace } from '../../../types';

type WorkspaceListPanelProps = {
  workspaces: AgentWorkspace[];
  activeWorkspaceId: string | null;
  saving: boolean;
  generating: boolean;
  hasActiveWorkspace: boolean;
  hasUnsavedChanges: boolean;
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
  hasUnsavedChanges,
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
        hasUnsavedChanges={hasUnsavedChanges}
        onSelect={onSelectWorkspace}
        onCreate={onCreateWorkspace}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onSaveWorkspace}
          disabled={!hasActiveWorkspace || saving}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50',
            hasUnsavedChanges
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border-border text-foreground hover:bg-muted',
          )}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {hasUnsavedChanges ? 'Save changes' : 'Save'}
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

// ── Custom Dropdown Workspace Selector ────────────────────────────

function WorkspaceSelector({
  workspaces,
  activeWorkspaceId,
  hasUnsavedChanges,
  onSelect,
  onCreate,
}: {
  workspaces: AgentWorkspace[];
  activeWorkspaceId: string | null;
  hasUnsavedChanges: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;

  const filtered = query.trim()
    ? workspaces.filter(w =>
        w.name.toLowerCase().includes(query.toLowerCase()),
      )
    : workspaces;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSelect = useCallback((id: string) => {
    onSelect(id);
    setOpen(false);
    setQuery('');
  }, [onSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-2">
        {/* Trigger button */}
        <button
          onClick={() => setOpen(o => !o)}
          className={cn(
            'flex min-w-[220px] items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
            open ? 'border-primary/50 ring-2 ring-primary/20' : 'border-border hover:border-border/80',
          )}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {activeWorkspace ? activeWorkspace.name : 'No workspace'}
          </span>
          <span className="flex items-center gap-1.5 shrink-0">
            {hasUnsavedChanges && (
              <span className="h-2 w-2 rounded-full bg-warning" title="Unsaved changes" />
            )}
            <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
          </span>
        </button>

        <button
          onClick={onCreate}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <Plus size={15} />
          New workspace
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-[360px] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          onKeyDown={handleKeyDown}
        >
          {/* Search */}
          <div className="border-b border-border p-2">
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5">
              <Search size={14} className="shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search workspaces…"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-[280px] overflow-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                {query ? 'No workspaces match your search.' : 'No workspaces yet.'}
              </div>
            ) : (
              filtered.map(workspace => {
                const isActive = workspace.id === activeWorkspaceId;
                const nodeCount = workspace.nodes.length;
                const updated = workspace.updatedAt
                  ? formatRelativeTime(workspace.updatedAt)
                  : '';
                return (
                  <button
                    key={workspace.id}
                    onClick={() => handleSelect(workspace.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50',
                      isActive && 'bg-primary/8',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {workspace.name}
                        </span>
                        {isActive && <Check size={12} className="shrink-0 text-primary" />}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span>{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span>
                        {updated && (
                          <>
                            <span className="text-muted-foreground/30">·</span>
                            <span>{updated}</span>
                          </>
                        )}
                        <span className="text-muted-foreground/30">·</span>
                        <span className="capitalize">{workspace.defaultMode}</span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatRelativeTime(iso: string) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return '';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
