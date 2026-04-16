import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Search, MoreHorizontal, Plus, Trash2, Loader2,
  Play, MessageSquare, Pencil, Check, X, Download, Scissors,
  ArrowRight,
} from 'lucide-react';
import { Card } from '../components/Card';
import { PlatformIcon } from '../components/PlatformIcon';
import { useFeedback } from '../contexts/FeedbackContext';
import * as api from '../api';
import { cn, formatRelativeTime, parsePlatformFromKey } from '../lib/utils';
import type { NavItem, SessionEntry } from '../types';

interface Props {
  onNavigate: (item: NavItem) => void;
  onOpenSessionInChat: (sessionId: string | null) => void;
}

export function SessionsPage({ onNavigate, onOpenSessionInChat }: Props) {
  const [sessions, setSessions] = useState<Record<string, SessionEntry> | null>(null);
  const [stats, setStats] = useState<{ total_sessions: number; total_messages: number; database_size_bytes: number } | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const { notify, confirm, prompt } = useFeedback();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await api.sessions.list();
      setSessions(res.data);
    } catch { setSessions({}); }
  };

  const fetchStats = async () => {
    try {
      const res = await api.sessions.stats();
      setStats(res.data || null);
    } catch { setStats(null); }
  };

  useEffect(() => { fetchSessions(); fetchStats(); }, []);

  const handleCreate = async () => {
    setIsProcessing(true);
    try { await api.sessions.create(); await fetchSessions(); await fetchStats(); }
    catch (err) { console.error(err); }
    finally { setIsProcessing(false); }
  };

  const handleDelete = async (id: string) => {
    setOpenMenuId(null);
    const approved = await confirm({ title: 'Delete session', message: 'This action is permanent.', confirmLabel: 'Delete', danger: true });
    if (!approved) return;
    setIsProcessing(true);
    try {
      await api.sessions.delete(id);
      await fetchSessions(); await fetchStats();
      notify({ tone: 'success', message: 'Session deleted.' });
    } catch { notify({ tone: 'error', message: 'Could not delete.' }); }
    finally { setIsProcessing(false); }
  };

  const handleRename = async (id: string) => {
    const title = renameValue.trim();
    if (!title) return;
    setIsProcessing(true);
    try {
      await api.sessions.rename(id, title);
      setRenamingId(null);
      await fetchSessions();
      notify({ tone: 'success', message: 'Renamed.' });
    } catch { notify({ tone: 'error', message: 'Could not rename.' }); }
    finally { setIsProcessing(false); }
  };

  const handleResume = async (id: string) => {
    setOpenMenuId(null);
    setResumingId(id);
    try {
      await api.sessions.resume({ mode: 'resume', value: id });
      await fetchSessions();
      notify({ tone: 'success', message: 'Resume summary generated.' });
    } catch { notify({ tone: 'error', message: 'Resume failed.' }); }
    finally { setResumingId(null); }
  };

  const handleExport = async () => {
    try {
      const res = await api.sessions.export(sourceFilter !== 'all' ? { source: sourceFilter } : {});
      const lines: string[] = Array.isArray(res.data?.items) ? res.data.items : [];
      const blob = new Blob([`${lines.join('\n')}\n`], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `hermes-sessions-${Date.now()}.jsonl`; a.click();
      URL.revokeObjectURL(url);
      notify({ tone: 'success', message: 'Exported.' });
    } catch { notify({ tone: 'error', message: 'Export failed.' }); }
  };

  const handlePrune = async () => {
    const daysRaw = await prompt({ title: 'Prune sessions', message: 'Delete sessions older than how many days?', label: 'Days', defaultValue: '90', confirmLabel: 'Prune', validate: v => { const d = parseInt(v, 10); return Number.isFinite(d) && d > 0 ? null : 'Enter a valid number.'; } });
    if (!daysRaw) return;
    const days = Math.max(1, parseInt(daysRaw, 10) || 90);
    const approved = await confirm({ title: 'Confirm prune', message: `Delete sessions older than ${days} days?`, confirmLabel: 'Prune', danger: true });
    if (!approved) return;
    try {
      await api.sessions.prune({ older_than_days: days, source: sourceFilter !== 'all' ? sourceFilter : undefined });
      await fetchSessions(); await fetchStats();
      notify({ tone: 'success', message: `Pruned (> ${days} days).` });
    } catch { notify({ tone: 'error', message: 'Prune failed.' }); }
  };

  const entries = useMemo(() => (
    sessions
      ? Object.entries(sessions).filter(([, s]) => {
          const src = String(s.source || '').toLowerCase();
          const title = String(s.title || '').toLowerCase();
          const srcMatch = sourceFilter === 'all' || src === sourceFilter.toLowerCase();
          const textMatch = !search || title.includes(search.toLowerCase());
          return srcMatch && textMatch;
        }).sort((a, b) => (b[1].last_accessed || 0) - (a[1].last_accessed || 0))
      : []
  ), [sessions, search, sourceFilter]);

  const availableSources = useMemo(() => {
    if (!sessions) return [];
    const set = new Set<string>();
    for (const [id, s] of Object.entries(sessions)) set.add(String(s.source || parsePlatformFromKey(id) || 'unknown'));
    return Array.from(set).sort();
  }, [sessions]);

  return (
    <motion.div key="sessions" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Sessions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {entries.length} active{stats && ` · ${stats.total_sessions} total · ${formatBytes(stats.database_size_bytes)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="w-44 rounded-lg border border-border/60 bg-muted/40 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm focus:outline-none" title="Source filter">
            <option value="all">All</option>
            {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={handleCreate} disabled={isProcessing} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            New
          </button>
          <div className="relative" ref={openMenuId === '__header__' ? menuRef : undefined}>
            <button onClick={() => setOpenMenuId(v => v === '__header__' ? null : '__header__')} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <MoreHorizontal size={16} />
            </button>
            {openMenuId === '__header__' && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg py-1 z-50">
                <MenuButton icon={<Download size={13} />} label="Export" onClick={() => { setOpenMenuId(null); handleExport(); }} />
                <MenuButton icon={<Scissors size={13} />} label="Prune old…" onClick={() => { setOpenMenuId(null); handlePrune(); }} danger />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Session list */}
      <Card className="overflow-hidden">
        {!sessions ? (
          <div className="flex items-center justify-center p-16"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground/50">No sessions found.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {entries.map(([id, sess]) => {
              const platform = parsePlatformFromKey(id);
              const isRecent = (sess.last_accessed || 0) > Date.now() / 1000 - 86400;
              const isRenaming = renamingId === id;

              return (
                <div key={id} className={cn('group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30', isRecent && 'bg-primary/[0.02]')}>
                  <PlatformIcon name={platform} size={15} />

                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5">
                        <input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRename(id)} onClick={e => e.stopPropagation()} autoFocus className="w-48 rounded border border-border bg-background px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <button onClick={() => handleRename(id)} className="text-primary"><Check size={13} /></button>
                        <button onClick={() => setRenamingId(null)} className="text-muted-foreground"><X size={13} /></button>
                      </div>
                    ) : (
                      <button onClick={() => { onOpenSessionInChat(id); onNavigate('chat'); }} className="text-left group/title">
                        <p className="text-sm font-medium text-foreground truncate group-hover/title:text-primary transition-colors">{sess.title || id.split(':').slice(-2).join(':')}</p>
                      </button>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">{sess.source || platform}</span>
                      <span className="text-[11px] text-muted-foreground/40">·</span>
                      <span className="text-[11px] font-mono text-muted-foreground/60">{sess.model || 'default'}</span>
                      {isRecent && <span className="w-1.5 h-1.5 rounded-full bg-success/60" title="Active recently" />}
                    </div>
                  </div>

                  <span className="text-[11px] text-muted-foreground/50 flex-shrink-0 tabular-nums">
                    {sess.last_accessed ? formatRelativeTime(sess.last_accessed) : '—'}
                  </span>

                  {/* Row actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { onOpenSessionInChat(id); onNavigate('chat'); }} className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors" title="Open">
                      <ArrowRight size={13} />
                    </button>
                    <div className="relative" ref={openMenuId === id ? menuRef : undefined}>
                      <button onClick={() => setOpenMenuId(v => v === id ? null : id)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <MoreHorizontal size={13} />
                      </button>
                      {openMenuId === id && (
                        <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg py-1 z-50">
                          <MenuButton icon={<MessageSquare size={13} />} label="Open in Chat" onClick={() => { setOpenMenuId(null); onOpenSessionInChat(id); onNavigate('chat'); }} />
                          <MenuButton icon={resumingId === id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} label="Resume" onClick={() => handleResume(id)} />
                          <MenuButton icon={<Pencil size={13} />} label="Rename" onClick={() => { setOpenMenuId(null); setRenamingId(id); setRenameValue(String(sess.title || '')); }} />
                          <div className="my-1 border-t border-border/40" />
                          <MenuButton icon={<Trash2 size={13} />} label="Delete" onClick={() => handleDelete(id)} danger />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function MenuButton({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors', danger ? 'text-destructive hover:bg-destructive/5' : 'text-foreground hover:bg-muted')}>
      {icon}
      {label}
    </button>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}
