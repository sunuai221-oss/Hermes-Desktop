import { useState } from 'react';
import { Check, Loader2, MessageSquare, Pause, Play, RotateCw, Save, Trash2 } from 'lucide-react';
import type { KanbanTask, KanbanTaskDetail } from '../../types';
import { cn } from '../../lib/utils';
import { formatPayload, formatTs } from './kanbanUtils';
import {
  ActionButton,
  Chip,
  HistoryBlock,
  IconButton,
  Meta,
  StatusBadge,
  TextArea,
  TokenList,
} from './KanbanControls';

type DetailTab = 'overview' | 'actions' | 'history';

export function TaskDetail({
  detail, task, assigneeNames, assigneeDraft, setAssigneeDraft,
  commentText, setCommentText, outcomeText, setOutcomeText,
  acting, onAssign, onComment, onComplete, onBlock, onUnblock, onArchive, onReclaim,
}: {
  detail: KanbanTaskDetail | null;
  task: KanbanTask;
  assigneeNames: string[];
  assigneeDraft: string;
  setAssigneeDraft: (value: string) => void;
  commentText: string;
  setCommentText: (value: string) => void;
  outcomeText: string;
  setOutcomeText: (value: string) => void;
  acting: string | null;
  onAssign: () => void;
  onComment: () => void;
  onComplete: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  onArchive: () => void;
  onReclaim: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const terminal = task.status === 'done' || task.status === 'archived';

  const tabs: Array<{ id: DetailTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'actions', label: 'Actions' },
    { id: 'history', label: 'History', count:
      (detail?.comments.length || 0) + (detail?.runs.length || 0) + (detail?.events.length || 0)
    },
  ];

  return (
    <div>
      <div className="mb-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <span className="rounded bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
            priority {task.priority || 0}
          </span>
        </div>
        <h3 className="break-words text-lg font-bold leading-tight">{task.title}</h3>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{task.id}</p>
      </div>

      <div className="mb-3 flex gap-1 rounded-lg bg-muted/40 p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all',
              activeTab === tab.id
                ? 'bg-card text-brand-amber shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1 text-[9px] opacity-60">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-3">
          {task.body && (
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {task.body}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Meta label="Created" value={formatTs(task.created_at)} />
            <Meta label="Completed" value={formatTs(task.completed_at)} />
            <Meta label="Tenant" value={task.tenant || '-'} />
            <Meta label="Workspace" value={task.workspace_path || task.workspace_kind || '-'} />
          </div>
          {(task.skills || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {task.skills!.map(skill => <Chip key={skill}>{skill}</Chip>)}
            </div>
          )}
          {(task.result || detail?.latest_summary) && (
            <div className="rounded-lg border border-success/20 bg-success/10 p-3 text-sm whitespace-pre-wrap">
              {task.result || detail?.latest_summary}
            </div>
          )}
        </div>
      )}

      {activeTab === 'actions' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border/50 p-3">
            <label className="mb-2 block text-xs text-muted-foreground">Assignee</label>
            <div className="flex gap-2">
              <select
                value={assigneeDraft}
                onChange={event => setAssigneeDraft(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
              >
                <option value="">Unassigned</option>
                {assigneeNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              <IconButton label="Assign" icon={Save} loading={acting === 'assign'} disabled={acting !== null} onClick={onAssign} />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/50 p-3">
            <TextArea label="Outcome" value={outcomeText} onChange={setOutcomeText} placeholder="Result or block reason" compact />
            <div className="grid grid-cols-2 gap-2">
              {!terminal && <ActionButton icon={Check} label="Complete" loading={acting === 'complete'} disabled={acting !== null} onClick={onComplete} />}
              {!terminal && task.status !== 'blocked' && <ActionButton icon={Pause} label="Block" loading={acting === 'block'} disabled={acting !== null} onClick={onBlock} />}
              {task.status === 'blocked' && <ActionButton icon={Play} label="Unblock" loading={acting === 'unblock'} disabled={acting !== null} onClick={onUnblock} />}
              {task.status === 'running' && <ActionButton icon={RotateCw} label="Reclaim" loading={acting === 'reclaim'} disabled={acting !== null} onClick={onReclaim} />}
              {task.status !== 'archived' && <ActionButton icon={Trash2} label="Archive" loading={acting === 'archive'} disabled={acting !== null} danger onClick={onArchive} />}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/50 p-3">
            <TextArea label="Comment" value={commentText} onChange={setCommentText} compact />
            <button
              onClick={onComment}
              disabled={acting !== null || !commentText.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm font-medium hover:bg-muted/80 disabled:opacity-40"
            >
              {acting === 'comment' ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
              Add comment
            </button>
          </div>
        </div>
      )}

      {activeTab === 'history' && detail && (
        <div className="space-y-4">
          {(detail.parents.length > 0 || detail.children.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <TokenList label="Parents" values={detail.parents} />
              <TokenList label="Children" values={detail.children} />
            </div>
          )}
          {detail.comments.length > 0 && (
            <HistoryBlock title={`Comments (${detail.comments.length})`}>
              {detail.comments.slice(-5).map((comment, index) => (
                <div key={`${comment.created_at}-${index}`} className="rounded-lg bg-muted/30 p-2.5">
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>{comment.author}</span>
                    <span>{formatTs(comment.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-xs">{comment.body}</p>
                </div>
              ))}
            </HistoryBlock>
          )}
          {detail.runs.length > 0 && (
            <HistoryBlock title={`Runs (${detail.runs.length})`}>
              {detail.runs.slice(-4).map(run => (
                <div key={run.id} className="rounded-lg bg-muted/30 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">#{run.id} {run.outcome || run.status || 'running'}</span>
                    <span className="text-muted-foreground">{formatTs(run.started_at)}</span>
                  </div>
                  {run.summary && <p className="mt-1 line-clamp-2 text-muted-foreground">{run.summary}</p>}
                  {run.error && <p className="mt-1 line-clamp-2 text-destructive">{run.error}</p>}
                </div>
              ))}
            </HistoryBlock>
          )}
          {detail.events.length > 0 && (
            <HistoryBlock title={`Events (${detail.events.length})`}>
              {detail.events.slice(-6).map((event, index) => (
                <div key={`${event.created_at}-${event.kind}-${index}`} className="flex items-start justify-between gap-3 rounded-lg bg-muted/30 p-2.5 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium">{event.kind}</p>
                    {formatPayload(event.payload) && <p className="mt-1 truncate text-muted-foreground">{formatPayload(event.payload)}</p>}
                  </div>
                  <span className="shrink-0 text-[9px] text-muted-foreground">{formatTs(event.created_at)}</span>
                </div>
              ))}
            </HistoryBlock>
          )}
          {detail.comments.length === 0 && detail.runs.length === 0 && detail.events.length === 0 && (
            <div className="py-4 text-center text-xs text-muted-foreground/50">No history yet</div>
          )}
        </div>
      )}
    </div>
  );
}
