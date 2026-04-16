import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { PluginInfo } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';


type ApiServerPlatformConfig = {
  enabled?: boolean;
};

async function fetchPluginData() {
  const response = await api.plugins.list().catch(() => ({
    data: { plugins: [], projectPluginsEnabled: false },
  }));

  return {
    plugins: Array.isArray(response.data?.plugins) ? response.data.plugins : [],
    projectPluginsEnabled: Boolean(response.data?.projectPluginsEnabled),
  };
}

export function PluginsPage() {
  const gateway = useGatewayContext();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [projectPluginsEnabled, setProjectPluginsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const nextData = await fetchPluginData();
      setPlugins(nextData.plugins);
      setProjectPluginsEnabled(nextData.projectPluginsEnabled);
    } finally {
      setLoading(false);
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const nextData = await fetchPluginData();
      if (cancelled) return;
      setPlugins(nextData.plugins);
      setProjectPluginsEnabled(nextData.projectPluginsEnabled);
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

  const enabledCount = useMemo(() => plugins.filter(plugin => plugin.enabled).length, [plugins]);
  const userPlugins = plugins.filter(plugin => plugin.source === 'user');
  const projectPlugins = plugins.filter(plugin => plugin.source === 'project');
  const apiServerConfig = gateway.config?.platforms?.api_server as ApiServerPlatformConfig | undefined;
  const gatewayMode = apiServerConfig?.enabled ? 'gateway-aware' : 'cli-oriented';

  return (
    <motion.div
      key="plugins"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold">
            Hermes <span className="text-primary">Plugins</span>
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
        <Stat label="Plugins" value={String(plugins.length)} detail="detected" />
        <Stat label="Active" value={String(enabledCount)} detail="from config.yaml" />
        <Stat label="User" value={String(userPlugins.length)} detail="~/.hermes/plugins" />
        <Stat label="Project" value={projectPluginsEnabled ? 'on' : 'off'} detail={gatewayMode} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <PluginColumn
          title="User Plugins"
          subtitle="~/.hermes/plugins"
          plugins={userPlugins}
          loading={loading}
        />
        <PluginColumn
          title="Project Plugins"
          subtitle="./.hermes/plugins"
          plugins={projectPlugins}
          loading={loading}
          extraNote={projectPluginsEnabled ? 'Project plugins allowed.' : 'Project plugins disabled.'}
        />
      </div>
    </motion.div>
  );
}

function PluginColumn({
  title,
  subtitle,
  plugins,
  loading,
  extraNote,
}: {
  title: string;
  subtitle: string;
  plugins: PluginInfo[];
  loading: boolean;
  extraNote?: string;
}) {
  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        {extraNote && <p className="mt-2 text-xs text-muted-foreground">{extraNote}</p>}
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm italic text-muted-foreground">Loading...</p>
        ) : plugins.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No plugin detected.</p>
        ) : (
          plugins.map(plugin => (
            <div key={plugin.path} className="rounded-lg border border-border bg-muted/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{plugin.name}</p>
                    {plugin.version && <span className="text-[10px] text-muted-foreground">v{plugin.version}</span>}
                  </div>
                  {plugin.description && <p className="mt-1 text-sm text-muted-foreground">{plugin.description}</p>}
                </div>
                <span
                  className={cn(
                    'rounded-full px-2 py-1 text-[10px]',
                    plugin.enabled ? 'bg-green-500/10 text-success' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {plugin.enabled ? 'enabled' : 'disabled'}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <MetaTag active={plugin.hasInitPy}>__init__.py</MetaTag>
                <MetaTag active={plugin.hasSchemasPy}>schemas.py</MetaTag>
                <MetaTag active={plugin.hasToolsPy}>tools.py</MetaTag>
                {(plugin.requiresEnv || []).map(envVar => (
                  <MetaTag key={envVar}>env:{envVar}</MetaTag>
                ))}
              </div>

              <p className="mt-3 break-all text-[10px] text-muted-foreground/55">{plugin.path}</p>
            </div>
          ))
        )}
      </div>
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

function MetaTag({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-1 text-[10px]',
        active ? 'bg-muted text-muted-foreground' : 'bg-red-500/8 text-destructive',
      )}
    >
      {children}
    </span>
  );
}
