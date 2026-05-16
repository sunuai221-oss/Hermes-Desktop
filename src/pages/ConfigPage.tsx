import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { AxiosError } from 'axios';
import { Save, Settings, RefreshCw, Zap, Eye, MessageSquare, AlertTriangle, DatabaseZap, Activity, FileText, ShieldCheck, Archive, Copy, GitBranchPlus } from 'lucide-react';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { useGatewayContext } from '../contexts/GatewayContext';
import { useRuntimeStatus } from '../hooks/useRuntimeStatus';
import * as api from '../api';
import { cn, formatUptime } from '../lib/utils';
import type { HermesConfig } from '../types';

type NestedConfigNode = Record<string, unknown>;
type DiagnosticsAction = 'health' | 'logs' | 'doctor' | 'dump' | 'backup';

interface DiagnosticsSnapshot {
  processStatus?: {
    status?: string;
    gateway_state?: string;
    port?: number | null;
    pid?: number;
    managed?: boolean;
    status_source?: string;
    gateway_url?: string;
  } | null;
  health?: { status?: string; [key: string]: unknown } | null;
  detailedHealth?: unknown;
  detailedHealthEndpoint?: string | null;
  logs?: {
    path?: string | null;
    updatedAt?: string | null;
    sizeBytes?: number;
    truncated?: boolean;
    content?: string;
    note?: string;
  } | null;
}

