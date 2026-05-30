import { Inbox } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { KanbanTask } from '../../types';
import { cn } from '../../lib/utils';
import type { LaneVisual } from './kanbanUtils';
import { Chip } from './KanbanControls';

export function Lane({ lane, tasks, selectedTaskId, draggingTaskId, onSelect }: {
  lane: LaneVisual;
  tasks: KanbanTask[];
  selectedTaskId: string | null;
  draggingTaskId: string | null;
  onSelect: (task: KanbanTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: lane.status,
    data: { status: lane.status, type: 'lane' },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl border border-border/50 bg-card/20 backdrop-blur-sm min-w-[180px] flex-1 max-w-[240px] transition-all',
        isOver && 'border-brand-amber/40 bg-brand-amber/5 shadow-md',
      )}
    >
      <div
        className="h-0.5 w-full shrink-0"
        style={{ background: `linear-gradient(90deg, ${lane.accent}, ${lane.accentRing})` }}
      />
      <div className="flex h-9 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', lane.dot)} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">{lane.label}</span>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: lane.accentSoft, color: lane.accent }}
        >
          {tasks.length}
        </span>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-2">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/30 px-3 py-8 text-center">
            <Inbox size={16} className="mb-1 text-muted-foreground/20" />
            <span className="text-[10px] text-muted-foreground/35">No tasks</span>
          </div>
        ) : (
          tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              active={selectedTaskId === task.id}
              dragging={draggingTaskId === task.id}
              accent={lane.accent}
              onClick={() => onSelect(task)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, active, dragging, accent, onClick }: {
  task: KanbanTask;
  active: boolean;
  dragging?: boolean;
  accent: string;
  onClick: () => void;
}) {
  const prio = task.priority || 0;
  const prioColor = prio >= 3 ? 'hsl(var(--destructive))' : prio >= 2 ? 'hsl(var(--warning))' : undefined;
  const prioBg = prio >= 3
    ? 'hsl(var(--destructive) / 0.12)'
    : prio >= 2
      ? 'hsl(var(--warning) / 0.12)'
      : undefined;

  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: task.id,
    data: { taskId: task.id, status: task.status },
  });

  const isHovering = isDragging || dragging;
  const cardStyle = {
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    zIndex: isDragging ? 20 : undefined,
    ...(active ? { borderInlineStart: `3px solid ${accent}` } : {}),
  };

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group w-full rounded-lg border bg-card/80 p-2.5 text-left transition-all duration-150',
        active
          ? 'border-brand-amber/40 bg-brand-amber/5 shadow-md'
          : 'border-border/50 hover:border-brand-amber/20 hover:shadow-sm',
        isHovering && 'opacity-70 scale-[0.98] cursor-grabbing',
      )}
      style={cardStyle}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{task.title}</p>
        <span
          className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold"
          style={prioColor
            ? { background: prioBg, color: prioColor }
            : { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' }
          }
        >
          P{prio}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {task.assignee && <Chip>{task.assignee}</Chip>}
        {task.tenant && <Chip>{task.tenant}</Chip>}
        {(task.skills || []).slice(0, 2).map(skill => <Chip key={skill}>{skill}</Chip>)}
      </div>
    </button>
  );
}
