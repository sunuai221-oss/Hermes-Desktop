import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  Inbox,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RotateCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Card } from '../components/Card';
import { useGatewayContext } from '../contexts/GatewayContext';
import * as api from '../api';
import { cn } from '../lib/utils';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type {
  KanbanAssignee,
  KanbanBoard,
  KanbanStats,
  KanbanStatus,
  KanbanTask,
  KanbanTaskDetail,
} from '../types';

/* ─── Hermes brand lane palette ─────────────────────────────── */
type LaneVisual = {
  status: KanbanStatus;
  label: string;
  dot: string;
  accent: string;
  accentSoft: string;
  accentFaint: string;
  accentRing: string;
};

function laneVisual(status: KanbanStatus, label: string, dot: string, token: string): LaneVisual {
  return {
    status,
    label,
    dot,
    accent: `hsl(var(${token}))`,
    accentSoft: `hsl(var(${token}) / 0.15)`,
    accentFaint: `hsl(var(${token}) / 0.08)`,
    accentRing: `hsl(var(${token}) / 0.4)`,
  };
}

const LANES: LaneVisual[] = [
  laneVisual('triage', 'Triage', 'bg-brand-amber', '--brand-amber'),
  laneVisual('todo', 'Todo', 'bg-brand-ember', '--brand-ember'),
  laneVisual('ready', 'Ready', 'bg-brand-gold', '--brand-gold'),
  laneVisual('running', 'Running', 'bg-warning', '--warning'),
  laneVisual('blocked', 'Blocked', 'bg-destructive', '--destructive'),
  laneVisual('done', 'Done', 'bg-muted-foreground', '--muted-foreground'),
];

const ARCHIVED_LANE = laneVisual('archived', 'Archived', 'bg-brand-smoke', '--brand-smoke');

/* ─── Helpers ───────────────────────────────────────────────── */
const emptyForm = {
  title: '',
  body: '',
  assignee: '',
  tenant: '',
  priority: '0',
  workspace: 'scratch',
  parents: '',
  maxRuntime: '',
  maxRetries: '',
  triage: false,
  skills: [] as string[],
};

function countStatus(stats: KanbanStats | null, status: KanbanStatus) {
  const value = stats?.by_status?.[status];
  return typeof value === 'number' ? value : 0;
}

function splitCsv(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function formatTs(value?: number | null) {
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString();
}

function formatPayload(payload: unknown) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  try { return JSON.stringify(payload); } catch { return String(payload); }
}

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { details?: string; error?: string } } }).response;
    return response?.data?.details || response?.data?.error || 'Kanban request failed';
  }
  if (error instanceof Error) return error.message;
  return 'Kanban request failed';
}

