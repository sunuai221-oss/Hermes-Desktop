import { useState } from 'react';
import { Check, CheckCircle2, Clock, Copy, Loader2, Send, Wand2 } from 'lucide-react';
import { Card } from '../../../components/Card';
import { cn } from '../../../lib/utils';
import type { AgentWorkspace, AgentWorkspaceExecutionResult, AgentWorkspaceExecutionRun } from '../../../types';

type WorkspaceRunPanelProps = {
  workspace: AgentWorkspace | null;
  generatedPrompt: string;
  copied: boolean;
  generating: boolean;
  executing: boolean;
  executionResult: AgentWorkspaceExecutionResult | null;
  onGeneratePrompt: () => void;
  onCopyPrompt: () => void;
  onSendToChat: () => void;
  onExecuteWorkspace: () => void;
};

export function WorkspaceRunPanel({
  workspace,
  generatedPrompt,
  copied,
  generating,
  executing,
  executionResult,
  onGeneratePrompt,
  onCopyPrompt,
  onSendToChat,
  onExecuteWorkspace,
}: WorkspaceRunPanelProps) {
  const [selectedRunIndex, setSelectedRunIndex] = useState<number | null>(null);

  const runs = executionResult?.runs || [];
  const selectedRun = selectedRunIndex !== null ? runs[selectedRunIndex] : null;

  // Reset selection when execution result changes
  if (runs.length > 0 && selectedRunIndex === null) {
    setSelectedRunIndex(0);
  }

  return (
    <Card className="min-h-[680px] p-5">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Runs</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Execution surface for this workspace. Prompt mode sends drafts to Chat; delegate mode asks the gateway agent
            to orchestrate subagents; profile runtime dispatches each node to its configured Hermes profile.
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
            disabled={!workspace}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <Send size={15} />
            Send to Chat
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
          {/* Sidebar — workspace info */}
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
                <p className="text-[10px] uppercase text-muted-foreground">Runs</p>
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

          {/* Main content */}
          <div className="space-y-4">
            {/* ── Timeline (when runs exist) ── */}
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
                        isLast={index === runs.length - 1}
                        isSelected={selectedRunIndex === index}
                        onSelect={() => setSelectedRunIndex(index)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Detail panel (selected run output or execution output) ── */}
            {selectedRun?.output ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                    Output — {selectedRun.label || selectedRun.role}
                  </h4>
                </div>
                <textarea
                  value={selectedRun.output}
                  readOnly
                  className="min-h-[180px] w-full resize-y rounded-xl border border-border bg-background px-4 py-3 font-mono text-xs leading-5 text-foreground focus:outline-none"
                />
              </div>
            ) : executionResult?.output && !selectedRun ? (
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

            {/* ── Generated Prompt ── */}
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

// ── Timeline Step ────────────────────────────────────────────────

function RunTimelineStep({
  run,
  isLast,
  isSelected,
  onSelect,
}: {
  run: AgentWorkspaceExecutionRun;
  isLast: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const hasOutput = Boolean(run.output);
  const statusIcon = hasOutput ? 'success' : 'pending';

  return (
    <div className="relative flex gap-4 pb-2">
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'z-10 flex h-6 w-6 items-center justify-center rounded-full border-2',
            statusIcon === 'success'
              ? 'border-success bg-success/10'
              : 'border-muted-foreground/30 bg-muted',
          )}
        >
          {statusIcon === 'success' ? (
            <CheckCircle2 size={13} className="text-success" />
          ) : (
            <Clock size={12} className="text-muted-foreground" />
          )}
        </div>
        {!isLast && (
          <div className="mt-0 w-px flex-1 bg-border" />
        )}
      </div>

      {/* Content */}
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
                {run.profileName && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span>{run.profileName}</span>
                  </>
                )}
              </div>
            </div>
            {hasOutput && (
              <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                done
              </span>
            )}
          </div>
          {hasOutput && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground/70 leading-relaxed">
              {run.output}
            </p>
          )}
        </button>
      </div>
    </div>
  );
}