export function ConfigPage() {
  const gateway = useGatewayContext();
  const { status: runtimeStatus } = useRuntimeStatus(gateway);
  const [config, setConfig] = useState<HermesConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [diagnosticsOutput, setDiagnosticsOutput] = useState('');
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState<Record<DiagnosticsAction, boolean>>({
    health: false,
    logs: false,
    doctor: false,
    dump: false,
    backup: false,
  });

  const setActionLoading = useCallback((action: DiagnosticsAction, loading: boolean) => {
    setDiagnosticsLoading(current => ({ ...current, [action]: loading }));
  }, []);

  const refreshDiagnostics = useCallback(async () => {
    setActionLoading('health', true);
    setDiagnosticsStatus(null);
    try {
      const response = await api.gateway.diagnostics();
      const snapshot = response.data as DiagnosticsSnapshot;
      setDiagnostics(snapshot);
      setDiagnosticsOutput(formatDiagnosticsSummary(snapshot));
      setDiagnosticsStatus({ tone: 'success', message: 'Health refreshed.' });
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not refresh diagnostics.';
      setDiagnosticsStatus({ tone: 'error', message });
    } finally {
      setActionLoading('health', false);
    }
  }, [setActionLoading]);

  useEffect(() => {
    api.config.get().then(res => setConfig(res.data)).catch(console.error);
    void refreshDiagnostics();
  }, [refreshDiagnostics]);

  const update = (path: string[], value: unknown) => {
    setConfig(currentConfig => {
      if (!currentConfig) return currentConfig;
      const next = structuredClone(currentConfig);
      let obj: NestedConfigNode = next as NestedConfigNode;
      for (let i = 0; i < path.length - 1; i++) {
        const current = obj[path[i]];
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          obj[path[i]] = {};
        }
        obj = obj[path[i]] as NestedConfigNode;
      }
      obj[path[path.length - 1]] = value;
      return next;
    });
  };

  const updateTts = (path: string[], value: unknown) => {
    update(['tts', ...path], value);
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

  const viewLogs = useCallback(async () => {
    setActionLoading('logs', true);
    setDiagnosticsStatus(null);
    try {
      const response = await api.gateway.diagnosticsLogs();
      const logs = response.data as DiagnosticsSnapshot['logs'];
      setDiagnostics(current => ({ ...(current || {}), logs: logs || null }));
      setDiagnosticsOutput(formatLogsOutput(logs || null));
      setDiagnosticsStatus({ tone: 'success', message: 'Logs loaded.' });
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not read gateway logs.';
      setDiagnosticsStatus({ tone: 'error', message });
    } finally {
      setActionLoading('logs', false);
    }
  }, [setActionLoading]);

  const runDiagnosticCommand = useCallback(async (
    action: Extract<DiagnosticsAction, 'doctor' | 'dump' | 'backup'>,
    request: () => Promise<{ data: Record<string, unknown>; status?: number }>,
  ) => {
    setActionLoading(action, true);
    setDiagnosticsStatus(null);
    try {
      const response = await request();
      const payload = response.data || {};
      setDiagnosticsOutput(formatCommandOutput(payload));
      const failed = payload.ok === false || (typeof response.status === 'number' && response.status >= 400);
      if (failed) {
        const message = typeof payload.error === 'string' ? payload.error : `${action} failed.`;
        setDiagnosticsStatus({ tone: 'error', message });
      } else {
        setDiagnosticsStatus({ tone: 'success', message: `${action} completed.` });
      }
    } catch (error) {
      const axiosError = error as AxiosError<Record<string, unknown>>;
      const payload = axiosError.response?.data;
      if (payload && typeof payload === 'object') {
        setDiagnosticsOutput(formatCommandOutput(payload));
      }
      const message = typeof payload?.error === 'string'
        ? payload.error
        : axiosError.code === 'ECONNABORTED'
          ? `${action} timed out before Hermes returned output.`
          : `${action} failed.`;
      setDiagnosticsStatus({ tone: 'error', message });
    } finally {
      setActionLoading(action, false);
    }
  }, [setActionLoading]);

  const copyDiagnosticsOutput = useCallback(async () => {
    const text = diagnosticsOutput.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setDiagnosticsStatus({ tone: 'success', message: 'Diagnostics output copied.' });
    } catch {
      setDiagnosticsStatus({ tone: 'error', message: 'Clipboard copy failed.' });
    }
  }, [diagnosticsOutput]);

  if (!config) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-3 border-primary border-t-transparent" />
      </div>
    );
  }

  const ttsProvider = config.tts?.provider || 'neutts-server';

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

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Activity size={16} className="text-primary" />
              Diagnostics
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Health, process state, logs, and Hermes runtime checks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={<RefreshCw size={13} className={diagnosticsLoading.health ? 'animate-spin' : ''} />}
              label="Refresh health"
              loading={diagnosticsLoading.health}
              onClick={() => void refreshDiagnostics()}
            />
            <ActionButton
              icon={<FileText size={13} />}
              label="View logs"
              loading={diagnosticsLoading.logs}
              onClick={() => void viewLogs()}
            />
            <ActionButton
              icon={<ShieldCheck size={13} />}
              label="Run doctor"
              loading={diagnosticsLoading.doctor}
              onClick={() => void runDiagnosticCommand('doctor', () => api.gateway.diagnosticsDoctor())}
            />
            <ActionButton
              icon={<FileText size={13} />}
              label="Generate dump"
              loading={diagnosticsLoading.dump}
              onClick={() => void runDiagnosticCommand('dump', () => api.gateway.diagnosticsDump())}
            />
            <ActionButton
              icon={<Archive size={13} />}
              label="Create backup"
              loading={diagnosticsLoading.backup}
              onClick={() => void runDiagnosticCommand('backup', () => api.gateway.diagnosticsBackup())}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2">
            process: <span className="font-mono text-foreground/80">{diagnostics?.processStatus?.status || 'unknown'}</span>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2">
            gateway: <span className="font-mono text-foreground/80">{String(diagnostics?.health?.status || 'offline')}</span>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2">
            pid: <span className="font-mono text-foreground/80">{diagnostics?.processStatus?.pid ?? 'n/a'}</span>
          </div>
          <div className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2">
            port: <span className="font-mono text-foreground/80">{diagnostics?.processStatus?.port ?? 'n/a'}</span>
          </div>
        </div>

        <div className="mt-3 rounded-md border border-border/50 bg-muted/20">
          <div className="flex items-center justify-between border-b border-border/40 px-2.5 py-1.5">
            <span className="text-[11px] text-muted-foreground">Output</span>
            <button
              onClick={() => void copyDiagnosticsOutput()}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Copy size={11} />
              Copy
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 text-[11px] leading-relaxed text-foreground/85 font-mono">
            {diagnosticsOutput || 'No diagnostics output yet.'}
          </pre>
        </div>

        {diagnosticsStatus && (
          <p className={cn(
            'mt-2 text-xs',
            diagnosticsStatus.tone === 'error' ? 'text-destructive' : 'text-success',
          )}>
            {diagnosticsStatus.message}
          </p>
        )}
      </Card>

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
            <Toggle
              label="Live2D avatar"
              checked={config.display?.live2d_enabled ?? true}
              onChange={v => update(['display', 'live2d_enabled'], v)}
            />
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

        <Card className="p-6">
          <SectionTitle icon={<Settings size={16} />} title="Pawrtal Companion" />
          <div className="space-y-1">
            <Toggle
              label="Auto-start companion on session open"
              checked={config.pawrtal?.auto_start ?? false}
              onChange={v => update(['pawrtal', 'auto_start'], v)}
            />
            <Field
              label="Default companion id (optional)"
              value={config.pawrtal?.default_pet_id || ''}
              onChange={v => update(['pawrtal', 'default_pet_id'], v.trim() || undefined)}
              placeholder="veyra"
            />
            <Field
              label="Default session"
              value={config.pawrtal?.default_session || 'current'}
              onChange={v => update(['pawrtal', 'default_session'], v.trim() || 'current')}
              placeholder="current"
            />
            <Toggle
              label="Reset before auto-spawn"
              checked={config.pawrtal?.reset_before_spawn ?? true}
              onChange={v => update(['pawrtal', 'reset_before_spawn'], v)}
            />
            <p className="pt-1 text-[11px] text-muted-foreground/70">
              Shortcuts in chat: <span className="font-mono">/pawrtal veyra</span>, <span className="font-mono">/pawrtal hide</span>, <span className="font-mono">/pawrtal switch &lt;id&gt;</span>, <span className="font-mono">/pawrtal reset [id]</span>.
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<Zap size={16} />} title="Speech (TTS)" />
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs text-muted-foreground">TTS provider</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'neutts-server', label: 'NeuTTS Server' },
                ].map(provider => (
                  <button
                    key={provider.id}
                    onClick={() => update(['tts', 'provider'], provider.id)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                      ttsProvider === provider.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {provider.label}
                  </button>
                ))}
              </div>
            </div>

            {ttsProvider === 'neutts-server' && (
              <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-3">
                <div>
                  <div className="text-sm font-semibold">NeuTTS server pipeline</div>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">
                    Hermes Desktop sends TTS requests to your already-running NeuTTS server via <span className="font-mono">POST /tts</span>. The French model uses the bundled <span className="font-mono">Juliette</span> reference voice.
                  </p>
                </div>
                <div className="rounded-lg bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                  Voice: <span className="font-mono text-foreground">Juliette</span>
                </div>
                <Field
                  label="NeuTTS server base URL"
                  value={String((config.tts?.neutts_server as { base_url?: string } | undefined)?.base_url || 'http://127.0.0.1:8020')}
                  onChange={v => updateTts(['neutts_server', 'base_url'], v.trim() || 'http://127.0.0.1:8020')}
                />
              </div>
            )}

          </div>
        </Card>
      </div>


        {/* Delegation Settings */}
        <Card className="p-6">
          <SectionTitle icon={<GitBranchPlus size={16} />} title="Delegation" />
          <p className="mb-4 text-xs text-muted-foreground">
            Default settings for subagent delegation. These values control max_iterations, toolsets, and model overrides when delegating tasks.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field
              label="Max iterations"
              type="number"
              value={String(config.delegation?.max_iterations ?? 50)}
              onChange={v => update(['delegation', 'max_iterations'], parseInt(v, 10) || 50)}
            />
            <Field
              label="Default toolsets"
              value={(config.delegation?.default_toolsets || ['terminal', 'file', 'web']).join(', ')}
              onChange={v => update(['delegation', 'default_toolsets'], v.split(',').map(s => s.trim()).filter(Boolean))}
              placeholder="terminal, file, web"
            />
            <Field
              label="Model override"
              value={config.delegation?.model || ''}
              onChange={v => update(['delegation', 'model'], v || undefined)}
              placeholder="google/gemini-2.0-flash"
            />
            <Field
              label="Provider override"
              value={config.delegation?.provider || ''}
              onChange={v => update(['delegation', 'provider'], v || undefined)}
              placeholder="nous"
            />
            <Field
              label="Base URL override"
              value={config.delegation?.base_url || ''}
              onChange={v => update(['delegation', 'base_url'], v || undefined)}
              placeholder="http://localhost:1234/v1"
            />
            <Field
              label="API key override"
              value={config.delegation?.api_key || ''}
              onChange={v => update(['delegation', 'api_key'], v || undefined)}
              placeholder="local-key"
            />
          </div>
        </Card>

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

