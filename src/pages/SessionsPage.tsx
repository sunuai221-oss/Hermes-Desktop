import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Search, MoreHorizontal, Plus, Trash2, Loader2,
  MessageSquare, Pencil, Check, X, Download, Scissors, Sparkles,
  ArrowRight,
} from 'lucide-react';
import { Card } from '../components/Card';
import { PlatformIcon } from '../components/PlatformIcon';
import { useFeedback } from '../contexts/FeedbackContext';
import { useSessions } from '../features/sessions/SessionsContext';
import { formatSessionSourceLabel } from '../features/sessions/sessionPresentation';
import * as api from '../api';
import { cn, formatBytes, formatRelativeTime, normalizeUnixTimestampSeconds, parsePlatformFromKey } from '../lib/utils';

interface Props {
  onOpenSessionInChat: (sessionId: string | null) => void;
}

export function SessionsPage({ onOpenSessionInChat }: Props) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [workspaceFilter, setWorkspaceFilter] = useState<string>('all');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const sessionStore = useSessions();
  const { notify, confirm, prompt } = useFeedback();
  const menuRef = useRef<HTMLDivElement>(null);
  const sessions = sessionStore.isLoading ? null : sessionStore.sessions;
  const stats = sessionStore.stats;

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

  const handleCreate = async () => {
    setIsProcessing(true);
    try { await sessionStore.createSession(); }
    catch (err) { console.error(err); }
    finally { setIsProcessing(false); }
  };

  const handleDelete = async (id: string) => {
    setOpenMenuId(null);
    const approved = await confirm({ title: 'Delete session', message: 'This action is permanent.', confirmLabel: 'Delete', danger: true });
    if (!approved) return;
    setIsProcessing(true);
    try {
      await sessionStore.deleteSession(id);
      notify({ tone: 'success', message: 'Session deleted.' });
    } catch { notify({ tone: 'error', message: 'Could not delete.' }); }
    finally { setIsProcessing(false); }
  };

  const handleRename = async (id: string) => {
    const title = renameValue.trim();
    if (!title) return;
    setIsProcessing(true);
    try {
      await sessionStore.renameSession(id, title);
      setRenamingId(null);
      notify({ tone: 'success', message: 'Renamed.' });
    } catch { notify({ tone: 'error', message: 'Could not rename.' }); }
    finally { setIsProcessing(false); }
  };

  const handleResume = async (id: string) => {
    setOpenMenuId(null);
    setResumingId(id);
    try {
      const result = await sessionStore.resumeSession({ mode: 'resume', value: id });
      const exchangeCount = result?.recap?.exchanges?.length || 0;
      notify({
        tone: 'success',
        message: exchangeCount > 0 ? `Recap generated (${exchangeCount} exchange${exchangeCount === 1 ? '' : 's'}).` : 'Recap generated.',
      });
    } catch { notify({ tone: 'error', message: 'Recap failed.' }); }
    finally { setResumingId(null); }
  };

  const handleExport = async () => {
    try {
      const res = await api.sessions.export({
        ...(sourceFilter !== 'all' ? { source: sourceFilter } : {}),
        ...(workspaceFilter !== 'all' ? { workspace_id: workspaceFilter } : {}),
      });
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
      await sessionStore.pruneSessions({ older_than_days: days, source: sourceFilter !== 'all' ? sourceFilter : undefined });
      notify({ tone: 'success', message: `Pruned (> ${days} days).` });
    } catch { notify({ tone: 'error', message: 'Prune failed.' }); }
  };

  const entries = useMemo(() => (
    sessions
      ? Object.entries(sessions).filter(([, s]) => {
          const src = String(s.source || '').toLowerCase();
          const title = String(s.title || '').toLowerCase();
          const workspaceId = String(s.workspace_id || '');
          const workspaceName = String(s.workspace_name || '').toLowerCase();
          const srcMatch = sourceFilter === 'all' || src === sourceFilter.toLowerCase();
          const workspaceMatch = workspaceFilter === 'all' || workspaceId === workspaceFilter;
          const text = search.toLowerCase();
          const textMatch = !text || title.includes(text) || workspaceName.includes(text);
          return srcMatch && workspaceMatch && textMatch;
        }).sort((a, b) => normalizeUnixTimestampSeconds(b[1].last_accessed) - normalizeUnixTimestampSeconds(a[1].last_accessed))
      : []
  ), [sessions, search, sourceFilter, workspaceFilter]);

  const availableSources = useMemo(() => {
    if (!sessions) return [];
    const set = new Set<string>();
    for (const [id, s] of Object.entries(sessions)) set.add(String(s.source || parsePlatformFromKey(id) || 'unknown'));
    return Array.from(set).sort((left, right) => (
      formatSessionSourceLabel(left).localeCompare(formatSessionSourceLabel(right), undefined, { sensitivity: 'base' })
    ));
  }, [sessions]);

  const availableWorkspaces = useMemo(() => {
    if (!sessions) return [];
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const session of Object.values(sessions)) {
      const id = String(session.workspace_id || '').trim();
      if (!id) continue;
      const name = String(session.workspace_name || id).trim() || id;
      const existing = map.get(id);
      map.set(id, { id, name, count: (existing?.count || 0) + 1 });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }, [sessions]);

  const workspaceLinkedCount = useMemo(
    () => (sessions ? Object.values(sessions).filter(session => session.workspace_id).length : 0),
    [sessions],
  );

  return (
    <motion.div key="sessions" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Sessions</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {entries.length} active{stats && ` · ${stats.total_sessions} total · ${formatBytes(stats.database_size_bytes)}`}
            {workspaceLinkedCount > 0 && ` · ${workspaceLinkedCount} workspace-linked`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sessions or workspaces…" className="w-56 rounded-lg border border-border/60 bg-muted/40 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm focus:outline-none" title="Source filter">
            <option value="all">All</option>
            {availableSources.map(source => (
              <option key={source} value={source}>{formatSessionSourceLabel(source)}</option>
            ))}
          </select>
          {availableWorkspaces.length > 0 && (
            <select value={workspaceFilter} onChange={e => setWorkspaceFilter(e.target.value)} className="max-w-[220px] rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm focus:outline-none" title="Workspace filter">
              <option value="all">All workspaces</option>
              {availableWorkspaces.map(workspace => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} ({workspace.count})
                </option>
              ))}
            </select>
          )}
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
      <Card className="overflow-visible">
        {!sessions ? (
          <div className="flex items-center justify-center p-16"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
        ) : entries.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground/50">No sessions found.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {entries.map(([id, sess]) => {
              const platform = parsePlatformFromKey(id);
              const lastAccessed = normalizeUnixTimestampSeconds(sess.last_accessed);
              const isRecent = lastAccessed > Date.now() / 1000 - 86400;
              const isRenaming = renamingId === id;

              return (
                <div
                  key={id}
                  className={cn(
                    'group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30',
                    isRecent && 'bg-primary/[0.02]',
                    openMenuId === id && 'z-20',
                  )}
                >
                  <PlatformIcon name={platform} size={15} />

                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5">
                        <input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRename(id)} onClick={e => e.stopPropagation()} autoFocus className="w-48 rounded border border-border bg-background px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <button onClick={() => handleRename(id)} className="text-primary"><Check size={13} /></button>
                        <button onClick={() => setRenamingId(null)} className="text-muted-foreground"><X size={13} /></button>
                      </div>
                    ) : (
                      <button onClick={() => onOpenSessionInChat(id)} className="text-left group/title">
                        <p className="text-sm font-medium text-foreground truncate group-hover/title:text-primary transition-colors">{sess.title || id.split(':').slice(-2).join(':')}</p>
                      </button>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">{formatSessionSourceLabel(sess.source || platform)}</span>
                      <span className="text-[11px] text-muted-foreground/40">·</span>
                      <span className="text-[11px] font-mono text-muted-foreground/60">{sess.model || 'default'}</span>
                      {isRecent && <span className="w-1.5 h-1.5 rounded-full bg-success/60" title="Active recently" />}
                    </div>
                    {sess.workspace_id && (
                      <div className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md border border-primary/20 bg-primary/8 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        <MessageSquare size={10} className="shrink-0" />
                        <span className="truncate">{sess.workspace_name || sess.workspace_id}</span>
                      </div>
                    )}
                  </div>

                  <span className="text-[11px] text-muted-foreground/50 flex-shrink-0 tabular-nums">
                    {lastAccessed ? formatRelativeTime(lastAccessed) : '—'}
                  </span>

                  {/* Row actions */}
                  <div
                    className={cn(
                      'flex items-center gap-0.5 transition-opacity',
                      openMenuId === id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <button onClick={() => onOpenSessionInChat(id)} className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors" title="Open">
                      <ArrowRight size={13} />
                    </button>
                    <div className="relative" ref={openMenuId === id ? menuRef : undefined}>
                      <button onClick={() => setOpenMenuId(v => v === id ? null : id)} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <MoreHorizontal size={13} />
                      </button>
                      {openMenuId === id && (
                        <div className="absolute right-0 top-full mt-1 w-40 bg-popover border border-border rounded-lg shadow-lg py-1 z-50">
                          <MenuButton icon={<MessageSquare size={13} />} label="Open in Chat" onClick={() => { setOpenMenuId(null); onOpenSessionInChat(id); }} />
                          <MenuButton icon={resumingId === id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} label="Generate recap" onClick={() => handleResume(id)} />
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
