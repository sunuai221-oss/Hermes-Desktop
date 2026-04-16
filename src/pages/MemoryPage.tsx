import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BrainCircuit, Save, Search, UserRound } from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn, parsePlatformFromKey } from '../lib/utils';
import type { MemorySearchResult, MemoryStore } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';


export function MemoryPage() {
  const gateway = useGatewayContext();
  const [stores, setStores] = useState<MemoryStore[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<'memory' | 'user' | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const res = await api.memory.get();
    const nextStores = Array.isArray(res.data) ? res.data : [];
    setStores(nextStores);
    setDrafts(Object.fromEntries(nextStores.map(store => [store.target, store.content])));
  };

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const memoryStore = stores.find(store => store.target === 'memory');
  const userStore = stores.find(store => store.target === 'user');
  const memoryDraft = drafts.memory ?? memoryStore?.content ?? '';
  const userDraft = drafts.user ?? userStore?.content ?? '';
  const memoryConfig = gateway.config?.memory || {};
  const providerLabel = memoryConfig.provider || 'builtin only';

  const saveStore = async (target: 'memory' | 'user') => {
    setSaving(target);
    try {
      await api.memory.save(target, drafts[target] || '');
      await load();
    } finally {
      setSaving(null);
    }
  };

  const searchHistory = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.memory.search(query.trim());
      setResults(Array.isArray(res.data) ? res.data : []);
    } finally {
      setSearching(false);
    }
  };

  const totalUsage = useMemo(() => stores.reduce((acc, store) => acc + store.charCount, 0), [stores]);
  const totalLimit = useMemo(() => stores.reduce((acc, store) => acc + store.charLimit, 0), [stores]);

  return (
    <motion.div
      key="memory"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      <div>
        <h2 className="text-3xl font-semibold">
          Persistent <span className="text-primary">Memory</span>
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Active memory" value={`${totalUsage}/${totalLimit || 3575}`} detail="total chars" />
        <Stat label="MEMORY.md" value={`${memoryStore?.usagePercent ?? 0}%`} detail={`${memoryStore?.charCount ?? 0}/${memoryStore?.charLimit ?? 2200}`} />
        <Stat label="USER.md" value={`${userStore?.usagePercent ?? 0}%`} detail={`${userStore?.charCount ?? 0}/${userStore?.charLimit ?? 1375}`} />
        <Stat label="Provider" value={providerLabel} detail={`builtin ${memoryConfig.memory_enabled === false ? 'off' : 'on'}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <MemoryEditor
          title="MEMORY.md"
          subtitle="Environment, projects, conventions, lessons learned"
          icon={<BrainCircuit size={16} className="text-primary" />}
          store={memoryStore}
          value={memoryDraft}
          loading={loading}
          saving={saving === 'memory'}
          onChange={value => setDrafts(current => ({ ...current, memory: value }))}
          onSave={() => void saveStore('memory')}
        />
        <MemoryEditor
          title="USER.md"
          subtitle="User preferences, communication style, expectations"
          icon={<UserRound size={16} className="text-primary" />}
          store={userStore}
          value={userDraft}
          loading={loading}
          saving={saving === 'user'}
          onChange={value => setDrafts(current => ({ ...current, user: value }))}
          onSave={() => void saveStore('user')}
        />
      </div>

      <Card className="p-6">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <Search size={16} className="text-primary" />
          Conversation history
        </h3>
        <div className="mb-4 flex gap-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search transcripts..."
            className="flex-1 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={searchHistory}
            disabled={searching || !query.trim()}
            className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>
        <div className="max-h-[420px] space-y-3 overflow-auto">
          {results.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">No result yet.</p>
          ) : (
            results.map((result, index) => (
              <div key={`${result.sessionId}-${index}`} className="rounded-lg border border-border bg-muted/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{parsePlatformFromKey(result.sessionId) || result.platform}</div>
                  <span className="text-[10px] text-muted-foreground">{result.role}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{result.snippet}</p>
                <p className="mt-2 truncate text-[10px] text-muted-foreground/55">{result.sessionId}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function MemoryEditor({
  title,
  subtitle,
  icon,
  store,
  value,
  loading,
  saving,
  onChange,
  onSave,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  store?: MemoryStore;
  value: string;
  loading: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const charLimit = store?.charLimit ?? 0;
  const charCount = value.length;
  const usagePercent = charLimit > 0 ? Math.min(100, Math.round((charCount / charLimit) * 100)) : 0;

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold">
            {icon}
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <button
          onClick={onSave}
          disabled={saving || loading || (charLimit > 0 && charCount > charLimit)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {saving ? 'Saving...' : <><Save size={14} className="mr-1 inline" />Save</>}
        </button>
      </div>

      <div className="mb-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{charCount}/{charLimit || '-'} characters</span>
          <span className={cn(usagePercent >= 80 ? 'text-warning' : 'text-muted-foreground')}>{usagePercent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              usagePercent >= 95 ? 'bg-red-500' : usagePercent >= 80 ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-[320px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          className="min-h-[320px] w-full resize-y rounded-lg border border-border bg-transparent p-5 font-mono text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-primary/30"
          spellCheck={false}
        />
      )}
    </Card>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}
