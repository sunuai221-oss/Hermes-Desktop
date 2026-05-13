import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BrainCircuit, Loader2, Sparkles } from 'lucide-react';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { MemoryStore } from '../types';
import { MemoryPanel } from './identity/MemoryPanel';
import { SoulPanel } from './identity/SoulPanel';

type Tab = 'soul' | 'memory';
type MemoryTarget = 'memory' | 'user';

export function IdentityPage() {
  const [tab, setTab] = useState<Tab>('soul');
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [savingSoul, setSavingSoul] = useState(false);
  const [savedSoul, setSavedSoul] = useState(false);
  const [memoryStores, setMemoryStores] = useState<MemoryStore[]>([]);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [savingMemoryTarget, setSavingMemoryTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [soulRes, memoryRes] = await Promise.all([
        api.soul.get().catch(() => null),
        api.memory.get().catch(() => null),
      ]);
      const soul = soulRes?.data?.content || '';
      const nextStores = Array.isArray(memoryRes?.data) ? memoryRes.data : [];
      setContent(soul);
      setOriginal(soul);
      setMemoryStores(nextStores);
      setMemoryDrafts(Object.fromEntries(nextStores.map(store => [store.target, store.content])));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const hasSoulChanges = content !== original;
  const memoryStore = memoryStores.find(store => store.target === 'memory');
  const userStore = memoryStores.find(store => store.target === 'user');

  const saveSoul = async () => {
    setSavingSoul(true);
    try {
      await api.soul.save(content);
      setOriginal(content);
      setSavedSoul(true);
      window.setTimeout(() => setSavedSoul(false), 2000);
    } finally {
      setSavingSoul(false);
    }
  };

  const saveMemoryStore = async (target: MemoryTarget) => {
    setSavingMemoryTarget(target);
    try {
      await api.memory.save(target, memoryDrafts[target] || '');
      await loadInitial();
    } finally {
      setSavingMemoryTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <motion.div
      key="identity"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto max-w-5xl space-y-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Identity</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Runtime identity for the active profile.</p>
        </div>
        <div className="flex items-center rounded-lg border border-border/40 bg-muted/50 p-0.5">
          {([
            { id: 'soul' as Tab, label: 'Soul', icon: <Sparkles size={13} /> },
            { id: 'memory' as Tab, label: 'Memory', icon: <BrainCircuit size={13} /> },
          ]).map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                tab === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'soul' && (
        <SoulPanel
          content={content}
          hasChanges={hasSoulChanges}
          saving={savingSoul}
          saved={savedSoul}
          onChange={setContent}
          onSave={() => void saveSoul()}
          onReset={() => setContent(original)}
        />
      )}

      {tab === 'memory' && (
        <MemoryPanel
          memoryStore={memoryStore}
          userStore={userStore}
          memoryDrafts={memoryDrafts}
          savingTarget={savingMemoryTarget}
          onChange={(target, value) => setMemoryDrafts(current => ({ ...current, [target]: value }))}
          onSave={target => void saveMemoryStore(target)}
        />
      )}
    </motion.div>
  );
}
