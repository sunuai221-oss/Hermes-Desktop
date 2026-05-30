import { AlertTriangle, CheckCircle2, Loader2, MessageSquare, PlaySquare, RotateCcw, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import * as api from '../../../api';
import { Card } from '../../../components/Card';
import { useProfiles } from '../../../contexts/ProfileContext';
import { cn } from '../../../lib/utils';
import type { AgentDefinition, AgentWorkspace, AgentWorkspaceExecutionResult } from '../../../types';
import { resolveWorkspaceNodeProfile } from '../profileRuntime';

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
  onOpenSessionInChat?: (sessionId: string) => void;
};

type AgentProgressStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
type RuntimeAttachmentKind = 'document' | 'dataset';

type WorkspaceRuntimeAttachment = {
  kind: RuntimeAttachmentKind;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  bytes: number;
};

const MAX_RUNTIME_ATTACHMENT_BYTES = 35 * 1024 * 1024;
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.docm,.dot,.dotm,.dotx,.odt,.ott,.rtf,.pages,.ppt,.pptx,.pptm,.pot,.potm,.potx,.odp,.otp,.key,.xls,.xlsx,.xlsm,.xlsb,.ods,.ots,.csv,.tsv,.numbers,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.tif,.webp,.svg,.txt,.md,.markdown,.log';
const DATASET_ACCEPT = '.csv,.tsv,.txt,.xls,.xlsx,.xlsm,.json,.parquet';

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read attachment.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read attachment.'));
    reader.readAsDataURL(file);
  });
}

function normalizeAgentProgressStatus(status?: AgentWorkspaceExecutionResult['status'] | string): AgentProgressStatus {
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'blocked';
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'running';
  return 'pending';
}

function buildAgentProgress(workspace: AgentWorkspace, result: AgentWorkspaceExecutionResult): Record<string, AgentProgressStatus> {
  const progress: Record<string, AgentProgressStatus> = {};
  workspace.nodes.forEach(node => {
    progress[node.id] = 'pending';
  });

  const runs = Array.isArray(result.runs) ? result.runs : [];
  if (runs.length > 0) {
    runs.forEach(run => {
      if (!run?.nodeId || !Object.prototype.hasOwnProperty.call(progress, run.nodeId)) return;
      progress[run.nodeId] = normalizeAgentProgressStatus(run.status || result.status);
    });
    return progress;
  }

  const terminalStatus = normalizeAgentProgressStatus(result.status);
  workspace.nodes.forEach(node => {
    progress[node.id] = terminalStatus;
  });
  return progress;
}

