import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { AxiosError } from 'axios';
import { Save, Settings, RefreshCw, Zap, Eye, MessageSquare, AlertTriangle, DatabaseZap } from 'lucide-react';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { useGatewayContext } from '../contexts/GatewayContext';
import { useRuntimeStatus } from '../hooks/useRuntimeStatus';
import * as api from '../api';
import { cn, formatUptime } from '../lib/utils';
import type { HermesConfig } from '../types';

type NestedConfigNode = Record<string, unknown>;

export function ConfigPage() {
  const gateway = useGatewayContext();
  const { status: runtimeStatus } = useRuntimeStatus(gateway);
  const [config, setConfig] = useState<HermesConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.config.get().then(res => setConfig(res.data)).catch(console.error);
  }, []);

  const update = (path: string[], value: unknown) => {
    if (!config) return;
    const next = structuredClone(config);
    let obj: NestedConfigNode = next as NestedConfigNode;
    for (let i = 0; i < path.length - 1; i++) {
      const current = obj[path[i]];
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        obj[path[i]] = {};
      }
      obj = obj[path[i]] as NestedConfigNode;
    }
    obj[path[path.length - 1]] = value;
    setConfig(next);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.config.save(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e as AxiosError);
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <motion.div
      key="config"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-6xl space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Runtime</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Gateway status, alerts, and config.yaml settings.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-bold transition-all shadow-xl',
            saved ? 'bg-success text-primary-foreground' : 'bg-primary text-primary-foreground',
            saving && 'opacity-40',
          )}
        >
          {saving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : saved ? (
            'Saved'
          ) : (
            <>
              <Save size={16} /> Save
            </>
          )}
        </button>
      </div>

      {/* Runtime status bar */}
      {(() => {
        const platforms = gateway.state ? Object.entries(gateway.state.platforms) : [];
        const fatal = platforms.filter(([, p]) => p.state === 'fatal');
        const alerts: string[] = [];
        if (gateway.builderStatus !== 'online') alerts.push('Desktop backend offline');
        if (gateway.health !== 'online' && gateway.health !== 'direct') alerts.push('Gateway unreachable');
        if (fatal.length > 0) alerts.push(`${fatal.length} platform(s) in fatal state`);

        return (
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
            <StatusBadge status={runtimeStatus} size="md" />
            {gateway.state?.start_time && (
              <span className="text-[11px] text-muted-foreground">
                up {formatUptime(String(gateway.state.start_time), gateway.state.updated_at)}
              </span>
            )}
            <span className="text-[11px] font-mono text-muted-foreground/50">
              :{gateway.processStatus?.port || 8642}
            </span>
            {gateway.state && (
              <span className="text-[11px] text-muted-foreground/40">
                PID {gateway.state.pid}
              </span>
            )}
            {alerts.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <AlertTriangle size={12} className="text-warning" />
                <span className="text-[11px] text-warning">{alerts.join(' · ')}</span>
              </div>
            )}
            {alerts.length === 0 && (
              <span className="text-[11px] text-success/60 ml-auto">No alerts</span>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card className="p-6">
          <SectionTitle icon={<Zap size={16} />} title="Backend Terminal" />
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Backend</label>
              <div className="flex flex-wrap gap-2">
                {['local', 'docker', 'ssh', 'singularity', 'modal', 'daytona'].map(mode => (
                  <button
                    key={mode}
                    onClick={() => update(['terminal', 'backend'], mode)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all',
                      config.terminal?.backend === mode
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : 'bg-muted text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Working directory" value={config.terminal?.cwd || ''} onChange={v => update(['terminal', 'cwd'], v)} />
            <Field
              label="Timeout (seconds)"
              type="number"
              value={String(config.terminal?.timeout ?? 180)}
              onChange={v => update(['terminal', 'timeout'], parseInt(v, 10) || 180)}
            />
            {config.terminal?.backend === 'docker' && (
              <Field label="Docker image" value={config.terminal?.docker_image || ''} onChange={v => update(['terminal', 'docker_image'], v)} />
            )}
            {config.terminal?.backend === 'singularity' && (
              <Field label="Singularity image" value={config.terminal?.singularity_image || ''} onChange={v => update(['terminal', 'singularity_image'], v)} />
            )}
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<Settings size={16} />} title="Container Resources" />
          <Field
            label="CPU"
            type="number"
            value={String(config.terminal?.container_cpu ?? 1)}
            onChange={v => update(['terminal', 'container_cpu'], parseInt(v, 10) || 1)}
          />
          <Field
            label="Memory (MB)"
            type="number"
            value={String(config.terminal?.container_memory ?? 5120)}
            onChange={v => update(['terminal', 'container_memory'], parseInt(v, 10) || 5120)}
          />
          <Field
            label="Disk (MB)"
            type="number"
            value={String(config.terminal?.container_disk ?? 51200)}
            onChange={v => update(['terminal', 'container_disk'], parseInt(v, 10) || 51200)}
          />
          <Toggle
            label="Persistent filesystem"
            checked={config.terminal?.container_persistent ?? true}
            onChange={v => update(['terminal', 'container_persistent'], v)}
          />
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<Settings size={16} />} title="LLM Model" />
          <Field label="Default model" value={config.model?.default || ''} onChange={v => update(['model', 'default'], v)} />
          <Field label="Provider" value={config.model?.provider || ''} onChange={v => update(['model', 'provider'], v)} />
          <Field label="Base URL" value={config.model?.base_url || ''} onChange={v => update(['model', 'base_url'], v)} />
          <Field
            label="Context window"
            value={String(config.model?.context_window ?? '')}
            onChange={v => update(['model', 'context_window'], v.trim() || undefined)}
          />
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            Optional. Examples: <span className="font-mono">128000</span>, <span className="font-mono">128k</span>, <span className="font-mono">1m</span>. Used by the Chat page context meter.
          </p>
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<RefreshCw size={16} />} title="Reset Policy" />
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Mode</label>
              <div className="flex gap-2">
                {['daily', 'idle', 'both', 'none'].map(mode => (
                  <button
                    key={mode}
                    onClick={() => update(['session_reset', 'mode'], mode)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all',
                      config.session_reset?.mode === mode
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : 'bg-muted text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            {(config.session_reset?.mode === 'daily' || config.session_reset?.mode === 'both') && (
              <Field
                label="Reset hour (0-23)"
                type="number"
                value={String(config.session_reset?.at_hour ?? 4)}
                onChange={v => update(['session_reset', 'at_hour'], parseInt(v, 10) || 0)}
              />
            )}
            {(config.session_reset?.mode === 'idle' || config.session_reset?.mode === 'both') && (
              <Field
                label="Idle time before reset (minutes)"
                type="number"
                value={String(config.session_reset?.idle_minutes ?? 1440)}
                onChange={v => update(['session_reset', 'idle_minutes'], parseInt(v, 10) || 60)}
              />
            )}
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<Zap size={16} />} title="Streaming" />
          <Toggle
            label="Streaming enabled"
            checked={config.streaming?.enabled || false}
            onChange={v => update(['streaming', 'enabled'], v)}
          />
          {config.streaming?.enabled && (
            <>
              <Field
                label="Edit interval (sec)"
                type="number"
                value={String(config.streaming?.edit_interval ?? 0.3)}
                onChange={v => update(['streaming', 'edit_interval'], parseFloat(v) || 0.3)}
              />
              <Field
                label="Buffer threshold (chars)"
                type="number"
                value={String(config.streaming?.buffer_threshold ?? 40)}
                onChange={v => update(['streaming', 'buffer_threshold'], parseInt(v, 10) || 40)}
              />
            </>
          )}
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<Eye size={16} />} title="Display" />
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Tool progress</label>
              <div className="flex flex-wrap gap-2">
                {['off', 'new', 'all', 'verbose'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => update(['display', 'tool_progress'], opt)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all',
                      config.display?.tool_progress === opt ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">Background notifications</label>
              <div className="flex flex-wrap gap-2">
                {['all', 'result', 'error', 'off'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => update(['display', 'background_process_notifications'], opt)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all',
                      config.display?.background_process_notifications === opt ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<MessageSquare size={16} />} title="General Settings" />
          <Toggle
            label="Group session isolation"
            checked={config.group_sessions_per_user ?? true}
            onChange={v => update(['group_sessions_per_user'], v)}
          />
          <Toggle
            label="STT (speech recognition)"
            checked={config.stt?.enabled ?? false}
            onChange={v => update(['stt', 'enabled'], v)}
          />
          <div className="mt-4">
            <label className="mb-2 block text-xs text-muted-foreground">Unauthorized DM behavior</label>
            <div className="flex gap-2">
              {['pair', 'ignore'].map(opt => (
                <button
                  key={opt}
                  onClick={() => update(['unauthorized_dm_behavior'], opt)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all',
                    config.unauthorized_dm_behavior === opt ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted',
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Memory Backend */}
      <Card className="p-6">
        <SectionTitle icon={<DatabaseZap size={16} />} title="Memory Backend" />
        <p className="mb-4 text-xs text-muted-foreground">Choose how Hermes persists and retrieves memory across sessions.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { mode: 'builtin', title: 'Builtin', badge: 'Minimal', summary: 'MEMORY.md + USER.md files only. No extra service.', provider: '' },
            { mode: 'holographic', title: 'Local SQLite', badge: 'Local', summary: 'Local SQLite database, no separate service required.', provider: 'holographic' },
            { mode: 'openviking', title: 'Advanced', badge: 'External', summary: 'Enhanced retrieval with an external memory service.', provider: 'openviking' },
          ].map(item => {
            const active = (config.memory?.provider || '') === item.provider;
            return (
              <div key={item.mode} className={cn('rounded-xl border p-4 transition-colors', active ? 'border-primary/25 bg-primary/[0.03]' : 'border-border/50')}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{item.title}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{item.badge}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{item.summary}</p>
                <button
                  onClick={() => update(['memory', 'provider'], item.provider || undefined)}
                  className={cn(
                    'w-full py-1.5 rounded-lg text-xs font-medium transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  {active ? '● Active' : 'Use'}
                </button>
              </div>
            );
          })}
        </div>
      </Card>
    </motion.div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h3 className="mb-5 flex items-center gap-2 text-base font-bold">
      <span className="text-primary">{icon}</span> {title}
    </h3>
  );
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        title={label}
        placeholder={label}
        className="w-full rounded-lg border border-border bg-muted px-4 py-2.5 font-mono text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        title={label}
        aria-label={label}
        className={cn(
          'relative h-5 w-10 rounded-full transition-all',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
