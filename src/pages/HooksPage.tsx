import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { PlugZap, RefreshCw, Webhook } from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { HookInfo, PluginInfo } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';

async function fetchHookData() {
  const [hooksRes, pluginsRes] = await Promise.all([
    api.hooks.list().catch(() => ({ data: [] })),
    api.plugins.list().catch(() => ({ data: { plugins: [] } })),
  ]);

  return {
    hooks: Array.isArray(hooksRes.data) ? hooksRes.data : [],
    plugins: Array.isArray(pluginsRes.data?.plugins) ? pluginsRes.data.plugins : [],
  };
}

export function HooksPage() {
  const gateway = useGatewayContext();
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const nextData = await fetchHookData();
      setHooks(nextData.hooks);
      setPlugins(nextData.plugins);
    } finally {
      setLoading(false);
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const nextData = await fetchHookData();
      if (cancelled) return;
      setHooks(nextData.hooks);
      setPlugins(nextData.plugins);
      setLoading(false);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void load(true);
    }, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  const enabledPlugins = useMemo(() => plugins.filter(plugin => plugin.enabled), [plugins]);
  const hookCapablePlugins = useMemo(() => enabledPlugins.filter(plugin => plugin.hasInitPy), [enabledPlugins]);
  const gatewayStateLabel = gateway.state?.gateway_state || gateway.health;

  return (
    <motion.div
      key="hooks"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold">
            Event <span className="text-primary">Hooks</span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
            <RefreshCw size={14} className={refreshing ? 'mr-1 inline animate-spin' : 'mr-1 inline'} />
            Refresh
          </button>
          <button
            onClick={() => setAutoRefresh(current => !current)}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              autoRefresh ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
            )}
          >
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="Gateway hooks" value={String(hooks.length)} detail="~/.hermes/hooks" />
        <Stat label="Handlers" value={String(hooks.filter(hook => hook.hasHandler).length)} detail="HOOK.yaml + handler.py" />
        <Stat label="Active plugins" value={String(enabledPlugins.length)} detail="from config" />
        <Stat label="Potential plugins" value={String(hookCapablePlugins.length)} detail={`gateway ${gatewayStateLabel}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Webhook size={16} className="text-primary" />
            Gateway Hooks
          </h3>
          <div className="space-y-3">
            {loading ? (
              <p className="text-sm italic text-muted-foreground">Loading...</p>
            ) : hooks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
                No gateway hook detected.
              </div>
            ) : (
              hooks.map(hook => (
                <div key={hook.path} className="rounded-lg border border-border bg-muted/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{hook.name}</p>
                      {hook.description && <p className="mt-1 text-sm text-muted-foreground">{hook.description}</p>}
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2 py-1 text-[10px]',
                        hook.hasHandler ? 'bg-green-500/10 text-success' : 'bg-red-500/10 text-destructive',
                      )}
                    >
                      {hook.hasHandler ? 'handler ok' : 'missing'}
                    </span>
                  </div>
                  {(hook.events || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {hook.events?.map(event => (
                        <span key={event} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{event}</span>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 break-all text-[10px] text-muted-foreground/55">{hook.path}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <PlugZap size={16} className="text-primary" />
            Plugin Hooks
          </h3>
          <div className="space-y-3">
            {hookCapablePlugins.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">No active plugin with hook capability detected.</p>
            ) : (
              hookCapablePlugins.map(plugin => (
                <div key={plugin.path} className="rounded-lg border border-border bg-muted/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{plugin.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {plugin.description || 'Active plugin that can register hooks.'}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                      enabled
                    </span>
                  </div>
                  <p className="mt-3 break-all text-[10px] text-muted-foreground/55">{plugin.path}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </motion.div>
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
