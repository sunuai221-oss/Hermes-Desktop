import type { ReactNode } from 'react';
import { BrainCircuit, KeyRound, Loader2, Plus, Trash2, Volume2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AgentWorkspace, ChatUsage, ConnectionStatus } from '../../types';

interface ChatToolbarProps {
  currentProfile: string;
  runtimeStatus: ConnectionStatus;
  runtimeProviderLabel: string;
  preferredModel: string;
  usage: ChatUsage | null;
  currentSessionLabel: string | null;
  showThinking: boolean;
  showTools: boolean;
  onToggleThinking: () => void;
  onToggleTools: () => void;
  voiceMode: boolean;
  onVoiceModeToggle: () => void;
  hasMessages: boolean;
  onNewChat: () => void;
  workspaces?: AgentWorkspace[];
  selectedWorkspaceId?: string;
  importingWorkspace?: boolean;
  workspaceImportError?: string;
  onWorkspaceChange?: (id: string) => void;
  onImportWorkspace?: () => void;
}

export function ChatToolbar({
  currentProfile,
  runtimeStatus,
  runtimeProviderLabel,
  preferredModel,
  usage,
  currentSessionLabel,
  showThinking,
  showTools,
  onToggleThinking,
  onToggleTools,
  voiceMode,
  onVoiceModeToggle,
  hasMessages,
  onNewChat,
  workspaces = [],
  selectedWorkspaceId = '',
  importingWorkspace = false,
  workspaceImportError = '',
  onWorkspaceChange,
  onImportWorkspace,
}: ChatToolbarProps) {
  return (
    <div className="flex items-center justify-between mb-4 flex-shrink-0 gap-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-8 h-8 rounded-md flex items-center justify-center font-bold text-xs',
            runtimeStatus === 'online' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
          )}>
            {currentProfile[0].toUpperCase()}
          </div>
          <div>
            <h2 className="text-sm font-semibold leading-none">{currentProfile}</h2>
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5 font-medium">
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                runtimeStatus === 'online' ? 'bg-success'
                  : runtimeStatus === 'direct' ? 'bg-primary'
                  : runtimeStatus === 'degraded' ? 'bg-warning'
                  : 'bg-muted-foreground/30',
              )} />
              {runtimeStatus}
            </p>
            <p className="text-[10px] text-muted-foreground/80 mt-1 font-mono">
              runtime {runtimeProviderLabel} {'->'} {preferredModel}
            </p>
            <p className="mt-1 max-w-[34rem] truncate text-[10px] text-muted-foreground/80">
              chat provider: <span className="font-mono text-foreground/75">{runtimeProviderLabel}</span>
              {' • '}
              model: <span className="font-mono text-foreground/75">{preferredModel}</span>
            </p>
            <p className="mt-1 max-w-[34rem] truncate text-[10px] text-muted-foreground/70">
              managed by Hermes runtime config
            </p>
            {currentSessionLabel && (
              <p className="mt-1 max-w-[28rem] truncate text-[10px] text-muted-foreground/80">
                session: <span className="font-mono text-foreground/75">{currentSessionLabel}</span>
              </p>
            )}
            <div className="mt-1.5 rounded-md border border-border/50 bg-muted/35 px-2 py-1 text-[10px]">
              {usage ? (
                <p className="truncate text-muted-foreground/85">
                  usage: <span className="font-mono text-foreground/80">{formatUsageStat(usage.totalTokens)}</span>
                  {' '}tokens (p{' '}
                  <span className="font-mono text-foreground/80">{formatUsageStat(usage.promptTokens)}</span>
                  {' '}c{' '}
                  <span className="font-mono text-foreground/80">{formatUsageStat(usage.completionTokens)}</span>
                  ){usage.cost != null && Number.isFinite(usage.cost) ? (
                    <> {' • '}cost <span className="font-mono text-foreground/80">${usage.cost.toFixed(6)}</span></>
                  ) : null}
                  {usage.rateLimitRemaining != null ? (
                    <> {' • '}rl <span className="font-mono text-foreground/80">{formatUsageStat(usage.rateLimitRemaining)}</span></>
                  ) : null}
                </p>
              ) : (
                <p className="text-muted-foreground/65">usage unavailable</p>
              )}
            </div>
          </div>
        </div>

        <div className="h-6 w-[1px] bg-muted mx-1 hidden md:block" />

        <div className="flex items-center gap-1">
          <IconToggle
            icon={<BrainCircuit size={13} />}
            label="Thinking"
            active={showThinking}
            onClick={onToggleThinking}
          />
          <IconToggle
            icon={<KeyRound size={13} />}
            label="Tools"
            active={showTools}
            onClick={onToggleTools}
          />
        </div>

        <button
          onClick={onVoiceModeToggle}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs border transition-colors',
            voiceMode ? 'border-primary/30 bg-primary/12 text-primary' : 'border-border bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          <Volume2 size={13} />
          {voiceMode ? 'Voice ON' : 'Voice OFF'}
        </button>

        {workspaces.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-1">
            <select
              value={selectedWorkspaceId}
              onChange={event => onWorkspaceChange?.(event.target.value)}
              className="max-w-[180px] bg-transparent text-xs text-foreground focus:outline-none"
              title="Workspace"
            >
              {workspaces.map(workspace => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={onImportWorkspace}
              disabled={!selectedWorkspaceId || importingWorkspace}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
              title="Import workspace"
            >
              {importingWorkspace ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Import workspace
            </button>
          </div>
        )}

        {workspaceImportError && (
          <p className="text-[11px] text-destructive">{workspaceImportError}</p>
        )}
      </div>

      {hasMessages && (
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 size={12} /> New chat
        </button>
      )}
    </div>
  );
}

function formatUsageStat(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function IconToggle({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${active ? 'Hide' : 'Show'} ${label}`}
      aria-label={`${active ? 'Hide' : 'Show'} ${label}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
        active
          ? 'border-primary/35 bg-primary/12 text-primary'
          : 'border-border bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