/* ─── Lane status label lookup ──────────────────────────────── */
function getLane(status: KanbanStatus) {
  return [...LANES, ARCHIVED_LANE].find(item => item.status === status) || ARCHIVED_LANE;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════ */
export function KanbanPage() {
  const gateway = useGatewayContext();

  // ── State ────────────────────────────────────────────────────
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [stats, setStats] = useState<KanbanStats | null>(null);
  const [assignees, setAssignees] = useState<KanbanAssignee[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<KanbanTaskDetail | null>(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [outcomeText, setOutcomeText] = useState('');
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const didInitialLoad = useRef(false);

  // ── Drag-and-drop setup ─────────────────────────────────────
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // ── Derived ─────────────────────────────────────────────────
  const skillNames = useMemo(
    () => gateway.skills.filter(skill => skill.enabled !== false).map(skill => skill.name).sort(),
    [gateway.skills],
  );

  const assigneeNames = useMemo(() => {
    const names = new Set<string>();
    assignees.forEach(entry => entry.name && names.add(entry.name));
    tasks.forEach(task => task.assignee && names.add(task.assignee));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [assignees, tasks]);

  const visibleLanes = useMemo(() => (
    showArchived ? [...LANES, ARCHIVED_LANE] : LANES
  ), [showArchived]);

  const filteredTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tasks
      .filter(task => showArchived || task.status !== 'archived')
      .filter(task => {
        if (!needle) return true;
        return [
          task.id, task.title, task.body, task.assignee,
          task.tenant, task.created_by,
        ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      });
  }, [search, showArchived, tasks]);

  const tasksByStatus = useMemo(() => {
    const map = new Map<KanbanStatus, KanbanTask[]>();
    for (const lane of visibleLanes) map.set(lane.status, []);
    for (const task of filteredTasks) {
      const bucket = map.get(task.status);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [filteredTasks, visibleLanes]);

  useEffect(() => {
    setAssigneeDraft(taskDetail?.task.assignee || '');
  }, [taskDetail?.task?.assignee, taskDetail?.task?.id]);

  // ── Load board ──────────────────────────────────────────────
  const loadBoard = useCallback(async (boardOverride?: string | null, silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const boardsRes = await api.kanban.boards();
      const nextBoards = Array.isArray(boardsRes.data) ? boardsRes.data : [];
      const board = boardOverride
        || selectedBoard
        || nextBoards.find(item => item.is_current)?.slug
        || nextBoards[0]?.slug
        || 'default';

      setBoards(nextBoards);
      setSelectedBoard(board);

      const [tasksRes, statsRes, assigneesRes] = await Promise.all([
        api.kanban.tasks({ board, archived: true }),
        api.kanban.stats(board),
        api.kanban.assignees(board),
      ]);
      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
      setStats(statsRes.data || null);
      setAssignees(Array.isArray(assigneesRes.data) ? assigneesRes.data : []);

      if (selectedTaskId) {
        const detailRes = await api.kanban.task(selectedTaskId, board).catch(() => null);
        setTaskDetail(detailRes?.data || null);
      }
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      if (!silent) setRefreshing(false);
      setLoading(false);
    }
  }, [selectedBoard, selectedTaskId]);

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    void loadBoard();
  }, [loadBoard]);

  // ── Actions ─────────────────────────────────────────────────
  const selectBoard = async (board: string) => {
    setSelectedBoard(board);
    setSelectedTaskId(null);
    setTaskDetail(null);
    await loadBoard(board);
  };

  const selectTask = async (task: KanbanTask) => {
    setShowForm(false);
    setSelectedTaskId(task.id);
    setDetailLoading(true);
    try {
      const { data } = await api.kanban.task(task.id, selectedBoard || undefined);
      setTaskDetail(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const resetForm = () => {
    setForm(emptyForm);
    setShowForm(false);
  };

  const createTask = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.kanban.createTask({
        board: selectedBoard || undefined,
        title: form.title.trim(),
        body: form.body.trim() || undefined,
        assignee: form.assignee || undefined,
        tenant: form.tenant.trim() || undefined,
        priority: form.priority,
        workspace: form.workspace || 'scratch',
        parents: splitCsv(form.parents),
        skills: form.skills,
        triage: form.triage,
        maxRuntime: form.maxRuntime.trim() || undefined,
        maxRetries: form.maxRetries.trim() || undefined,
      });
      resetForm();
      await loadBoard(selectedBoard, true);
      await selectTask(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const mutateSelectedTask = async (
    key: string,
    action: () => Promise<{ data: KanbanTaskDetail }>,
    options: { clearComment?: boolean; clearOutcome?: boolean } = {},
  ) => {
    if (!taskDetail) return;
    setActing(key);
    try {
      const { data } = await action();
      setTaskDetail(data);
      if (options.clearComment) setCommentText('');
      if (options.clearOutcome) setOutcomeText('');
      await loadBoard(selectedBoard, true);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActing(null);
    }
  };

  /* ─── Drag-and-drop: move task status ─────────────────────── */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDraggingTaskId(null);
      return;
    }

    const task = tasks.find(t => t.id === String(active.id));
    const newStatus = String(over.data.current?.status || over.id);
    if (!task || task.status === newStatus) {
      setDraggingTaskId(null);
      return;
    }

    const validStatuses: KanbanStatus[] = ['triage', 'todo', 'ready', 'running', 'blocked', 'done', 'archived'];
    if (!validStatuses.includes(newStatus as KanbanStatus)) {
      setDraggingTaskId(null);
      return;
    }

    // Update locally
    const updatedTasks = tasks.map(t =>
      t.id === task.id ? { ...t, status: newStatus as KanbanStatus } : t
    );
    setTasks(updatedTasks);

    // Update via API based on transition
    try {
      const board = selectedBoard || undefined;
      await api.kanban.setStatus(task.id, { board, status: newStatus as KanbanStatus });
      await loadBoard(selectedBoard, true);
    } catch (err) {
      // Revert on error
      setTasks(tasks);
      setError(getErrorMessage(err));
    }

    setDraggingTaskId(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingTaskId(String(event.active.id));
  };

  const selectedTask = taskDetail?.task || tasks.find(task => task.id === selectedTaskId) || null;
  const currentBoard = boards.find(board => board.slug === selectedBoard) || null;
  const totalOpen = tasks.filter(task => !['done', 'archived'].includes(task.status)).length;

  // ─── Render ──────────────────────────────────────────────────
  return (
    <motion.div
      key="kanban"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-[1600px] space-y-4"
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            <span className="text-brand-amber">Kanban</span>{' '}Board
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {currentBoard?.name || selectedBoard || 'default'}
            {' · '}{totalOpen} open
            {' · '}{tasks.length} total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedBoard || ''}
            onChange={event => void selectBoard(event.target.value)}
            className="min-h-10 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
          >
            {boards.length === 0 ? <option value="default">default</option> : boards.map(board => (
              <option key={board.slug} value={board.slug}>{board.name || board.slug}</option>
            ))}
          </select>
          <button
            onClick={() => setShowArchived(v => !v)}
            className={cn(
              'min-h-10 rounded-lg border px-3 py-2 text-sm',
              showArchived
                ? 'border-brand-amber/25 bg-brand-amber/10 text-brand-amber'
                : 'border-border bg-muted/60 text-muted-foreground',
            )}
          >
            Archived
          </button>
          <button
            onClick={() => void loadBoard(selectedBoard)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm"
          >
            <RotateCw size={14} className={cn(refreshing && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={() => { setSelectedTaskId(null); setTaskDetail(null); setShowForm(true); }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-brand-amber px-3 py-2 text-sm font-medium text-white hover:bg-brand-amber/90"
          >
            <Plus size={14} />
            New
          </button>
        </div>
      </div>

      {/* ── Error banner ───────────────────────────────────── */}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="rounded p-0.5 hover:bg-destructive/10">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Stats pills ────────────────────────────────────── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {visibleLanes.map(lane => (
          <StatPill key={lane.status} lane={lane} value={countStatus(stats, lane.status)} />
        ))}
      </div>

      {/* ── Search ─────────────────────────────────────────── */}
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
        <input
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search by title, assignee, ID..."
          className="h-9 w-full rounded-lg border border-border/60 bg-card/60 pl-10 pr-4 text-sm backdrop-blur-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-brand-amber/30 transition-all"
        />
      </div>

      {/* ── Board + Detail sidebar ─────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Board lanes */}
        <section className="min-w-0">
          {loading ? (
            <div className="flex min-h-[400px] items-center justify-center rounded-xl border border-border bg-card">
              <Loader2 className="h-8 w-8 animate-spin text-brand-amber" />
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              {/* Lanes — flex layout, no forced grid */}
              <div className="flex gap-3 min-h-[400px] max-h-[60vh] overflow-x-auto pb-2">
                {visibleLanes.map(lane => (
                  <Lane
                    key={lane.status}
                    lane={lane}
                    tasks={tasksByStatus.get(lane.status) || []}
                    selectedTaskId={selectedTaskId}
                    draggingTaskId={draggingTaskId}
                    onSelect={selectTask}
                  />
                ))}
              </div>
            </DndContext>
          )}
        </section>

        {/* Detail sidebar */}
        <aside className="min-w-0">
          <Card className="min-h-[480px] overflow-hidden">
            <div className="h-0.5 w-full bg-gradient-to-r from-brand-amber via-brand-amber/40 to-transparent" />
            <div className="p-4 max-h-[calc(100vh-200px)] overflow-y-auto">
              {/* ── New Task Modal ─────────────────────────── */}
              <AnimatePresence>
                {showForm && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}
                  >
                    <motion.div
                      initial={{ scale: 0.95, y: 10 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0.95, y: 10 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-border/60 bg-card shadow-2xl"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/40 bg-card/95 px-5 py-3 backdrop-blur-sm">
                        <h3 className="text-lg font-bold">
                          <span className="text-brand-amber">New</span> task
                        </h3>
                        <button
                          onClick={resetForm}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="p-5">
                        <TaskForm
                          form={form}
                          assigneeNames={assigneeNames}
                          skillNames={skillNames}
                          saving={saving}
                          onCancel={resetForm}
                          onChange={setForm}
                          onSubmit={createTask}
                        />
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Detail / Empty state ───────────────────── */}
              {!showForm && (
                <div>
                  {detailLoading ? (
                    <div className="flex h-[400px] items-center justify-center">
                      <Loader2 className="h-7 w-7 animate-spin text-brand-amber" />
                    </div>
                  ) : selectedTask ? (
                    <TaskDetail
                      detail={taskDetail}
                      task={selectedTask}
                      assigneeNames={assigneeNames}
                      assigneeDraft={assigneeDraft}
                      setAssigneeDraft={setAssigneeDraft}
                      commentText={commentText}
                      setCommentText={setCommentText}
                      outcomeText={outcomeText}
                      setOutcomeText={setOutcomeText}
                      acting={acting}
                      onAssign={() => mutateSelectedTask('assign', () => api.kanban.assign(selectedTask!.id, { board: selectedBoard || undefined, assignee: assigneeDraft }))}
                      onComment={() => mutateSelectedTask('comment', () => api.kanban.comment(selectedTask!.id, { board: selectedBoard || undefined, text: commentText }), { clearComment: true })}
                      onComplete={() => mutateSelectedTask('complete', () => api.kanban.complete(selectedTask!.id, { board: selectedBoard || undefined, result: outcomeText, summary: outcomeText }), { clearOutcome: true })}
                      onBlock={() => mutateSelectedTask('block', () => api.kanban.block(selectedTask!.id, { board: selectedBoard || undefined, reason: outcomeText }), { clearOutcome: true })}
                      onUnblock={() => mutateSelectedTask('unblock', () => api.kanban.unblock(selectedTask!.id, { board: selectedBoard || undefined }))}
                      onArchive={() => mutateSelectedTask('archive', () => api.kanban.archive(selectedTask!.id, { board: selectedBoard || undefined }))}
                      onReclaim={() => mutateSelectedTask('reclaim', () => api.kanban.reclaim(selectedTask!.id, { board: selectedBoard || undefined, reason: outcomeText || 'reclaimed from Hermes Desktop' }), { clearOutcome: true })}
                    />
                  ) : (
                    <EmptyState />
                  )}
                </div>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LANE — Draggable column
   ═══════════════════════════════════════════════════════════════ */
function Lane({ lane, tasks, selectedTaskId, draggingTaskId, onSelect }: {
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
      {/* Lane accent bar */}
      <div
        className="h-0.5 w-full shrink-0"
        style={{ background: `linear-gradient(90deg, ${lane.accent}, ${lane.accentRing})` }}
      />
      {/* Lane header */}
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
      {/* Task list */}
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

/* ═══════════════════════════════════════════════════════════════
   TASK CARD — Draggable
   ═══════════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════════
   TASK FORM
   ═══════════════════════════════════════════════════════════════ */
function TaskForm({ form, assigneeNames, skillNames, saving, onCancel, onChange, onSubmit }: {
  form: typeof emptyForm;
  assigneeNames: string[];
  skillNames: string[];
  saving: boolean;
  onCancel: () => void;
  onChange: (form: typeof emptyForm) => void;
  onSubmit: () => void;
}) {
  const toggleSkill = (skill: string) => {
    onChange({
      ...form,
      skills: form.skills.includes(skill)
        ? form.skills.filter(item => item !== skill)
        : [...form.skills, skill],
    });
  };

  const isTriage = form.triage;

  return (
    <div className="space-y-4">
      <Field label="Title *" value={form.title} onChange={value => onChange({ ...form, title: value })} required />
      <TextArea label="Body" value={form.body} onChange={value => onChange({ ...form, body: value })} />

      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Assignee" value={form.assignee} onChange={value => onChange({ ...form, assignee: value })} options={assigneeNames} emptyLabel="Unassigned" />
        <SelectField label="Priority" value={form.priority} onChange={value => onChange({ ...form, priority: value })} options={['0', '1', '2', '3']} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tenant" value={form.tenant} onChange={value => onChange({ ...form, tenant: value })} />
        <SelectField
          label="Workspace"
          value={form.workspace}
          onChange={value => onChange({ ...form, workspace: value })}
          options={['scratch', 'worktree']}
        />
      </div>

      <Field label="Parents" value={form.parents} onChange={value => onChange({ ...form, parents: value })} placeholder="task ids, comma-separated" />

      <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={form.triage}
          onChange={event => onChange({ ...form, triage: event.target.checked })}
          className="h-4 w-4 accent-brand-amber"
        />
        Triage (agent-executable task)
      </label>

      {isTriage && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="grid grid-cols-2 gap-3"
        >
          <Field label="Max runtime" value={form.maxRuntime} onChange={value => onChange({ ...form, maxRuntime: value })} placeholder="30m" />
          <Field label="Max retries" value={form.maxRetries} onChange={value => onChange({ ...form, maxRetries: value })} placeholder="3" />
        </motion.div>
      )}

      {skillNames.length > 0 && (
        <div>
          <label className="mb-2 block text-xs text-muted-foreground">Skills</label>
          <div className="max-h-[120px] overflow-y-auto">
            <div className="flex flex-wrap gap-1.5">
              {skillNames.map(skill => (
                <button
                  key={skill}
                  type="button"
                  onClick={() => toggleSkill(skill)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    form.skills.includes(skill)
                      ? 'border-brand-amber/25 bg-brand-amber/10 text-brand-amber font-medium'
                      : 'border-border/60 bg-muted/60 text-muted-foreground hover:border-brand-amber/20',
                  )}
                >
                  {skill}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/60 px-4 py-2.5 text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={saving || !form.title.trim()}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-amber px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-amber/90 disabled:opacity-40"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Create task
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TASK DETAIL — Tabbed layout
   ═══════════════════════════════════════════════════════════════ */
type DetailTab = 'overview' | 'actions' | 'history';

function TaskDetail({
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
      {/* ── Task header (always visible) ──────────────────── */}
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

      {/* ── Tab bar ──────────────────────────────────────── */}
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

      {/* ── Tab content ──────────────────────────────────── */}
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
          {/* Assignee */}
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

          {/* Outcome + Action buttons */}
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

          {/* Comment */}
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

/* ═══════════════════════════════════════════════════════════════
   SMALL COMPONENTS
   ═══════════════════════════════════════════════════════════════ */
function StatPill({ lane, value }: { lane: LaneVisual; value: number }) {
  return (
    <div
      className="shrink-0 rounded-lg border border-border/50 bg-card/60 px-3 py-2 cursor-default"
      style={{ boxShadow: `0 0 16px ${lane.accentFaint}, 0 1px 2px rgba(0,0,0,0.04)` }}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', lane.dot)} style={{ boxShadow: `0 0 5px ${lane.accentRing}` }} />
        <span className="truncate text-[10px] font-medium text-muted-foreground">{lane.label}</span>
      </div>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: KanbanStatus }) {
  const lane = getLane(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{ borderColor: lane.accentSoft, background: lane.accentFaint, color: lane.accent }}
    >
      <span className={cn('h-2 w-2 rounded-full', lane.dot)} />
      {lane.label}
    </span>
  );
}

function Field({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder || label}
        className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options, emptyLabel }: {
  label: string; value: string; onChange: (value: string) => void; options: string[]; emptyLabel?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder, compact }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; compact?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder || label}
        className={cn(
          'w-full resize-y rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30',
          compact ? 'min-h-[72px]' : 'min-h-[100px]',
        )}
      />
    </label>
  );
}

function ActionButton({ icon: Icon, label, loading, disabled, danger, onClick }: {
  icon: typeof Check; label: string; loading?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-[34px] items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40 transition-colors',
        danger
          ? 'border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20'
          : 'border-border/50 bg-muted/40 hover:bg-muted/60',
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {label}
    </button>
  );
}

function IconButton({ icon: Icon, label, loading, disabled, onClick }: {
  icon: typeof Save; label: string; loading?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber text-white disabled:opacity-40 hover:bg-brand-amber/90"
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/60">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium">{value}</p>
    </div>
  );
}

function TokenList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {values.map(value => <Chip key={value}>{value}</Chip>)}
      </div>
    </div>
  );
}

function HistoryBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="max-w-full truncate rounded-full bg-muted/50 px-2 py-0.5 text-[9px] text-muted-foreground">
      {children}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[360px] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-2xl bg-muted/30 p-4">
        <Inbox size={28} className="text-muted-foreground/25" />
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground/60">No task selected</p>
        <p className="mt-1 text-xs text-muted-foreground/35">Click a card or create a new task</p>
      </div>
    </div>
  );
}
