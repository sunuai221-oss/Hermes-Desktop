import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BrainCircuit, Clock3, MessageSquare, Play, RefreshCw,
  Sparkles, ArrowRight,
} from 'lucide-react';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { useProfiles } from '../contexts/ProfileContext';
import { useRuntimeStatus } from '../hooks/useRuntimeStatus';
import { useGatewayContext } from '../contexts/GatewayContext';
import * as api from '../api';
import { cn, formatRelativeTime } from '../lib/utils';
import type { CronJob, MemoryStore, NavItem, SessionEntry } from '../types';

interface Props {
  onNavigate: (item: NavItem) => void;
  onOpenSessionInChat: (sessionId: string | null) => void;
}

export function HomePage({ onNavigate, onOpenSessionInChat }: Props) {
  const { currentProfile } = useProfiles();
  const gateway = useGatewayContext();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [memoryStores, setMemoryStores] = useState<MemoryStore[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadHomeData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [jobsRes, memoryRes] = await Promise.all([
        api.cronjobs.list().catch(() => ({ data: [] })),
        api.memory.get().catch(() => ({ data: [] })),
      ]);
      setJobs(Array.isArray(jobsRes.data) ? jobsRes.data : []);
      setMemoryStores(Array.isArray(memoryRes.data) ? memoryRes.data : []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadHomeData(); }, [loadHomeData]);

  const currentModel = String(gateway.config?.model?.default || 'unset');
  const currentProvider = String(gateway.config?.model?.provider || 'auto');
  const { status: runtimeStatus } = useRuntimeStatus(gateway);

  const recentSessions = useMemo(() => (
    Object.entries(gateway.sessions)
      .sort((a, b) => getSessionTimestamp(b[1]) - getSessionTimestamp(a[1]))
      .slice(0, 4)
  ), [gateway.sessions]);

  const memoryUsage = useMemo(() => {
    const used = memoryStores.reduce((acc, store) => acc + store.charCount, 0);
    const limit = memoryStores.reduce((acc, store) => acc + store.charLimit, 0);
    return { used, limit, percent: limit > 0 ? Math.round((used / limit) * 100) : 0 };
  }, [memoryStores]);

  const activeJobs = jobs.filter(job => !job.paused);
  const userName = useMemo(() => {
    const userStore = memoryStores.find(store => store.target === 'user');
    return extractUserName(userStore?.content || '');
  }, [memoryStores]);
  const heroTitle = userName ? `Welcome, ${userName}` : 'Welcome to Hermes Desktop';

  return (
    <motion.div
      key="home"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto max-w-6xl space-y-5"
    >
      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-primary/10 bg-gradient-to-br from-card via-card to-secondary/30 p-6">
        <div className="absolute right-[-60px] top-[-40px] h-48 w-48 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute left-[20%] bottom-[-20px] h-24 w-24 rounded-full bg-brand-amber/6 blur-2xl" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70 font-medium">ΕΡΜΗΣ</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">{heroTitle}</h1>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground leading-relaxed">
              Your local AI cockpit is {runtimeStatus}. Chat, manage sessions, control the runtime.
            </p>

            {/* Quick actions — inline */}
            <div className="mt-5 flex flex-wrap gap-2">
              <HeroButton label="Chat" icon={<MessageSquare size={14} />} onClick={() => onNavigate('chat')} primary />
              <HeroButton label="Sessions" icon={<Clock3 size={14} />} onClick={() => onNavigate('sessions')} />
              <HeroButton label="Automations" icon={<Play size={14} />} onClick={() => onNavigate('automations')} />
            </div>
          </div>

          {/* Runtime badge */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <StatusBadge status={runtimeStatus} size="lg" />
            <button
              onClick={() => void loadHomeData()}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
              refresh
            </button>
          </div>
        </div>

        {/* Runtime info — subtle inline pills */}
        <div className="relative mt-5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
          <span className="text-muted-foreground/60">provider <span className="font-mono text-foreground/70">{currentProvider}</span></span>
          <span className="text-muted-foreground/60">model <span className="font-mono text-foreground/70">{currentModel}</span></span>
          <span className="text-muted-foreground/60">profile <span className="text-foreground/70">{currentProfile}</span></span>
        </div>
      </section>

      {/* ── Metrics row ────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Sessions" value={recentSessions.length} icon={<MessageSquare size={14} />} />
        <Metric label="Automations" value={activeJobs.length} suffix={`of ${jobs.length}`} icon={<Clock3 size={14} />} />
        <Metric label="Memory" value={memoryUsage.percent || 0} suffix="%" icon={<BrainCircuit size={14} />} />
        <Metric label="Skills" value={gateway.skills.length} icon={<Sparkles size={14} />} />
      </section>

      {/* ── Main content — 2 cols ──────────────────────────── */}
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Recent sessions */}
        <Card className="p-5">
          <SectionHeader
            title="Recent sessions"
            action={{ label: 'View all', onClick: () => onNavigate('sessions') }}
          />
          <div className="mt-4 space-y-2">
            {recentSessions.length === 0 ? (
              <EmptyState text="No sessions yet. Start chatting to create one." />
            ) : recentSessions.map(([id, session]) => (
              <SessionRow
                key={id}
                title={session.title || id}
                meta={`${session.source || 'api'} · ${session.model || 'default'} · ${formatRelativeTime(session.last_accessed || session.created_at || 0)}`}
                onOpen={() => { onOpenSessionInChat(id); onNavigate('chat'); }}
              />
            ))}
          </div>
        </Card>

        {/* Right column — stacked */}
        <div className="space-y-5">
          {/* Memory */}
          <Card className="p-5">
            <SectionHeader
              title="Memory"
              action={{ label: 'Open', onClick: () => onNavigate('soul') }}
            />
            <div className="mt-4 space-y-3">
              {memoryStores.length === 0 ? (
                <EmptyState text="No memory loaded." />
              ) : memoryStores.map(store => (
                <div key={store.target}>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <span className="font-medium text-foreground">{store.target}</span>
                    <span className="text-muted-foreground">{formatNumber(store.charCount)} / {formatNumber(store.charLimit)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        store.usagePercent > 80 ? 'bg-warning' : 'bg-primary',
                      )}
                      style={{ width: `${Math.min(100, store.usagePercent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Automations */}
          <Card className="p-5">
            <SectionHeader
              title="Automations"
              action={{ label: 'Manage', onClick: () => onNavigate('automations') }}
            />
            <div className="mt-4 space-y-2">
              {activeJobs.length === 0 ? (
                <EmptyState text="No active automations." />
              ) : activeJobs.slice(0, 3).map(job => (
                <div key={job.id} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{job.name || job.id}</p>
                    <p className="text-[11px] text-muted-foreground">{job.schedule}</p>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground/60 ml-3 flex-shrink-0">{job.delivery || 'local'}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Metric({ label, value, suffix, icon }: { label: string; value: number | string; suffix?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-muted-foreground/60 mb-2">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="text-xl font-semibold text-foreground tabular-nums">
        {value}{suffix && <span className="text-sm font-normal text-muted-foreground ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
}

function HeroButton({ label, icon, onClick, primary = false }: { label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'border border-border/60 text-foreground hover:bg-muted',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SectionHeader({ title, action }: { title: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {action && (
        <button
          onClick={action.onClick}
          className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-0.5"
        >
          {action.label}
          <ArrowRight size={10} />
        </button>
      )}
    </div>
  );
}

function SessionRow({ title, meta, onOpen }: { title: string; meta: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{meta}</p>
      </div>
      <ArrowRight size={14} className="text-muted-foreground/30 group-hover:text-primary transition-colors ml-3 flex-shrink-0" />
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground/50">{text}</p>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function getSessionTimestamp(session: SessionEntry) {
  const candidate = session.last_accessed ?? session.created_at ?? 0;
  return candidate > 1e12 ? candidate : candidate * 1000;
}

function extractUserName(content: string) {
  const text = String(content || '').trim();
  if (!text) return null;

  const patterns = [
    /\buser(?:'|\u2019)?s name is\s+([^\n.]+)/i,
    /\buser name is\s+([^\n.]+)/i,
    /^\s*name\s*:\s*([^\n]+)/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = normalizeDisplayName(match?.[1] || '');
    if (candidate) return candidate;
  }

  return null;
}

function normalizeDisplayName(value: string) {
  const cleaned = String(value || '')
    .replace(/[`*_#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '');

  return cleaned || null;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
