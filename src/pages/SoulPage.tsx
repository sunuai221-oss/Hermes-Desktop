import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BrainCircuit, Plus, RotateCcw, Save, Sparkles, Check, Loader2,
  Search,
} from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn, parsePlatformFromKey } from '../lib/utils';
import type { AgentProfile, MemorySearchResult, MemoryStore } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';

type Tab = 'soul' | 'memory' | 'presets';

function createEmptyAgent(seed = Date.now()): AgentProfile {
  const now = new Date().toISOString();
  return {
    id: `agent_${seed}`,
    name: `agent-${String(seed).slice(-4)}`,
    description: '',
    soul: `# Identity\n\nYou are a pragmatic Hermes-based agent.\n\n## Style\n- Be direct\n- Be useful\n- Stay grounded in operational reality`,
    personalityOverlay: '',
    defaultModel: '',
    preferredSkills: [],
    preferredPlatforms: [],
    toolPolicy: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function SoulPage() {
  const gateway = useGatewayContext();
  const [tab, setTab] = useState<Tab>('soul');

  // Soul
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [savingSoul, setSavingSoul] = useState(false);
  const [savedSoul, setSavedSoul] = useState(false);

  // Memory
  const [memoryStores, setMemoryStores] = useState<MemoryStore[]>([]);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [savingMemoryTarget, setSavingMemoryTarget] = useState<string | null>(null);

  // Presets
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [soulRes, agentsRes, memoryRes] = await Promise.all([
        api.soul.get().catch(() => null),
        api.agents.list().catch(() => null),
        api.memory.get().catch(() => null),
      ]);
      const soul = soulRes?.data?.content || '';
      const agentProfiles = Array.isArray(agentsRes?.data) ? agentsRes.data : [];
      const nextStores = Array.isArray(memoryRes?.data) ? memoryRes.data : [];
      setContent(soul); setOriginal(soul);
      setProfiles(agentProfiles);
      setActiveId(c => c || agentProfiles[0]?.id || null);
      setMemoryStores(nextStores);
      setMemoryDrafts(Object.fromEntries(nextStores.map(s => [s.target, s.content])));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  const hasSoulChanges = content !== original;
  const selectedProfile = useMemo(() => profiles.find(p => p.id === activeId) || null, [profiles, activeId]);
  const installedSkillNames = useMemo(() => gateway.skills.map(s => s.name), [gateway.skills]);
  const models = useMemo(() => gateway.models.map(m => m.name), [gateway.models]);
  const memoryStore = memoryStores.find(s => s.target === 'memory');
  const userStore = memoryStores.find(s => s.target === 'user');

  // Actions
  const saveSoul = async () => {
    setSavingSoul(true);
    try { await api.soul.save(content); setOriginal(content); setSavedSoul(true); setTimeout(() => setSavedSoul(false), 2000); }
    catch { /* handle */ }
    finally { setSavingSoul(false); }
  };

  const saveMemoryStore = async (target: string) => {
    setSavingMemoryTarget(target);
    try { await api.memory.save(target as 'memory' | 'user', memoryDrafts[target] || ''); await loadInitial(); }
    catch { /* handle */ }
    finally { setSavingMemoryTarget(null); }
  };

  const updateProfile = (patch: Partial<AgentProfile>) => {
    if (!activeId) return;
    setProfiles(c => c.map(p => p.id === activeId ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p));
  };

  const createProfile = () => {
    const newProfile = createEmptyAgent();
    setProfiles(c => [newProfile, ...c]);
    setActiveId(newProfile.id);
  };

  const deleteProfile = async () => {
    if (!activeId) return;
    setProfiles(c => c.filter(p => p.id !== activeId));
    setActiveId(profiles.find(p => p.id !== activeId)?.id || null);
  };

  const duplicateProfile = () => {
    if (!selectedProfile) return;
    const copy = { ...selectedProfile, id: `agent_${Date.now()}`, name: `${selectedProfile.name} (copy)`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setProfiles(c => [copy, ...c]);
    setActiveId(copy.id);
  };

  const saveLibrary = async () => {
    setSavingLibrary(true);
    try { await api.agents.save(profiles); setTimeout(() => setSavingLibrary(false), 2000); }
    catch { setSavingLibrary(false); }
  };

  const applyProfile = async () => {
    if (!selectedProfile) return;
    setApplyingId(selectedProfile.id);
    try { await api.agents.apply(selectedProfile.id); }
    catch { /* handle */ }
    finally { setApplyingId(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div key="soul" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-5xl space-y-5">
      {/* Header + Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Agent Studio</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Identity, memory, and presets for your Hermes agent.</p>
        </div>
        <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border/40">
          {([
            { id: 'soul' as Tab, label: 'Soul', icon: <Sparkles size={13} /> },
            { id: 'memory' as Tab, label: 'Memory', icon: <BrainCircuit size={13} /> },
            { id: 'presets' as Tab, label: 'Presets', icon: <span className="text-xs">⚡</span> },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'soul' && (
        <SoulEditor
          content={content}
          hasChanges={hasSoulChanges}
          saving={savingSoul}
          saved={savedSoul}
          onChange={setContent}
          onSave={saveSoul}
          onReset={() => setContent(original)}
        />
      )}

      {tab === 'memory' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <MemoryEditor
              title="MEMORY.md"
              subtitle="Durable facts, conventions, environment"
              store={memoryStore}
              value={memoryDrafts.memory || ''}
              saving={savingMemoryTarget === 'memory'}
              onChange={v => setMemoryDrafts(c => ({ ...c, memory: v }))}
              onSave={() => void saveMemoryStore('memory')}
            />
            <MemoryEditor
              title="USER.md"
              subtitle="User preferences, style, expectations"
              store={userStore}
              value={memoryDrafts.user || ''}
              saving={savingMemoryTarget === 'user'}
              onChange={v => setMemoryDrafts(c => ({ ...c, user: v }))}
              onSave={() => void saveMemoryStore('user')}
            />
          </div>

          <ConversationSearch />
        </div>
      )}

      {tab === 'presets' && (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
          {/* Preset list */}
          <Card className="p-4 h-fit">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">{profiles.length} preset(s)</span>
              <div className="flex items-center gap-1.5">
                <button onClick={createProfile} className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors" title="New preset">
                  <Plus size={14} />
                </button>
                <button onClick={saveLibrary} disabled={savingLibrary} className={cn('p-1.5 rounded-md transition-colors', savingLibrary ? 'text-success' : 'text-muted-foreground hover:text-foreground hover:bg-muted')}>
                  {savingLibrary ? <Check size={14} /> : <Save size={14} />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              {profiles.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground/50">No presets yet.</p>
              ) : profiles.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActiveId(p.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-lg transition-colors',
                    activeId === p.id ? 'bg-primary/8 border border-primary/20' : 'hover:bg-muted/50 border border-transparent',
                  )}
                >
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  {p.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{p.description}</p>}
                  {p.defaultModel && <p className="text-[10px] font-mono text-muted-foreground/50 mt-1">{p.defaultModel}</p>}
                </button>
              ))}
            </div>
          </Card>

          {/* Preset form */}
          <Card className="p-5">
            {!selectedProfile ? (
              <div className="flex items-center justify-center h-48">
                <p className="text-sm text-muted-foreground/50">Select a preset or create one.</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button onClick={duplicateProfile} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Duplicate</button>
                    <span className="text-muted-foreground/30">·</span>
                    <button onClick={deleteProfile} className="text-[11px] text-destructive/60 hover:text-destructive transition-colors">Delete</button>
                  </div>
                  <button onClick={applyProfile} disabled={applyingId === selectedProfile.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                    {applyingId === selectedProfile.id ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    Apply
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Name" value={selectedProfile.name} onChange={v => updateProfile({ name: v })} />
                  <Field label="Default model" value={selectedProfile.defaultModel || ''} onChange={v => updateProfile({ defaultModel: v })} listId="models-list" />
                </div>
                <Field label="Description" value={selectedProfile.description || ''} onChange={v => updateProfile({ description: v })} />

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Soul</label>
                  <textarea value={selectedProfile.soul} onChange={e => updateProfile({ soul: e.target.value })} className="w-full min-h-[200px] bg-muted/30 border border-border/60 rounded-xl px-4 py-3 font-mono text-sm leading-7 resize-y focus:outline-none focus:ring-2 focus:ring-primary/30" spellCheck={false} />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Personality overlay</label>
                  <textarea value={selectedProfile.personalityOverlay || ''} onChange={e => updateProfile({ personalityOverlay: e.target.value })} className="w-full min-h-[100px] bg-muted/30 border border-border/60 rounded-xl px-4 py-3 font-mono text-sm leading-7 resize-y focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="You are a meticulous code reviewer..." spellCheck={false} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Preferred skills" value={(selectedProfile.preferredSkills || []).join(', ')} onChange={v => updateProfile({ preferredSkills: splitCsv(v) })} placeholder={installedSkillNames.slice(0, 4).join(', ')} />
                  <Field label="Platforms" value={(selectedProfile.preferredPlatforms || []).join(', ')} onChange={v => updateProfile({ preferredPlatforms: splitCsv(v) })} placeholder="discord, telegram" />
                </div>

                <Field label="Tool policy" value={selectedProfile.toolPolicy || ''} onChange={v => updateProfile({ toolPolicy: v })} placeholder="Terminal allowed on API/Discord only" />
                <Field label="Notes" value={selectedProfile.notes || ''} onChange={v => updateProfile({ notes: v })} placeholder="Support agent, concise replies" />
              </div>
            )}
          </Card>

          <datalist id="models-list">
            {models.map(m => <option key={m} value={m} />)}
          </datalist>
        </div>
      )}
    </motion.div>
  );
}

// ── Soul Editor ─────────────────────────────────────────────────

function SoulEditor({ content, hasChanges, saving, saved, onChange, onSave, onReset }: {
  content: string; hasChanges: boolean; saving: boolean; saved: boolean;
  onChange: (v: string) => void; onSave: () => void; onReset: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <span className="text-sm font-medium">SOUL.md</span>
          {hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-warning" title="Unsaved changes" />}
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button onClick={onReset} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
              <RotateCcw size={11} /> Reset
            </button>
          )}
          <button onClick={onSave} disabled={saving || !hasChanges} className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', saved ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary hover:bg-primary/15', (saving || !hasChanges) && 'opacity-40')}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <><Check size={13} className="inline mr-1" />Saved</> : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={e => onChange(e.target.value)}
        className="w-full min-h-[500px] bg-transparent p-6 font-mono text-sm leading-7 focus:outline-none resize-y"
        spellCheck={false}
        placeholder="# Identity&#10;&#10;You are..."
      />
    </Card>
  );
}

