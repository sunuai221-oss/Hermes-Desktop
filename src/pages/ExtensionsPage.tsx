import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Webhook } from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { HookInfo, PluginInfo } from '../types';

type Tab = 'plugins' | 'hooks';

async function fetchExtensionsData() {
  const [pluginsRes, hooksRes] = await Promise.all([
    api.plugins.list().catch(() => ({ data: { plugins: [] } })),
    api.hooks.list().catch(() => ({ data: [] })),
  ]);

  return {
    plugins: Array.isArray(pluginsRes.data?.plugins) ? pluginsRes.data.plugins : [],
    hooks: Array.isArray(hooksRes.data) ? hooksRes.data : [],
  };
}

export function ExtensionsPage() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('plugins');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const nextData = await fetchExtensionsData();
      setPlugins(nextData.plugins);
      setHooks(nextData.hooks);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const nextData = await fetchExtensionsData();
      if (cancelled) return;
      setPlugins(nextData.plugins);
      setHooks(nextData.hooks);
      setLoading(false);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = useMemo(() => plugins.filter(p => p.enabled).length, [plugins]);
  const hooksCount = hooks.length;

  // When switching tabs, deselect
  const switchTab = (t: Tab) => {
    setTab(t);
    setSelectedId(null);
  };

  // Cross-reference: which hooks belong to which plugin
  // (Hermes gateway hooks are standalone, plugin hooks come from enabled plugins with __init__.py)
  const hookCapablePlugins = useMemo(
    () => plugins.filter(p => p.enabled && p.hasInitPy),
    [plugins],
  );

  return (
    <motion.div
      key="extensions"
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
            <span className="text-primary">Extensions</span>
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {plugins.length} plugin{plugins.length !== 1 ? 's' : ''} · {enabledCount} active · {hooksCount} hook{hooksCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => void load()} className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          <RefreshCw size={14} className={cn('mr-1 inline', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton label="Plugins" count={plugins.length} active={tab === 'plugins'} onClick={() => switchTab('plugins')} />
        <TabButton label="Hooks" count={hooksCount} active={tab === 'hooks'} onClick={() => switchTab('hooks')} />
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-6">
        {/* List */}
        <Card className="overflow-hidden">
          {loading ? (
            <p className="py-16 text-center text-sm italic text-muted-foreground">Loading...</p>
          ) : tab === 'plugins' ? (
            <PluginsList
              plugins={plugins}
              selectedId={selectedId}
              onSelect={id => setSelectedId(id === selectedId ? null : id)}
            />
          ) : (
            <HooksList
              hooks={hooks}
              hookCapablePlugins={hookCapablePlugins}
              selectedId={selectedId}
              onSelect={id => setSelectedId(id === selectedId ? null : id)}
            />
          )}
        </Card>

        {/* Detail */}
        <Card className="p-6">
          {tab === 'plugins' ? (
            <PluginDetail plugins={plugins} hooks={hooks} selectedId={selectedId} />
          ) : (
            <HookDetail hooks={hooks} hookCapablePlugins={hookCapablePlugins} selectedId={selectedId} />
          )}
        </Card>
      </div>
    </motion.div>
  );
}

/* ── Plugins List ───────────────────────────────── */

function PluginsList({ plugins, selectedId, onSelect }: {
  plugins: PluginInfo[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  if (plugins.length === 0) {
    return <p className="py-16 text-center text-sm italic text-muted-foreground">No plugin detected.</p>;
  }

  return (
    <div className="divide-y divide-border">
      {plugins.map(plugin => {
        const id = `plugin:${plugin.path}`;
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={cn(
              'w-full text-left p-4 transition-colors',
              selectedId === id ? 'bg-primary/5' : 'hover:bg-muted/50',
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', plugin.enabled ? 'bg-green-500' : 'bg-muted-foreground/30')} />
              <p className="font-semibold text-sm truncate">{plugin.name}</p>
              {plugin.version && <span className="text-[10px] text-muted-foreground">v{plugin.version}</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground pl-5">
              {plugin.source === 'user' ? 'user' : 'project'} · {plugin.enabled ? 'enabled' : 'disabled'}
            </p>
          </button>
        );
      })}
    </div>
  );
}

/* ── Plugin Detail ──────────────────────────────── */

function PluginDetail({ plugins, hooks, selectedId }: {
  plugins: PluginInfo[]; hooks: HookInfo[]; selectedId: string | null;
}) {
  const plugin = plugins.find(p => `plugin:${p.path}` === selectedId) || null;

  if (!plugin) {
    return <p className="text-sm text-muted-foreground italic py-12 text-center">Select a plugin to view details.</p>;
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className={cn('h-3 w-3 rounded-full', plugin.enabled ? 'bg-green-500' : 'bg-muted-foreground/30')} />
            <h3 className="text-lg font-bold">{plugin.name}</h3>
          </div>
          {plugin.description && <p className="text-sm text-muted-foreground mt-1">{plugin.description}</p>}
        </div>
        <span className={cn(
          'rounded-full px-2.5 py-1 text-[10px] font-medium shrink-0',
          plugin.enabled ? 'bg-green-500/10 text-green-400' : 'bg-muted text-muted-foreground',
        )}>
          {plugin.enabled ? 'enabled' : 'disabled'}
        </span>
      </div>

      <div className="space-y-4">
        {plugin.version && <DetailRow label="Version" value={plugin.version} />}
        <DetailRow label="Source" value={plugin.source === 'user' ? '~/.hermes/plugins' : './.hermes/plugins'} />

        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Files</p>
          <div className="flex flex-wrap gap-2">
            <MetaTag active={plugin.hasInitPy}>__init__.py</MetaTag>
            <MetaTag active={plugin.hasSchemasPy}>schemas.py</MetaTag>
            <MetaTag active={plugin.hasToolsPy}>tools.py</MetaTag>
          </div>
        </div>

        {(plugin.requiresEnv || []).length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Required env vars</p>
            <div className="flex flex-wrap gap-2">
              {plugin.requiresEnv!.map(v => (
                <span key={v} className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-400 font-mono">{v}</span>
              ))}
            </div>
          </div>
        )}

        <DetailRow label="Path" value={plugin.path} mono />

        {/* Show hooks from this plugin */}
        {hooks.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
              <Webhook size={12} />
              Gateway hooks ({hooks.length})
            </p>
            <div className="space-y-2">
              {hooks.map(hook => (
                <div key={hook.path} className="rounded-lg border border-border bg-muted/50 p-3">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'h-2 w-2 rounded-full',
                      hook.hasHandler ? 'bg-green-500' : 'bg-red-500',
                    )} />
                    <span className="text-sm font-medium">{hook.name}</span>
                    {hook.hasHandler ? (
                      <span className="text-[10px] text-green-400">handler ok</span>
                    ) : (
                      <span className="text-[10px] text-destructive">missing</span>
                    )}
                  </div>
                  {(hook.events || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {hook.events!.map(e => (
                        <span key={e} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{e}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Hooks List ─────────────────────────────────── */

function HooksList({ hooks, hookCapablePlugins, selectedId, onSelect }: {
  hooks: HookInfo[]; hookCapablePlugins: PluginInfo[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const items = [
    ...hooks.map(h => ({ type: 'hook' as const, hook: h, id: `hook:${h.path}` })),
    ...hookCapablePlugins.map(p => ({ type: 'plugin' as const, plugin: p, id: `plugin-hook:${p.path}` })),
  ];

  if (items.length === 0) {
    return <p className="py-16 text-center text-sm italic text-muted-foreground">No hook or hook-capable plugin detected.</p>;
  }

  return (
    <div className="divide-y divide-border">
      {items.map(item => {
        if (item.type === 'hook') {
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={cn(
                'w-full text-left p-4 transition-colors',
                selectedId === item.id ? 'bg-primary/5' : 'hover:bg-muted/50',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', item.hook.hasHandler ? 'bg-green-500' : 'bg-red-500')} />
                <p className="font-semibold text-sm truncate">{item.hook.name}</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground pl-5">
                gateway hook{item.hook.hasHandler ? '' : ' · handler missing'}
              </p>
            </button>
          );
        }
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              'w-full text-left p-4 transition-colors',
              selectedId === item.id ? 'bg-primary/5' : 'hover:bg-muted/50',
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500 shrink-0" />
              <p className="font-semibold text-sm truncate">{item.plugin.name}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400">plugin</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground pl-5">
              {item.plugin.source === 'user' ? 'user' : 'project'} · hook-capable
            </p>
          </button>
        );
      })}
    </div>
  );
}

/* ── Hook Detail ────────────────────────────────── */

function HookDetail({ hooks, hookCapablePlugins, selectedId }: {
  hooks: HookInfo[]; hookCapablePlugins: PluginInfo[]; selectedId: string | null;
}) {
  if (!selectedId) {
    return <p className="text-sm text-muted-foreground italic py-12 text-center">Select a hook or plugin to view details.</p>;
  }

  // Gateway hook
  if (selectedId.startsWith('hook:')) {
    const hook = hooks.find(h => `hook:${h.path}` === selectedId);
    if (!hook) return <p className="text-sm text-muted-foreground italic py-12 text-center">Hook not found.</p>;

    return (
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <span className={cn('h-3 w-3 rounded-full', hook.hasHandler ? 'bg-green-500' : 'bg-red-500')} />
          <h3 className="text-lg font-bold">{hook.name}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">gateway</span>
        </div>

        <div className="space-y-4">
          {hook.description && <p className="text-sm text-muted-foreground">{hook.description}</p>}
          <DetailRow label="Handler" value={hook.hasHandler ? 'HOOK.yaml + handler.py present' : 'Missing handler'} />
          {(hook.events || []).length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Events</p>
              <div className="flex flex-wrap gap-2">
                {hook.events!.map(e => (
                  <span key={e} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{e}</span>
                ))}
              </div>
            </div>
          )}
          <DetailRow label="Path" value={hook.path} mono />
        </div>
      </div>
    );
  }

  // Plugin hook
  if (selectedId.startsWith('plugin-hook:')) {
    const plugin = hookCapablePlugins.find(p => `plugin-hook:${p.path}` === selectedId);
    if (!plugin) return <p className="text-sm text-muted-foreground italic py-12 text-center">Plugin not found.</p>;

    return (
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <span className="h-3 w-3 rounded-full bg-sky-500" />
          <h3 className="text-lg font-bold">{plugin.name}</h3>
          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">plugin hook</span>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {plugin.description || 'Active plugin that can register hooks via __init__.py.'}
          </p>
          <DetailRow label="Version" value={plugin.version ? `v${plugin.version}` : 'unknown'} />
          <DetailRow label="Source" value={plugin.source === 'user' ? '~/.hermes/plugins' : './.hermes/plugins'} />
          <DetailRow label="Path" value={plugin.path} mono />
        </div>
      </div>
    );
  }

  return null;
}

/* ── Shared helpers ─────────────────────────────── */

function TabButton({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label} <span className="text-xs ml-1 opacity-60">({count})</span>
    </button>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <span className={cn('text-sm font-medium', mono && 'font-mono text-xs break-all')}>{value}</span>
    </div>
  );
}

function MetaTag({ children, active = true }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span className={cn(
      'rounded-full px-2 py-1 text-[10px]',
      active ? 'bg-green-500/10 text-green-400' : 'bg-red-500/8 text-destructive',
    )}>
      {active ? '✓ ' : '✗ '}{children}
    </span>
  );
}
