import { useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, Loader2, MessageSquare, Send, Wand2 } from 'lucide-react';
import { Card } from '../../../components/Card';
import { useProfiles } from '../../../contexts/ProfileContext';
import { cn } from '../../../lib/utils';
import type {
  AgentWorkspace,
  AgentWorkspaceExecutionResult,
  AgentWorkspaceExecutionRun,
  ProfileMetadata,
  WorkspaceAgentNode,
} from '../../../types';
import {
  resolveWorkspaceNodeProfile,
  type WorkspaceNodeProfileResolution,
} from '../profileRuntime';

type WorkspaceRunPanelProps = {
  workspace: AgentWorkspace | null;
  generatedPrompt: string;
  copied: boolean;
  generating: boolean;
  executing: boolean;
  sendingToChat: boolean;
  executionResult: AgentWorkspaceExecutionResult | null;
  onGeneratePrompt: () => void;
  onCopyPrompt: () => void;
  onSendToChat: () => void;
  onExecuteWorkspace: () => void;
  onOpenPersistedRun?: () => void;
};

export function WorkspaceRunPanel({
  workspace,
  generatedPrompt,
  copied,
  generating,
  executing,
  sendingToChat,
  executionResult,
  onGeneratePrompt,
  onCopyPrompt,
  onSendToChat,
  onExecuteWorkspace,
  onOpenPersistedRun,
}: WorkspaceRunPanelProps) {
  const { currentProfile, profileMetadata } = useProfiles();
  const [selectedRunIndex, setSelectedRunIndex] = useState<number | null>(null);

  const runs = useMemo(() => executionResult?.runs ?? [], [executionResult?.runs]);
  const nodesById = useMemo(
    () => new Map((workspace?.nodes || []).map(node => [node.id, node] as const)),
    [workspace?.nodes],
  );
  const effectiveSelectedRunIndex = runs.length === 0
    ? null
    : selectedRunIndex !== null && selectedRunIndex < runs.length
      ? selectedRunIndex
      : 0;
  const selectedRun = effectiveSelectedRunIndex !== null ? runs[effectiveSelectedRunIndex] || null : null;

  return (
    <Card className="min-h-[680px] p-5">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Execution</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Execution surface for this workspace. Prompt mode sends drafts to Chat; delegate mode asks the gateway agent
            to orchestrate subagents; profile runtime dispatches each node to its configured Hermes profile. Completed runs
            are also persisted as Chat sessions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onGeneratePrompt}
            disabled={!workspace || generating}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            Generate prompt
          </button>
          <button
            onClick={onSendToChat}
            disabled={!workspace || sendingToChat}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {sendingToChat ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {sendingToChat ? 'Sending...' : 'Send to Chat'}
          </button>
          <button
            onClick={onExecuteWorkspace}
            disabled={!workspace || executing}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {executing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Execute
          </button>
          <button
            onClick={onOpenPersistedRun}
            disabled={!executionResult?.session_id}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <MessageSquare size={15} />
            Open run in Chat
          </button>
          <button
            onClick={onCopyPrompt}
            disabled={!generatedPrompt}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {!workspace ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Create a workspace before generating an execution prompt.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <div>
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">Workspace</p>
              <p className="mt-1 text-sm font-medium text-foreground">{workspace.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-background p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Nodes</p>
                <p className="mt-1 text-lg font-semibold">{workspace.nodes.length}</p>
              </div>
              <div className="rounded-lg bg-background p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Mode</p>
                <p className="mt-1 text-sm font-semibold">{workspace.defaultMode}</p>
              </div>
            </div>
            {runs.length > 0 && (
              <div className="rounded-lg bg-background p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Run Steps</p>
                <p className="mt-1 text-lg font-semibold">{runs.length}</p>
              </div>
            )}
            <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Execution modes</p>
              <ul className="mt-2 space-y-1">
                <li>✓ Prompt generation</li>
                <li>✓ Delegate task bridge</li>
                <li>✓ Profile runtime bridge</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            {runs.length > 0 && (
              <div className="rounded-xl border border-border">
                <div className="border-b border-border px-4 py-2.5">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    Execution Timeline
                  </h4>
                </div>
                <div className="p-4">
                  <div className="relative space-y-0">
                    {runs.map((run, index) => (
                      <RunTimelineStep
                        key={`${run.nodeId}-${index}`}
                        run={run}
                        node={nodesById.get(run.nodeId) || null}
                        currentProfile={currentProfile}
                        profileMetadata={profileMetadata}
                        isLast={index === runs.length - 1}
                        isSelected={effectiveSelectedRunIndex === index}
                        onSelect={() => setSelectedRunIndex(index)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {selectedRun ? (
              <RunDetailPanel
                run={selectedRun}
                resolution={resolveWorkspaceNodeProfile({
                  requestedProfileName: nodesById.get(selectedRun.nodeId)?.profileName,
                  currentProfile,
                  profileMetadata,
                  fallbackProfileName: selectedRun.profileName,
                })}
              />
            ) : executionResult?.output ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">Execution Output</h4>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                    {executionResult.mode}
                  </span>
                </div>
                <textarea
                  value={executionResult.output}
                  readOnly
                  className="min-h-[180px] w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-xs leading-5 text-foreground focus:outline-none"
                />
              </div>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">Generated Prompt</h4>
              </div>
              <textarea
                value={generatedPrompt}
                readOnly
                placeholder="Generate a workspace prompt to prepare the execution payload."
                className="min-h-[280px] w-full resize-y rounded-xl border border-border bg-muted/30 px-4 py-3 font-mono text-xs leading-5 text-foreground focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function RunTimelineStep({
  run,
  node,
  currentProfile,
  profileMetadata,
  isLast,
  isSelected,
  onSelect,
}: {
  run: AgentWorkspaceExecutionRun;
  node: WorkspaceAgentNode | null;
  currentProfile: string;
  profileMetadata: ProfileMetadata[];
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const status = getRunDisplayStatus(run);
  const preview = run.output || run.error || '';
  const profileResolution = resolveWorkspaceNodeProfile({
    requestedProfileName: node?.profileName,
    currentProfile,
    profileMetadata,
    fallbackProfileName: run.profileName,
  });

  return (
    <div className="relative flex gap-4 pb-2">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'z-10 flex h-6 w-6 items-center justify-center rounded-full border-2',
            status === 'completed'
              ? 'border-success bg-success/10'
              : status === 'failed'
                ? 'border-destructive/20 bg-destructive/5'
                : status === 'blocked'
                  ? 'border-amber-500/20 bg-amber-500/5'
                  : 'border-muted-foreground/30 bg-muted',
          )}
        >
          {status === 'completed' ? (
            <CheckCircle2 size={13} className="text-success" />
          ) : status === 'failed' ? (
            <AlertTriangle size={13} className="text-destructive" />
          ) : (
            <Clock
              size={12}
              className={status === 'blocked' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}
            />
          )}
        </div>
        {!isLast && <div className="mt-0 w-px flex-1 bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
            isSelected
              ? 'border-primary/30 bg-primary/8'
              : 'border-border bg-muted/20 hover:bg-muted/40',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {run.label || run.role}
              </p>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-md bg-muted px-1.5 py-0.5 uppercase">{run.role}</span>
                <span className="text-muted-foreground/30">·</span>
                <span className={cn(
                  profileResolution.status === 'invalid' || profileResolution.status === 'missing'
                    ? 'text-destructive'
                    : profileResolution.status === 'offline'
                      ? 'text-amber-700 dark:text-amber-300'
                      : '',
                )}>
                  {profileResolution.usesFallback
                    ? `App profile -> ${profileResolution.effectiveProfileName}`
                    : profileResolution.effectiveProfileName}
                </span>
              </div>
            </div>
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase',
              status === 'completed'
                ? 'bg-success/10 text-success'
                : status === 'failed'
                  ? 'bg-destructive/10 text-destructive'
                  : status === 'blocked'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground',
            )}>
              {status}
            </span>
          </div>
          {preview && (
            <p className={cn(
              'mt-1.5 line-clamp-2 text-xs leading-relaxed',
              run.error && !run.output ? 'text-destructive/80' : 'text-muted-foreground/70',
            )}>
              {preview}
            </p>
          )}
        </button>
      </div>
    </div>
  );
}

function RunDetailPanel({
  run,
  resolution,
}: {
  run: AgentWorkspaceExecutionRun;
  resolution: WorkspaceNodeProfileResolution;
}) {
  const status = getRunDisplayStatus(run);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Run Detail — {run.label || run.role}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">{resolution.detail}</p>
        </div>
        <span className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
          status === 'completed'
            ? 'bg-success/10 text-success'
            : status === 'failed'
              ? 'bg-destructive/10 text-destructive'
              : status === 'blocked'
                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'bg-muted text-muted-foreground',
        )}>
          {status}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-md bg-muted px-1.5 py-0.5 uppercase">{run.role}</span>
        <span className="rounded-md border border-border px-1.5 py-0.5">
          {resolution.usesFallback
            ? `App profile -> ${resolution.effectiveProfileName}`
            : resolution.effectiveProfileName}
        </span>
      </div>
      {Array.isArray(run.toolsetOutputs) && run.toolsetOutputs.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Toolsets</p>
          <div className="mt-2 space-y-1.5 text-xs">
            {run.toolsetOutputs.map((output, index) => (
              <div key={`${output.toolset}-${index}`} className="rounded-md border border-border bg-background px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{output.toolset}</span>
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] uppercase',
                    output.status === 'completed'
                      ? 'bg-success/10 text-success'
                      : output.status === 'failed'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted text-muted-foreground',
                  )}>
                    {output.status}
                  </span>
                </div>
                {output.summary && <p className="mt-1 text-muted-foreground">{output.summary}</p>}
                {output.error && <p className="mt-1 text-destructive">{output.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {run.output && (
        <textarea
          value={run.output}
          readOnly
          className="min-h-[180px] w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-xs leading-5 text-foreground focus:outline-none"
        />
      )}
      {run.error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs leading-5 text-destructive">
          {run.error}
        </div>
      )}
    </div>
  );
}

function getRunDisplayStatus(run: AgentWorkspaceExecutionRun) {
  if (run.status) return run.status;
  return run.output ? 'completed' : 'pending';
}