// ── Memory Editor ───────────────────────────────────────────────

function MemoryEditor({ title, subtitle, store, value, saving, onChange, onSave }: {
  title: string; subtitle: string; store?: MemoryStore; value: string;
  saving: boolean; onChange: (v: string) => void; onSave: () => void;
}) {
  const charLimit = store?.charLimit ?? 0;
  const charCount = value.length;
  const pct = charLimit > 0 ? Math.min(100, Math.round((charCount / charLimit) * 100)) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit size={14} className="text-primary" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <button onClick={onSave} disabled={saving || (charLimit > 0 && charCount > charLimit)} className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', 'bg-primary/10 text-primary hover:bg-primary/15', saving && 'opacity-40')}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
      </div>

      {charLimit > 0 && (
        <div className="px-5 pt-3">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-muted-foreground">{formatNumber(charCount)} / {formatNumber(charLimit)}</span>
            <span className={cn(pct >= 80 ? 'text-warning' : 'text-muted-foreground/50')}>{pct}%</span>
          </div>
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full min-h-[340px] bg-transparent p-5 font-mono text-sm leading-7 focus:outline-none resize-y"
        spellCheck={false}
      />
      {store?.path && <p className="px-5 pb-3 text-[9px] text-muted-foreground/30 font-mono truncate">{store.path}</p>}
    </Card>
  );
}

// ── Field ───────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, listId }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; listId?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} list={listId} className="w-full bg-muted/30 border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
    </div>
  );
}

// ── Conversation Search ──────────────────────────────────────────

function ConversationSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await api.memory.search(query.trim());
      setResults(Array.isArray(res.data) ? res.data : []);
    } finally { setSearching(false); }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-primary" />
          <span className="text-sm font-medium">Conversation history</span>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Search past conversations…"
            className="flex-1 bg-muted/30 border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button onClick={search} disabled={searching || !query.trim()} className="px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/15 disabled:opacity-40">
            {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
          </button>
        </div>
        <div className="max-h-[320px] space-y-2 overflow-auto">
          {results.length === 0 && query && !searching ? (
            <p className="py-6 text-center text-sm text-muted-foreground/40">No results.</p>
          ) : results.map((r, i) => (
            <div key={`${r.sessionId}-${i}`} className="rounded-lg bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-foreground">{parsePlatformFromKey(r.sessionId) || r.platform}</span>
                <span className="text-[10px] text-muted-foreground/50">{r.role}</span>
              </div>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{r.snippet}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function splitCsv(value: string) {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
