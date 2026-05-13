import { ArrowRight, Loader2, MessageSquare, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import * as api from '../../../api';
import { Card } from '../../../components/Card';
import type { AgentDefinition, AgentWorkspace } from '../../../types';

type WorkspaceInterfaceMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type WorkspaceInterfacePanelProps = {
  workspace: AgentWorkspace | null;
  agentsById: Map<string, AgentDefinition>;
  saveWorkspace: () => Promise<AgentWorkspace | null>;
  onError: (message: string) => void;
};

function formatError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; details?: string } } }).response;
    return response?.data?.error || response?.data?.details || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function messageId() {
  return `workspace_msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function WorkspaceInterfacePanel({
  workspace,
  agentsById,
  saveWorkspace,
  onError,
}: WorkspaceInterfacePanelProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<WorkspaceInterfaceMessage[]>([]);
  const [running, setRunning] = useState(false);
  const agentNames = useMemo(() => {
    if (!workspace) return [];
    return workspace.nodes.map(node => node.label || agentsById.get(node.agentId)?.name || 'Missing agent');
  }, [agentsById, workspace]);

  const send = async () => {
    const task = input.trim();
    if (!workspace || !task || running) return;
    setInput('');
    setRunning(true);
    onError('');

    const userMessage: WorkspaceInterfaceMessage = { id: messageId(), role: 'user', content: task };
    const assistantId = messageId();
    setMessages(current => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      const saved = await saveWorkspace();
      if (!saved) return;
      const response = await api.agentStudio.chatWorkspace(saved.id, {
        task,
        mode: saved.defaultMode,
      });
      const content = response.data.output || response.data.prompt || 'No workspace output.';
      setMessages(current => current.map(message =>
        message.id === assistantId ? { ...message, content } : message,
      ));
    } catch (error) {
      const content = formatError(error, 'Could not run workspace interface.');
      setMessages(current => current.map(message =>
        message.id === assistantId ? { ...message, content } : message,
      ));
      onError(content);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="min-h-[680px] overflow-hidden">
      {!workspace ? (
        <div className="flex min-h-[680px] items-center justify-center text-sm text-muted-foreground">
          Create a workspace before generating an interface.
        </div>
      ) : (
        <div className="grid min-h-[680px] grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b border-border p-4 xl:border-b-0 xl:border-r">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageSquare size={18} />
            </div>
            <h3 className="text-sm font-semibold">{workspace.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{workspace.defaultMode} mode</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Agents</p>
                <p className="mt-1 text-lg font-semibold">{workspace.nodes.length}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Relations</p>
                <p className="mt-1 text-lg font-semibold">{(workspace.edges || []).length}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {agentNames.map((name, index) => (
                <div key={`${name}-${index}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <ArrowRight size={13} className="text-muted-foreground" />
                </div>
              ))}
            </div>
          </aside>

          <section className="flex min-h-[680px] flex-col">
            <div className="flex-1 space-y-3 overflow-auto p-4">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Ask the workspace to run a task with its agents, context, rules, and relations.
                </div>
              ) : messages.map(message => (
                <div
                  key={message.id}
                  className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div className={
                    message.role === 'user'
                      ? 'max-w-[78%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                      : 'max-w-[88%] whitespace-pre-wrap rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm leading-6'
                  }>
                    {message.content || (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2 size={14} className="animate-spin" />
                        Running workspace
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  disabled={running}
                  rows={2}
                  placeholder="Task for this workspace..."
                  className="min-h-[52px] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!input.trim() || running}
                  className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {running ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Run
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </Card>
  );
}
