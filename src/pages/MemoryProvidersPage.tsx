import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BrainCircuit, Check, DatabaseZap, Server } from 'lucide-react';
import { Card } from '../components/Card';
import { useFeedback } from '../contexts/FeedbackContext';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { HermesConfig } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';


const providerModes = [
  {
    mode: 'builtin',
    title: 'Builtin only',
    provider: '',
    badge: 'Minimal',
    icon: <BrainCircuit size={16} />,
    summary: 'MEMORY.md + USER.md only.',
  },
  {
    mode: 'holographic',
    title: 'Local simple',
    provider: 'holographic',
    badge: 'Local',
    icon: <DatabaseZap size={16} />,
    summary: 'Local SQLite, no separate service.',
  },
  {
    mode: 'openviking',
    title: 'Local advanced',
    provider: 'openviking',
    badge: 'Advanced',
    icon: <Server size={16} />,
    summary: 'Enhanced retrieval with an external service.',
  },
];

export function MemoryProvidersPage() {
  const gateway = useGatewayContext();
  const { notify } = useFeedback();
  const [saving, setSaving] = useState<string | null>(null);
  const [currentProvider, setCurrentProvider] = useState(gateway.config?.memory?.provider || '');

  const effectiveMode = currentProvider || 'builtin';
  const statusLine = useMemo(() => currentProvider || 'builtin only', [currentProvider]);

  useEffect(() => {
    setCurrentProvider(gateway.config?.memory?.provider || '');
  }, [gateway.config?.memory?.provider]);

  const applyProvider = async (provider: string) => {
    if (!gateway.config) return;
    setSaving(provider || 'builtin');
    try {
      const next: HermesConfig = JSON.parse(JSON.stringify(gateway.config));
      if (!next.memory) next.memory = {};
      next.memory.provider = provider || undefined;
      if (next.memory.memory_enabled === undefined) next.memory.memory_enabled = true;
      if (next.memory.user_profile_enabled === undefined) next.memory.user_profile_enabled = true;
      if (provider === 'openviking' && next.memory.memory_char_limit === undefined) next.memory.memory_char_limit = 2200;
      if (provider === 'openviking' && next.memory.user_char_limit === undefined) next.memory.user_char_limit = 1375;
      await api.config.save(next);
      setCurrentProvider(provider || '');
      notify({ tone: 'success', message: 'Memory provider updated.' });
    } catch {
      notify({ tone: 'error', message: 'Could not update the memory provider.' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <motion.div
      key="memoryProviders"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold">
            Memory <span className="text-primary">Providers</span>
          </h2>
        </div>
        <Card className="min-w-[260px] p-4">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="mt-2 text-xl font-semibold">{statusLine}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {providerModes.map(item => {
          const active = (item.provider || 'builtin') === effectiveMode;
          return (
            <Card key={item.mode} className={cn('border p-6', active && 'border-primary/30')}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-primary">{item.icon}</span>
                    <h3 className="text-lg font-bold">{item.title}</h3>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{item.summary}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                  {item.badge}
                </span>
              </div>

              {item.provider === 'openviking' && (
                <p className="mb-4 text-xs text-muted-foreground">
                  Requires an active external service.
                </p>
              )}

              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={() => void applyProvider(item.provider)}
                  disabled={saving !== null}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-semibold',
                    active ? 'bg-success text-primary-foreground' : 'bg-primary text-primary-foreground',
                    saving !== null && 'opacity-50',
                  )}
                >
                  {active ? 'Active' : saving === (item.provider || 'builtin') ? 'Applying...' : 'Use'}
                </button>
                {active && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check size={12} />
                    Current provider
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </motion.div>
  );
}
