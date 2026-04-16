import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { CronJob, CronOutputEntry } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';

const emptyForm = {
  name: '',
  prompt: '',
  schedule: 'every 1h',
  delivery: 'local',
  repeat: '',
  skills: [] as string[],
};

export function AutomationsPage() {
  const gateway = useGatewayContext();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [outputs, setOutputs] = useState<CronOutputEntry[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    const [jobsRes, outputsRes] = await Promise.all([
      api.cronjobs.list().catch(() => ({ data: [] })),
      api.cronjobs.outputs().catch(() => ({ data: [] })),
    ]);
    const nextJobs = Array.isArray(jobsRes.data) ? jobsRes.data : [];
    setJobs(nextJobs.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()));
    setOutputs(Array.isArray(outputsRes.data) ? outputsRes.data : []);
    if (!silent) setRefreshing(false);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => { void load(true); }, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  // Close kebab menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedJob = jobs.find(j => j.id === selectedJobId) || null;
  const selectedOutputs = useMemo(
    () => outputs.filter(o => o.jobId === selectedJobId).slice(0, 20),
    [outputs, selectedJobId],
  );
  const activeCount = jobs.filter(j => !j.paused).length;

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setFormError(null);
    setShowForm(false);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (job: CronJob) => {
    setEditingId(job.id);
    setForm({
      name: job.name || '',
      prompt: job.prompt || '',
      schedule: job.schedule || '',
      delivery: job.delivery || 'local',
      repeat: job.repeat == null ? '' : String(job.repeat),
      skills: job.skills || [],
    });
    setFormError(null);
    setShowForm(true);
    setSelectedJobId(job.id);
    setOpenMenuId(null);
  };

  const submit = async () => {
    if (!form.prompt.trim() || !form.schedule.trim()) return;
    if (!isSupportedSchedule(form.schedule)) {
      setFormError('Invalid format. Use: 15m, 2h, 1d, every 30m, or an ISO date.');
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        schedule: form.schedule.trim(),
        delivery: form.delivery,
        repeat: form.repeat === '' ? null : parseInt(form.repeat, 10) || null,
        skills: form.skills,
      };
      if (editingId) {
        await api.cronjobs.update(editingId, payload);
      } else {
        await api.cronjobs.create(payload);
      }
      await load();
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const lifecycleAction = async (jobId: string, action: 'pause' | 'resume' | 'run' | 'remove') => {
    setActingId(jobId);
    setOpenMenuId(null);
    try {
      await api.cronjobs.action(jobId, action);
      await load();
      if (action === 'remove' && selectedJobId === jobId) {
        setSelectedJobId(null);
        resetForm();
      }
    } finally {
      setActingId(null);
    }
  };

  const toggleSkill = (skillName: string) => {
    setForm(current => ({
      ...current,
      skills: current.skills.includes(skillName)
        ? current.skills.filter(s => s !== skillName)
        : [...current.skills, skillName],
    }));
  };

  return (
    <motion.div
      key="automations"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold">
            Scheduled <span className="text-primary">Tasks</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {jobs.length} job{jobs.length !== 1 ? 's' : ''} · {activeCount} active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(c => !c)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              autoRefresh ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </button>
          <button onClick={() => void load()} className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
            <RotateCw size={14} className={cn('mr-1 inline', refreshing && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus size={14} />
            New
          </button>
        </div>
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-6">
        {/* Job list */}
        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center p-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="py-16 text-center text-sm italic text-muted-foreground">No cron job detected.</p>
          ) : (
            <div className="divide-y divide-border">
              {jobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => {
                    setSelectedJobId(job.id === selectedJobId ? null : job.id);
                    if (job.id !== selectedJobId) { resetForm(); setOutputsOpen(false); }
                  }}
                  className={cn(
                    'w-full text-left p-4 transition-colors',
                    selectedJobId === job.id ? 'bg-primary/5' : 'hover:bg-muted/50',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            'h-2.5 w-2.5 rounded-full shrink-0',
                            job.paused ? 'bg-amber-500' : 'bg-green-500',
                          )}
                        />
                        <p className="font-semibold text-sm truncate">{job.name || job.id}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground pl-5">{job.schedule}</p>
                    </div>
                    <div className="relative shrink-0" ref={openMenuId === job.id ? menuRef : undefined}>
                      <button
                        onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === job.id ? null : job.id); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenuId === job.id && (
                        <div className="absolute right-0 top-full mt-1 z-20 w-40 rounded-lg border border-border bg-popover shadow-lg py-1">
                          <MenuAction icon={Pencil} label="Edit" onClick={e => { e.stopPropagation(); openEdit(job); }} />
                          {job.paused ? (
                            <MenuAction icon={Play} label="Resume" onClick={e => { e.stopPropagation(); lifecycleAction(job.id, 'resume'); }} disabled={actingId === job.id} />
                          ) : (
                            <MenuAction icon={Pause} label="Pause" onClick={e => { e.stopPropagation(); lifecycleAction(job.id, 'pause'); }} disabled={actingId === job.id} />
                          )}
                          <MenuAction icon={Send} label="Run now" onClick={e => { e.stopPropagation(); lifecycleAction(job.id, 'run'); }} disabled={actingId === job.id} />
                          <div className="border-t border-border my-1" />
                          <MenuAction icon={Trash2} label="Remove" danger onClick={e => { e.stopPropagation(); lifecycleAction(job.id, 'remove'); }} disabled={actingId === job.id} />
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Detail / Edit panel */}
        <Card className="p-6">
          {showForm ? (
            /* === Create / Edit form === */
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">{editingId ? 'Edit job' : 'Create job'}</h3>
                <button onClick={resetForm} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                <Field label="Name" value={form.name} onChange={v => setForm(c => ({ ...c, name: v }))} placeholder="Morning feeds" />
                <Field label="Schedule" value={form.schedule} onChange={v => setForm(c => ({ ...c, schedule: v }))} placeholder="every 1h | 30m | 2026-03-15T09:00:00" />
                <Field label="Delivery" value={form.delivery} onChange={v => setForm(c => ({ ...c, delivery: v }))} placeholder="local | origin | telegram | discord:123" />
                <Field label="Repeat" value={form.repeat} onChange={v => setForm(c => ({ ...c, repeat: v }))} placeholder="empty = Hermes default" />
                {formError && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-destructive">{formError}</div>
                )}
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">Prompt</label>
                  <textarea
                    value={form.prompt}
                    onChange={e => setForm(c => ({ ...c, prompt: e.target.value }))}
                    placeholder="Check server status and summarize anomalies."
                    className="min-h-[140px] w-full resize-y rounded-lg border border-border bg-muted px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs text-muted-foreground">Attached skills</label>
                  <div className="flex flex-wrap gap-2">
                    {gateway.skills.length === 0 ? (
                      <p className="text-sm italic text-muted-foreground">No skill installed.</p>
                    ) : (
                      gateway.skills.map(skill => (
                        <button
                          key={skill.name}
                          onClick={() => toggleSkill(skill.name)}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-xs transition-all',
                            form.skills.includes(skill.name)
                              ? 'border-primary/20 bg-primary/15 text-primary'
                              : 'border-border bg-muted text-muted-foreground',
                          )}
                        >
                          {skill.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <button
                  onClick={submit}
                  disabled={saving || !form.prompt.trim() || !form.schedule.trim()}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  {saving ? (
                    <><Loader2 size={14} className="mr-1 inline animate-spin" />Saving...</>
                  ) : (
                    <><Save size={14} className="mr-1 inline" />{editingId ? 'Update job' : 'Create job'}</>
                  )}
                </button>
              </div>
            </div>
          ) : selectedJob ? (
            /* === Job detail === */
            <div>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className={cn('h-3 w-3 rounded-full', selectedJob.paused ? 'bg-amber-500' : 'bg-green-500')} />
                    <h3 className="text-lg font-bold">{selectedJob.name || selectedJob.id}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{selectedJob.id}</p>
                </div>
              </div>

              <div className="space-y-4">
                <DetailRow label="Schedule" value={selectedJob.schedule} />
                <DetailRow label="Delivery" value={selectedJob.delivery || 'local'} />
                {selectedJob.repeat != null && <DetailRow label="Repeat" value={String(selectedJob.repeat)} />}

                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Prompt</p>
                  <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm whitespace-pre-wrap">{selectedJob.prompt}</div>
                </div>

                {(selectedJob.skills || []).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Skills</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedJob.skills!.map(skill => (
                        <span key={skill} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{skill}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground/70 space-y-0.5 pt-2 border-t border-border">
                  {selectedJob.next_run_at && <p>Next run: {new Date(selectedJob.next_run_at).toLocaleString()}</p>}
                  {selectedJob.last_run_at && <p>Last run: {new Date(selectedJob.last_run_at).toLocaleString()}</p>}
                  {selectedJob.created_at && <p>Created: {new Date(selectedJob.created_at).toLocaleString()}</p>}
                </div>

                {/* Outputs accordion */}
                {selectedOutputs.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <button
                      onClick={() => setOutputsOpen(o => !o)}
                      className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                    >
                      {outputsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Outputs ({selectedOutputs.length})
                    </button>
                    {outputsOpen && (
                      <div className="mt-3 space-y-3">
                        {selectedOutputs.map(output => (
                          <div key={output.path} className="rounded-lg border border-border bg-muted/50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-semibold truncate">{output.fileName}</p>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {new Date(output.modifiedAt).toLocaleString()}
                              </span>
                            </div>
                            <pre className="mt-2 max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2.5 text-[11px] text-muted-foreground">
                              {output.contentPreview}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-12 text-center">
              Select a job to view details, or create a new one.
            </p>
          )}
        </Card>
      </div>
    </motion.div>
  );
}

/* ── helpers ───────────────────────────────────── */

function isSupportedSchedule(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (/^(\d+)(m|h|d)$/i.test(trimmed)) return true;
  if (/^every\s+(\d+)(m|h|d)$/i.test(trimmed)) return true;
  const date = new Date(trimmed);
  return !Number.isNaN(date.getTime());
}

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-muted px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function MenuAction({ icon: Icon, label, onClick, disabled, danger }: {
  icon: typeof Pencil; label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors',
        danger
          ? 'text-destructive hover:bg-red-500/10'
          : 'text-foreground hover:bg-muted',
        disabled && 'opacity-40',
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}