function ActionButton({
  icon,
  label,
  loading,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/35 px-2.5 py-1.5 text-[11px] text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
    >
      {loading ? <RefreshCw size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function formatDiagnosticsSummary(snapshot: DiagnosticsSnapshot | null): string {
  if (!snapshot) return 'Diagnostics unavailable.';
  const parts = [
    `process status: ${snapshot.processStatus?.status || 'unknown'}`,
    `gateway status: ${String(snapshot.health?.status || 'offline')}`,
    `gateway state: ${snapshot.processStatus?.gateway_state || 'unknown'}`,
    `pid: ${snapshot.processStatus?.pid ?? 'n/a'}`,
    `port: ${snapshot.processStatus?.port ?? 'n/a'}`,
    `source: ${snapshot.processStatus?.status_source || 'unknown'}`,
  ];

  if (snapshot.detailedHealthEndpoint) {
    parts.push(`detailed endpoint: ${snapshot.detailedHealthEndpoint}`);
  }
  if (snapshot.logs?.path) {
    parts.push(`log file: ${snapshot.logs.path}`);
  }
  if (snapshot.logs?.note) {
    parts.push(snapshot.logs.note);
  }

  return parts.join('\n');
}

function formatLogsOutput(logs: DiagnosticsSnapshot['logs'] | null | undefined): string {
  if (!logs) return 'No logs returned.';
  const header = [
    `path: ${logs.path || 'n/a'}`,
    `updated: ${logs.updatedAt || 'n/a'}`,
    `size: ${typeof logs.sizeBytes === 'number' ? `${logs.sizeBytes} bytes` : 'n/a'}`,
    logs.truncated ? 'truncated: true' : 'truncated: false',
  ].join('\n');
  const body = String(logs.content || logs.note || '').trim();
  return body ? `${header}\n\n${body}` : header;
}

function formatCommandOutput(payload: Record<string, unknown>): string {
  const command = String(payload.command || 'hermes command');
  const distro = String(payload.distro || 'unknown');
  const status = payload.ok === false ? 'failed' : 'ok';
  const code = payload.code == null ? '' : `\ncode: ${String(payload.code)}`;
  const stdout = String(payload.stdout || '').trim();
  const stderr = String(payload.stderr || '').trim();
  const chunks = [
    `command: ${command}`,
    `distro: ${distro}`,
    `status: ${status}${code}`,
  ];
  if (stdout) chunks.push(`stdout:\n${stdout}`);
  if (stderr) chunks.push(`stderr:\n${stderr}`);
  return chunks.join('\n\n');
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        title={label}
        placeholder={placeholder || label}
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