export function WorkspaceInterfacePanel({
  workspace,
  agentsById,
  saveWorkspace,
  onError,
  onOpenSessionInChat,
}: WorkspaceInterfacePanelProps) {
  const { currentProfile, profileMetadata } = useProfiles();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<WorkspaceInterfaceMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [agentProgress, setAgentProgress] = useState<Record<string, AgentProgressStatus>>({});
  const [latestRunSessionId, setLatestRunSessionId] = useState<string | null>(null);
  const [documentAttachment, setDocumentAttachment] = useState<WorkspaceRuntimeAttachment | null>(null);
  const [datasetAttachment, setDatasetAttachment] = useState<WorkspaceRuntimeAttachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<{ timeouts: number[]; intervals: number[] }>({ timeouts: [], intervals: [] });
  const runTokenRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const workspaceIdRef = useRef<string | null>(workspace?.id || null);

  const agentRuntimeList = useMemo(() => {
    if (!workspace) return [];
    return workspace.nodes.map((node, index) => ({
      nodeId: node.id,
      label: node.label || agentsById.get(node.agentId)?.name || `Agent ${index + 1}`,
      index,
      profileResolution: resolveWorkspaceNodeProfile({
        requestedProfileName: node.profileName,
        currentProfile,
        profileMetadata,
      }),
    }));
  }, [agentsById, currentProfile, profileMetadata, workspace]);

  const clearTimers = useCallback(() => {
    for (const timeoutId of timersRef.current.timeouts) window.clearTimeout(timeoutId);
    for (const intervalId of timersRef.current.intervals) window.clearInterval(intervalId);
    timersRef.current = { timeouts: [], intervals: [] };
  }, []);

  const resetRunState = useCallback((options: { keepMessages?: boolean } = {}) => {
    runTokenRef.current = null;
    clearTimers();
    setRunning(false);
    setAgentProgress({});
    setLatestRunSessionId(null);
    if (!options.keepMessages) setMessages([]);
  }, [clearTimers]);

  const autoScroll = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    autoScroll();
  }, [messages, agentProgress, autoScroll]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      resetRunState({ keepMessages: true });
    };
  }, [resetRunState]);

  useEffect(() => {
    const nextWorkspaceId = workspace?.id || null;
    if (workspaceIdRef.current === nextWorkspaceId) return;
    workspaceIdRef.current = nextWorkspaceId;
    resetRunState();
    setInput('');
    setDocumentAttachment(null);
    setDatasetAttachment(null);
    onError('');
  }, [workspace?.id, onError, resetRunState]);

  const handleAttachmentSelection = useCallback(async (kind: RuntimeAttachmentKind, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] || null;
    event.currentTarget.value = '';
    if (!file) return;

    if (file.size > MAX_RUNTIME_ATTACHMENT_BYTES) {
      onError(`Attachment "${file.name}" exceeds ${Math.round(MAX_RUNTIME_ATTACHMENT_BYTES / (1024 * 1024))}MB.`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const payload: WorkspaceRuntimeAttachment = {
        kind,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
        bytes: file.size,
      };
      if (kind === 'document') setDocumentAttachment(payload);
      else setDatasetAttachment(payload);
      onError('');
    } catch (error) {
      onError(formatError(error, `Could not load ${kind} attachment.`));
    }
  }, [onError]);

  const clearAttachment = useCallback((kind: RuntimeAttachmentKind) => {
    if (kind === 'document') setDocumentAttachment(null);
    else setDatasetAttachment(null);
  }, []);

  const markAssistantMessage = useCallback((targetMessageId: string, content: string, token: string) => {
    if (!mountedRef.current || runTokenRef.current !== token) return;
    setMessages(current => current.map(message => (
      message.id === targetMessageId ? { ...message, content } : message
    )));
  }, []);

  const revealProgressively = useCallback((targetMessageId: string, content: string, token: string) => {
    if (content.length <= 200) {
      markAssistantMessage(targetMessageId, content, token);
      return;
    }

    const chunkSize = 80;
    let pos = 0;
    const intervalId = window.setInterval(() => {
      if (!mountedRef.current || runTokenRef.current !== token) {
        window.clearInterval(intervalId);
        return;
      }
      pos += chunkSize;
      if (pos >= content.length) {
        pos = content.length;
        window.clearInterval(intervalId);
      }
      markAssistantMessage(targetMessageId, content.slice(0, pos), token);
    }, 30);
    timersRef.current.intervals.push(intervalId);
  }, [markAssistantMessage]);

  const send = async () => {
    const task = input.trim();
    const hasAttachment = Boolean(documentAttachment || datasetAttachment);
    if (!workspace || running) return;
    if (!task && !hasAttachment) return;
    const effectiveTask = task || 'Analyze the attached file(s) and return actionable insights.';

    resetRunState({ keepMessages: true });
    const token = `${workspace.id}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    runTokenRef.current = token;

    setInput('');
    setRunning(true);
    setLatestRunSessionId(null);
    onError('');

    const userMessage: WorkspaceInterfaceMessage = { id: messageId(), role: 'user', content: effectiveTask };
    const assistantId = messageId();
    setMessages(current => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);

    const progress: Record<string, AgentProgressStatus> = {};
    workspace.nodes.forEach((node, index) => {
      progress[node.id] = index === 0 ? 'running' : 'pending';
    });
    setAgentProgress(progress);

    workspace.nodes.forEach((node, index) => {
      const timeoutId = window.setTimeout(() => {
        if (!mountedRef.current || runTokenRef.current !== token) return;
        setAgentProgress(prev => ({ ...prev, [node.id]: 'running' }));
      }, (index + 1) * 800);
      timersRef.current.timeouts.push(timeoutId);
    });

    try {
      const saved = await saveWorkspace();
      if (!saved || !mountedRef.current || runTokenRef.current !== token) return;

      const response = await api.agentStudio.runWorkspaceTask(saved.id, {
        task: effectiveTask,
        mode: saved.defaultMode,
        attachments: {
          ...(documentAttachment ? {
            document: {
              fileName: documentAttachment.fileName,
              dataUrl: documentAttachment.dataUrl,
              mimeType: documentAttachment.mimeType,
            },
          } : {}),
          ...(datasetAttachment ? {
            dataset: {
              fileName: datasetAttachment.fileName,
              dataUrl: datasetAttachment.dataUrl,
              mimeType: datasetAttachment.mimeType,
            },
          } : {}),
        },
      });
      if (!mountedRef.current || runTokenRef.current !== token) return;
      setLatestRunSessionId(response.data.session_id || null);

      setAgentProgress(buildAgentProgress(saved, response.data));

      const runs = response.data.runs || [];
      const fallback = response.data.output || response.data.prompt || 'No workspace output.';
      const runOutput = runs.map((run: { output?: string }) => run.output || '').filter(Boolean).join('\n\n---\n\n');
      revealProgressively(assistantId, runOutput || fallback, token);
    } catch (error) {
      if (!mountedRef.current || runTokenRef.current !== token) return;
      const failedProgress: Record<string, AgentProgressStatus> = {};
      workspace.nodes.forEach(node => {
        failedProgress[node.id] = 'failed';
      });
      setAgentProgress(failedProgress);
      const content = formatError(error, 'Could not run workspace task.');
      markAssistantMessage(assistantId, content, token);
      onError(content);
    } finally {
      if (mountedRef.current && runTokenRef.current === token) {
        runTokenRef.current = null;
        clearTimers();
        setRunning(false);
      }
    }
  };

  return (
    <Card className="min-h-[680px] overflow-hidden">
      {!workspace ? (
        <div className="flex min-h-[680px] items-center justify-center text-sm text-muted-foreground">
          Create a workspace before running tasks.
        </div>
      ) : (
        <div className="grid min-h-[680px] grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b border-border p-4 xl:border-b-0 xl:border-r">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <PlaySquare size={18} />
            </div>
            <h3 className="text-sm font-semibold">{workspace.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{workspace.defaultMode} mode</p>
            <p className="mt-3 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              This interface is a task runner. Each run is also persisted as a workspace session that you can reopen in Chat.
            </p>
            {workspace.defaultMode === 'profiles' && (
              <p className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                Nodes run on their pinned profile when set, otherwise they fall back to the current app profile.
              </p>
            )}
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
              {agentRuntimeList.map(({ nodeId, label, index, profileResolution }) => {
                const status = agentProgress[nodeId] || 'pending';
                return (
                  <div
                    key={nodeId}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all',
                      status === 'running'
                        ? 'border-primary/30 bg-primary/8'
                        : status === 'completed'
                          ? 'border-success/20 bg-success/5'
                          : status === 'failed'
                            ? 'border-destructive/25 bg-destructive/8'
                            : status === 'blocked'
                              ? 'border-amber-500/25 bg-amber-500/8'
                          : 'border-border',
                    )}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{label}</span>
                      {workspace.defaultMode === 'profiles' && (
                        <span className={cn(
                          'block truncate text-[10px]',
                          profileResolution.status === 'invalid' || profileResolution.status === 'missing'
                            ? 'text-destructive'
                            : profileResolution.status === 'offline'
                              ? 'text-amber-700 dark:text-amber-300'
                              : 'text-muted-foreground',
                        )}>
                          {profileResolution.usesFallback
                            ? `Current app -> ${profileResolution.effectiveProfileName}`
                            : profileResolution.effectiveProfileName}
                        </span>
                      )}
                    </span>
                    {status === 'running' && (
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                      </span>
                    )}
                    {status === 'completed' && <CheckCircle2 size={14} className="shrink-0 text-success" />}
                    {status === 'failed' && <AlertTriangle size={14} className="shrink-0 text-destructive" />}
                    {status === 'blocked' && <AlertTriangle size={14} className="shrink-0 text-amber-700 dark:text-amber-300" />}
                    {status === 'pending' && <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />}
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-[680px] flex-col">
            <div className="flex-1 space-y-3 overflow-auto p-4">
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Run an isolated task with this workspace configuration. The local log mirrors a persisted workspace session.
                </div>
              ) : messages.map(message => (
                <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={message.role === 'user'
                      ? 'max-w-[78%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                      : 'max-w-[88%] whitespace-pre-wrap rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm leading-6'}
                  >
                    {message.content || (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2 size={14} className="animate-spin" />
                        Running workspace
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-border p-3">
              <div className="mb-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => latestRunSessionId && onOpenSessionInChat?.(latestRunSessionId)}
                  disabled={!latestRunSessionId}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <MessageSquare size={12} /> Open in Chat
                </button>
                <button
                  type="button"
                  onClick={() => resetRunState()}
                  disabled={running || messages.length === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw size={12} /> Clear
                </button>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground">
                  <input
                    type="file"
                    accept={DOCUMENT_ACCEPT}
                    className="hidden"
                    onChange={event => {
                      void handleAttachmentSelection('document', event);
                    }}
                  />
                  Document
                </label>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground">
                  <input
                    type="file"
                    accept={DATASET_ACCEPT}
                    className="hidden"
                    onChange={event => {
                      void handleAttachmentSelection('dataset', event);
                    }}
                  />
                  Dataset
                </label>
                {documentAttachment && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
                    Doc: {documentAttachment.fileName}
                    <button
                      type="button"
                      className="text-muted-foreground/70 hover:text-foreground"
                      onClick={() => clearAttachment('document')}
                      aria-label="Remove document attachment"
                    >
                      x
                    </button>
                  </span>
                )}
                {datasetAttachment && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground">
                    Data: {datasetAttachment.fileName}
                    <button
                      type="button"
                      className="text-muted-foreground/70 hover:text-foreground"
                      onClick={() => clearAttachment('dataset')}
                      aria-label="Remove dataset attachment"
                    >
                      x
                    </button>
                  </span>
                )}
              </div>
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
                  disabled={(!input.trim() && !documentAttachment && !datasetAttachment) || running}
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
