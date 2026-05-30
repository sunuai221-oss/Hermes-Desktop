import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Plus, RotateCw, Search, X } from 'lucide-react';
import { Card } from '../components/Card';
import { useGatewayContext } from '../contexts/GatewayContext';
import * as api from '../api';
import { cn } from '../lib/utils';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type {
  KanbanAssignee,
  KanbanBoard,
  KanbanStats,
  KanbanStatus,
  KanbanTask,
  KanbanTaskDetail,
} from '../types';
import { Lane } from './kanban/KanbanBoard';
import { EmptyState, StatPill } from './kanban/KanbanControls';
import { TaskDetail } from './kanban/KanbanTaskDetail';
import { TaskForm } from './kanban/KanbanTaskForm';
import { ALL_LANES, LANES, countStatus, emptyForm, getErrorMessage, isKanbanStatus, splitCsv } from './kanban/kanbanUtils';

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
    showArchived ? ALL_LANES : LANES
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

    if (!isKanbanStatus(newStatus)) {
      setDraggingTaskId(null);
      return;
    }

    // Update locally
    const updatedTasks = tasks.map(t =>
      t.id === task.id ? { ...t, status: newStatus } : t
    );
    setTasks(updatedTasks);

    // Update via API based on transition
    try {
      const board = selectedBoard || undefined;
      await api.kanban.setStatus(task.id, { board, status: newStatus });
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
