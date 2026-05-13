import { Check, Copy, Loader2, Send, Wand2 } from 'lucide-react';
import { Card } from '../../../components/Card';
import type { AgentWorkspace, AgentWorkspaceExecutionResult } from '../../../types';

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
            {executionResult?.output && (
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
            )}
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
