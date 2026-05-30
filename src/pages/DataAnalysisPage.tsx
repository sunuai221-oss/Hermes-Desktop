import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  FileSpreadsheet,
  Play,
  RefreshCw,
  Save,
  Send,
  Upload,
} from 'lucide-react';
import type { AxiosError } from 'axios';
import { Card } from '../components/Card';
import * as api from '../api';
import { setDraft } from '../features/chat/chatDraftBridge';
import { readBlobAsDataUrl } from '../hooks/chatMediaUtils';
import { cn } from '../lib/utils';
import type {
  HermesConfig,
  OpenPandasAiConnectorConfig,
  OpenPandasAiLogsResponse,
  OpenPandasAiRunResponse,
  OpenPandasAiStatusResponse,
} from '../types';

type ConnectorDraft = {
  enabled: boolean;
  mode: 'cli' | 'api';
  project_path: string;
  venv_path: string;
  python_executable: string;
  cli_module: string;
  api_base_url: string;
  request_timeout_ms: number;
};

const DEFAULT_CONNECTOR_DRAFT: ConnectorDraft = {
  enabled: false,
  mode: 'cli',
  project_path: '',
  venv_path: '',
  python_executable: '',
  cli_module: 'core.headless.cli',
  api_base_url: '',
  request_timeout_ms: 240000,
};

const RUN_ACTIVE_STATUSES = new Set(['queued', 'running']);
const ABSENT_CHECK_KEYS = new Set(['project_path', 'python_executable', 'api_base_url']);

type EngineUxState = {
  state: 'available' | 'launched' | 'error' | 'absent';
  label: string;
  detail: string;
};

function normalizeConnectorDraft(config: OpenPandasAiConnectorConfig | undefined): ConnectorDraft {
  return {
    enabled: Boolean(config?.enabled ?? false),
    mode: config?.mode === 'api' ? 'api' : 'cli',
    project_path: String(config?.project_path || ''),
    venv_path: String(config?.venv_path || ''),
    python_executable: String(config?.python_executable || ''),
    cli_module: String(config?.cli_module || 'core.headless.cli'),
    api_base_url: String(config?.api_base_url || ''),
    request_timeout_ms: Number(config?.request_timeout_ms || 240000),
  };
}

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toConnectorConfig(draft: ConnectorDraft): OpenPandasAiConnectorConfig {
  return {
    enabled: draft.enabled,
    mode: draft.mode,
    project_path: trimOrUndefined(draft.project_path),
    venv_path: trimOrUndefined(draft.venv_path),
    python_executable: trimOrUndefined(draft.python_executable),
    cli_module: trimOrUndefined(draft.cli_module) || 'core.headless.cli',
    api_base_url: trimOrUndefined(draft.api_base_url),
    request_timeout_ms: Number.isFinite(draft.request_timeout_ms)
      ? Math.max(10000, Math.trunc(draft.request_timeout_ms))
      : 240000,
  };
}

function bytesToLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  const axiosError = error as AxiosError<{ error?: string; details?: string }>;
  const data = axiosError?.response?.data;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function statusTone(status: OpenPandasAiStatusResponse['status']) {
  if (status === 'ready') return 'text-success';
  if (status === 'disabled') return 'text-muted-foreground';
  return 'text-warning';
}

function runTone(status: OpenPandasAiRunResponse['status']) {
  if (status === 'succeeded') return 'text-success';
  if (status === 'failed') return 'text-destructive';
  if (status === 'blocked') return 'text-warning';
  return 'text-primary';
}

function engineTone(state: EngineUxState['state']) {
  if (state === 'available') return 'text-success';
  if (state === 'launched') return 'text-primary';
  if (state === 'absent') return 'text-muted-foreground';
  return 'text-destructive';
}

function deriveEngineState(
  status: OpenPandasAiStatusResponse | null,
  run: OpenPandasAiRunResponse | null,
  statusError: string | null,
): EngineUxState {
  if (run && RUN_ACTIVE_STATUSES.has(run.status)) {
    return {
      state: 'launched',
      label: 'launched',
      detail: `Run ${run.runId} is currently ${run.status}.`,
    };
  }

  if (run && (run.status === 'failed' || run.status === 'blocked')) {
    return {
      state: 'error',
      label: 'error',
      detail: `Last run ended with ${run.status}.`,
    };
  }

  if (statusError) {
    return {
      state: 'error',
      label: 'error',
      detail: statusError,
    };
  }

  if (!status) {
    return {
      state: 'absent',
      label: 'absent',
      detail: 'Open_Pandas_AI status is not loaded yet.',
    };
  }

  if (status.status === 'ready') {
    return {
      state: 'available',
      label: 'available',
      detail: 'Connector checks are healthy.',
    };
  }

  if (status.status === 'disabled') {
    return {
      state: 'absent',
      label: 'absent',
      detail: 'Connector is disabled in config.yaml.',
    };
  }

  const missingCoreDependency = status.checks.some(check => !check.ok && ABSENT_CHECK_KEYS.has(check.key));
  if (missingCoreDependency) {
    return {
      state: 'absent',
      label: 'absent',
      detail: 'Core Open_Pandas_AI path/runtime is missing.',
    };
  }

  return {
    state: 'error',
    label: 'error',
    detail: 'Runtime checks failed. Review failing checks below.',
  };
}

function checkActionHint(check: OpenPandasAiStatusResponse['checks'][number]): string | null {
  if (check.ok) return null;
  if (check.key === 'project_path') {
    return 'Set open_pandas_ai.project_path to your Open_Pandas_AI folder, then save.';
  }
  if (check.key === 'python_executable') {
    return 'Set a valid python_executable or venv_path in connector settings.';
  }
  if (check.key === 'venv_path') {
    return 'Point venv_path to your Open_Pandas_AI virtual environment root.';
  }
  if (check.key === 'api_base_url') {
    return 'Set a localhost API URL (example: http://127.0.0.1:8081) and save.';
  }
  if (check.key === 'api_health') {
    return 'Start the Open_Pandas_AI API service and verify /health responds.';
  }
  if (check.key === 'liteparse') {
    return 'Install server dependencies on Windows (`npm run install:server`) to restore document parsing.';
  }
  return null;
}

function stringifyForDraft(value: unknown, maxChars = 2400): string {
  let raw = '';
  try {
    raw = JSON.stringify(value, null, 2);
  } catch {
    raw = String(value ?? '');
  }
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n...`;
}

type PreviewBarPoint = {
  label: string;
  value: number;
};

function buildPreviewBars(preview: { columns: string[]; rows: Record<string, unknown>[] } | null): PreviewBarPoint[] {
  if (!preview || preview.columns.length === 0 || preview.rows.length === 0) return [];
  const numericColumn = preview.columns.find(column => (
    preview.rows.some(row => Number.isFinite(Number(row[column])))
  ));
  if (!numericColumn) return [];

  const preferredLabelColumn = preview.columns.find(column => column !== numericColumn)
    || preview.columns[0]
    || numericColumn;

  const bars = preview.rows.slice(0, 8).map((row, index) => {
    const numeric = Number(row[numericColumn]);
    if (!Number.isFinite(numeric)) return null;
    const rawLabel = row[preferredLabelColumn];
    const label = String(rawLabel ?? `Row ${index + 1}`).trim() || `Row ${index + 1}`;
    return { label, value: numeric };
  }).filter((item): item is PreviewBarPoint => Boolean(item));
  return bars;
}

export function DataAnalysisPage() {
  const navigate = useNavigate();
  const [fullConfig, setFullConfig] = useState<HermesConfig | null>(null);
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft>(DEFAULT_CONNECTOR_DRAFT);
  const [status, setStatus] = useState<OpenPandasAiStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [question, setQuestion] = useState('');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [loadAllSheets, setLoadAllSheets] = useState(false);
  const [language, setLanguage] = useState('fr');

  const [run, setRun] = useState<OpenPandasAiRunResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStarting, setRunStarting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [draftSent, setDraftSent] = useState(false);
  const [connectorLogs, setConnectorLogs] = useState<OpenPandasAiLogsResponse | null>(null);
  const [connectorLogsLoading, setConnectorLogsLoading] = useState(false);
  const [connectorLogsError, setConnectorLogsError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const response = await api.openPandasAi.status();
      setStatus(response.data);
    } catch (error) {
      setStatusError(extractErrorMessage(error, 'Could not fetch Open_Pandas_AI status.'));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadConnectorConfig = useCallback(async () => {
    try {
      const response = await api.config.get();
      const nextConfig = (response.data || {}) as HermesConfig;
      setFullConfig(nextConfig);
      setConnectorDraft(normalizeConnectorDraft(nextConfig.open_pandas_ai));
    } catch (error) {
      setStatusError(extractErrorMessage(error, 'Could not load config.yaml.'));
    }
  }, []);

  const loadConnectorLogs = useCallback(async () => {
    setConnectorLogsLoading(true);
    setConnectorLogsError(null);
    try {
      const response = await api.openPandasAi.logs(240);
      setConnectorLogs(response.data);
    } catch (error) {
      setConnectorLogsError(extractErrorMessage(error, 'Could not fetch Open_Pandas_AI logs.'));
    } finally {
      setConnectorLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnectorConfig();
    void refreshStatus();
  }, [loadConnectorConfig, refreshStatus]);

  useEffect(() => {
    if (!activeRunId) return undefined;
    let cancelled = false;

    async function pollRun(runId: string) {
      setPolling(true);
      while (!cancelled) {
        try {
          const response = await api.openPandasAi.run(runId);
          if (cancelled) return;
          setRun(response.data);
          if (!RUN_ACTIVE_STATUSES.has(response.data.status)) {
            setPolling(false);
            return;
          }
        } catch (error) {
          if (!cancelled) {
            setRunError(extractErrorMessage(error, 'Could not fetch Open_Pandas_AI run status.'));
            setPolling(false);
          }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    void pollRun(activeRunId);
    return () => {
      cancelled = true;
    };
  }, [activeRunId]);

  const saveConnectorConfig = useCallback(async () => {
    const nextRootConfig: HermesConfig = structuredClone(fullConfig || {});
    nextRootConfig.open_pandas_ai = toConnectorConfig(connectorDraft);
    setSaving(true);
    try {
      await api.config.save(nextRootConfig);
      setFullConfig(nextRootConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      await refreshStatus();
    } catch (error) {
      setStatusError(extractErrorMessage(error, 'Could not save Open_Pandas_AI connector config.'));
    } finally {
      setSaving(false);
    }
  }, [connectorDraft, fullConfig, refreshStatus]);

  const startRun = useCallback(async () => {
    if (!datasetFile) {
      setRunError('Select a CSV/XLSX dataset first. PDF is optional context, not the main dataset.');
      return;
    }
    if (!question.trim()) {
      setRunError('Write an analysis question first.');
      return;
    }

    setRunStarting(true);
    setRunError(null);
    setDraftSent(false);
    try {
      const dataUrl = await readBlobAsDataUrl(datasetFile);
      const documentDataUrl = documentFile ? await readBlobAsDataUrl(documentFile) : null;
      const options: Record<string, unknown> = {
        language,
      };
      if (selectedSheet.trim()) options.selected_sheet = selectedSheet.trim();
      if (loadAllSheets) options.load_all_sheets = true;

      const response = await api.openPandasAi.analyze({
        question: question.trim(),
        dataset: {
          fileName: datasetFile.name,
          dataUrl,
          mimeType: datasetFile.type || undefined,
        },
        document: documentDataUrl ? {
          fileName: documentFile?.name || 'document.pdf',
          dataUrl: documentDataUrl,
          mimeType: documentFile?.type || undefined,
        } : undefined,
        options,
      });

      setActiveRunId(response.data.runId);
      setRun(null);
    } catch (error) {
      setRunError(extractErrorMessage(error, 'Could not start Open_Pandas_AI analysis.'));
    } finally {
      setRunStarting(false);
    }
  }, [datasetFile, documentFile, language, loadAllSheets, question, selectedSheet]);

  const resultPayload = useMemo<Record<string, unknown> | null>(
    () => (isRecord(run?.result) ? run.result : null),
    [run],
  );

  const summaryText = useMemo(() => {
    if (!resultPayload) return '';
    const summary = isRecord(resultPayload.summary) ? resultPayload.summary : null;
    if (summary && typeof summary.text === 'string') return summary.text;
    return '';
  }, [resultPayload]);

  const generatedCode = useMemo(() => {
    if (!resultPayload) return '';
    return typeof resultPayload.generated_code === 'string'
      ? resultPayload.generated_code
      : '';
  }, [resultPayload]);

  const dataframePreview = useMemo(() => {
    if (!resultPayload) return null;
    const preview = isRecord(resultPayload.dataframe_preview) ? resultPayload.dataframe_preview : null;
    if (!preview) return null;
    const columns = Array.isArray(preview.columns)
      ? preview.columns.filter(item => typeof item === 'string')
      : [];
    const rows = Array.isArray(preview.head)
      ? preview.head.filter(item => isRecord(item))
      : [];
    return { columns, rows };
  }, [resultPayload]);

  const previewBars = useMemo(
    () => buildPreviewBars(dataframePreview),
    [dataframePreview],
  );

  const chartSpecs = useMemo(() => {
    if (!resultPayload || !Array.isArray(resultPayload.charts)) return [];
    return resultPayload.charts.filter(item => isRecord(item));
  }, [resultPayload]);

  const engineState = useMemo(
    () => deriveEngineState(status, run, statusError),
    [run, status, statusError],
  );

  const sendToAgentChat = useCallback(() => {
    if (!run) return;
    const lines: string[] = [
      '# Data Analysis Result',
      '',
      `Run: ${run.runId}`,
      `Engine status: ${run.engineStatus}`,
      '',
      '## Question',
      run.question,
    ];
    if (summaryText.trim()) {
      lines.push('', '## Summary', summaryText.trim());
    }
    if (dataframePreview && dataframePreview.columns.length > 0) {
      lines.push('', '## DataFrame Preview');
      lines.push(stringifyForDraft({
        columns: dataframePreview.columns,
        rows: dataframePreview.rows.slice(0, 6),
      }, 2000));
    }
    if (generatedCode.trim()) {
      lines.push('', '## Generated Code', '```python', generatedCode.trim(), '```');
    }
    if (run.error?.message) {
      lines.push('', '## Error', run.error.message);
    }
    lines.push('', 'Continue from this result and propose the next best analytical action.');

    setDraft({
      source: 'data-analysis',
      text: lines.join('\n'),
      metadata: {
        runId: run.runId,
        engineStatus: run.engineStatus,
      },
    });
    setDraftSent(true);
    navigate('/chat');
  }, [dataframePreview, generatedCode, navigate, run, summaryText]);

  return (
    <motion.div
      key="data-analysis"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-6xl space-y-6"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Data Analysis</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Centralized Open_Pandas_AI cockpit for CSV/XLSX analysis with optional PDF context.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('rounded-md border border-border/70 px-2.5 py-1 text-xs font-semibold uppercase', engineTone(engineState.state))}>
            engine: {engineState.label}
          </span>
          <button
            onClick={() => void refreshStatus()}
            disabled={statusLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs font-semibold hover:bg-muted/40 disabled:opacity-45"
          >
            <RefreshCw size={14} className={cn(statusLoading && 'animate-spin')} />
            Refresh status
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Connector</h3>
            <button
              onClick={() => void saveConnectorConfig()}
              disabled={saving}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                saved ? 'bg-success text-primary-foreground' : 'bg-primary text-primary-foreground',
                saving && 'opacity-50',
              )}
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              {saved ? 'Saved' : 'Save'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setConnectorDraft(current => ({ ...current, enabled: !current.enabled }))}
              className={cn(
                'rounded-md px-3 py-2 text-xs font-semibold transition-colors',
                connectorDraft.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
              )}
            >
              {connectorDraft.enabled ? 'Enabled' : 'Disabled'}
            </button>
            <div className="flex rounded-md border border-border/70 p-0.5">
              {(['cli', 'api'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setConnectorDraft(current => ({ ...current, mode }))}
                  className={cn(
                    'flex-1 rounded-sm px-2 py-1.5 text-xs font-semibold uppercase transition-colors',
                    connectorDraft.mode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <Field
            label="project_path"
            value={connectorDraft.project_path}
            onChange={value => setConnectorDraft(current => ({ ...current, project_path: value }))}
            placeholder="C:\\Users\\...\\Open_Pandas_AI"
          />
          <Field
            label="venv_path"
            value={connectorDraft.venv_path}
            onChange={value => setConnectorDraft(current => ({ ...current, venv_path: value }))}
            placeholder="C:\\Users\\...\\Open_Pandas_AI\\.venv"
          />
          <Field
            label="python_executable"
            value={connectorDraft.python_executable}
            onChange={value => setConnectorDraft(current => ({ ...current, python_executable: value }))}
            placeholder="python or C:\\...\\python.exe"
          />
          <Field
            label="cli_module"
            value={connectorDraft.cli_module}
            onChange={value => setConnectorDraft(current => ({ ...current, cli_module: value }))}
            placeholder="core.headless.cli"
          />
          <Field
            label="api_base_url"
            value={connectorDraft.api_base_url}
            onChange={value => setConnectorDraft(current => ({ ...current, api_base_url: value }))}
            placeholder="http://127.0.0.1:8081"
          />
          <Field
            label="request_timeout_ms"
            type="number"
            value={String(connectorDraft.request_timeout_ms)}
            onChange={value => {
              const parsed = Number(value);
              setConnectorDraft(current => ({
                ...current,
                request_timeout_ms: Number.isFinite(parsed) ? parsed : current.request_timeout_ms,
              }));
            }}
          />
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Engine Status</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadConnectorLogs()}
                disabled={connectorLogsLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-[11px] font-semibold hover:bg-muted/30 disabled:opacity-50"
              >
                <FileText size={12} />
                {connectorLogsLoading ? 'Loading logs' : 'Load logs'}
              </button>
              <span className={cn('text-xs font-semibold uppercase', engineTone(engineState.state))}>
                {engineState.label}
              </span>
            </div>
          </div>

          {!status && !statusError && (
            <p className="text-xs text-muted-foreground">No status loaded yet.</p>
          )}

          {statusError && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
              {statusError}
            </div>
          )}

          {status && (
            <>
              <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">
                  state detail: <span className="text-foreground">{engineState.detail}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  connector_status: <span className={cn('font-mono', statusTone(status.status))}>{status.status}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  mode: <span className="font-mono text-foreground">{status.mode}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  timeout: <span className="font-mono text-foreground">{String(status.config.request_timeout_ms || 0)} ms</span>
                </p>
                {status.log_path && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    log: <span className="font-mono text-foreground">{status.log_path}</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                {status.checks.length === 0 && (
                  <p className="text-xs text-muted-foreground">No runtime checks reported.</p>
                )}
                {status.checks.map(check => (
                  <div
                    key={check.key}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs',
                      check.ok ? 'border-success/30 bg-success/5' : 'border-warning/40 bg-warning/10',
                    )}
                  >
                    {check.ok ? (
                      <CheckCircle2 size={13} className="mt-0.5 text-success" />
                    ) : (
                      <AlertTriangle size={13} className="mt-0.5 text-warning" />
                    )}
                    <div>
                      <p className="font-semibold">
                        {check.key}
                        {check.required === false && (
                          <span className="ml-1 text-[10px] font-normal uppercase text-muted-foreground">(optional)</span>
                        )}
                      </p>
                      <p className="text-muted-foreground">{check.message}</p>
                      {!check.ok && checkActionHint(check) && (
                        <p className="mt-1 text-[11px] text-foreground/85">
                          action: {checkActionHint(check)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {connectorLogsError && (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 p-2 text-xs text-destructive">
                  {connectorLogsError}
                </div>
              )}
              {connectorLogs && (connectorLogs.content || connectorLogs.note) && (
                <div className="rounded-md border border-border/60 bg-muted/10">
                  <div className="border-b border-border/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    connector_logs
                  </div>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap px-2.5 py-2 text-[11px] leading-relaxed text-foreground/85 font-mono">
                    {connectorLogs.content || connectorLogs.note || ''}
                  </pre>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Run Analysis</h3>
          <button
            onClick={() => void startRun()}
            disabled={runStarting || polling}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold',
              runStarting || polling
                ? 'bg-primary/40 text-primary-foreground'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {runStarting ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {runStarting ? 'Starting' : polling ? 'Running' : 'Run'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">Dataset (CSV/XLSX)</label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-5 text-xs text-muted-foreground hover:bg-muted/30">
              <Upload size={14} />
              <span>{datasetFile ? datasetFile.name : 'Choose CSV/XLSX/JSON/PARQUET dataset file'}</span>
              <input
                type="file"
                className="hidden"
                accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm,.json,.parquet"
                onChange={event => {
                  const nextFile = event.target.files?.[0] || null;
                  setDatasetFile(nextFile);
                }}
              />
            </label>
            {datasetFile && (
              <div className="flex items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <FileSpreadsheet size={13} />
                <span>{datasetFile.name}</span>
                <span className="font-mono">{bytesToLabel(datasetFile.size)}</span>
              </div>
            )}

            <label className="block text-xs text-muted-foreground">Document Context (PDF optional)</label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground hover:bg-muted/30">
              <FileText size={14} />
              <span>{documentFile ? documentFile.name : 'Attach a PDF context document'}</span>
              <input
                type="file"
                className="hidden"
                accept=".pdf"
                onChange={event => {
                  const nextFile = event.target.files?.[0] || null;
                  setDocumentFile(nextFile);
                }}
              />
            </label>
            {documentFile && (
              <div className="flex items-center gap-2 rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <FileText size={13} />
                <span>{documentFile.name}</span>
                <span className="font-mono">{bytesToLabel(documentFile.size)}</span>
              </div>
            )}

            <label className="block text-xs text-muted-foreground">Question</label>
            <textarea
              value={question}
              onChange={event => setQuestion(event.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/35"
              placeholder="Ex: Compare monthly sales trends and identify strongest region."
            />
          </div>

          <div className="space-y-3">
            <Field
              label="selected_sheet (optional)"
              value={selectedSheet}
              onChange={setSelectedSheet}
              placeholder="Sheet1"
            />
            <Field
              label="language"
              value={language}
              onChange={setLanguage}
              placeholder="fr"
            />
            <label className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-xs">
              <span className="text-muted-foreground">load_all_sheets</span>
              <button
                onClick={() => setLoadAllSheets(current => !current)}
                className={cn(
                  'h-5 w-10 rounded-full transition-colors',
                  loadAllSheets ? 'bg-primary' : 'bg-muted',
                )}
              >
                <span
                  className={cn(
                    'block h-4 w-4 rounded-full bg-white transition-transform',
                    loadAllSheets ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                />
              </button>
            </label>
            <div className="rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              PDF is parsed with LiteParse and sent as context. The main analysis still runs on tabular dataset inputs.
            </div>
          </div>
        </div>

        {runError && (
          <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {runError}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Run Output</h3>
          <div className="flex items-center gap-2">
            {run && (
              <span className={cn('text-xs font-semibold uppercase', runTone(run.status))}>
                {run.status}
              </span>
            )}
            <button
              onClick={() => sendToAgentChat()}
              disabled={!run}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={12} />
              Send To Agent Chat
            </button>
          </div>
        </div>

        {!run && (
          <p className="text-xs text-muted-foreground">
            No run yet. Start an analysis to see summary, preview, logs, and generated code.
          </p>
        )}

        {run && (
          <div className="space-y-4">
            {draftSent && (
              <div className="rounded-md border border-success/35 bg-success/10 px-3 py-2 text-xs text-success">
                Analysis handoff prepared and sent to Chat.
              </div>
            )}
            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
              <p className="text-muted-foreground">
                run_id: <span className="font-mono text-foreground">{run.runId}</span>
              </p>
              <p className="mt-1 text-muted-foreground">
                engine_status: <span className="font-mono text-foreground">{run.engineStatus}</span>
              </p>
              {run.document && (
                <p className="mt-1 text-muted-foreground">
                  document: <span className="font-mono text-foreground">{run.document.fileName}</span>
                </p>
              )}
            </div>

            {summaryText && (
              <div className="rounded-md border border-border/60 bg-muted/15 px-3 py-2 text-sm leading-relaxed">
                {summaryText}
              </div>
            )}

            {run.error?.message && (
              <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {run.error.message}
              </div>
            )}

            {dataframePreview && dataframePreview.columns.length > 0 && (
              <div className="overflow-auto rounded-md border border-border/60">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {dataframePreview.columns.map(column => (
                        <th key={column} className="whitespace-nowrap px-2 py-1.5 text-left font-semibold">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataframePreview.rows.slice(0, 8).map((row, index) => (
                      <tr key={index} className="border-t border-border/40">
                        {dataframePreview.columns.map(column => (
                          <td key={`${index}-${column}`} className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                            {String(row[column] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(previewBars.length > 0 || chartSpecs.length > 0) && (
              <div className="space-y-2 rounded-md border border-border/60 bg-muted/10 p-2.5">
                <div className="text-[11px] font-semibold uppercase text-muted-foreground">graph</div>
                {previewBars.length > 0 && (
                  <SimpleBarChart bars={previewBars} />
                )}
                {chartSpecs.length > 0 && (
                  <details className="rounded-md border border-border/50 bg-background/40 p-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      raw chart payload ({chartSpecs.length})
                    </summary>
                    <pre className="mt-2 max-h-52 overflow-auto text-[11px] leading-relaxed text-foreground/85 font-mono">
                      {stringifyForDraft(chartSpecs, 4000)}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {generatedCode && (
              <div className="rounded-md border border-border/60 bg-muted/10">
                <div className="border-b border-border/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  generated_code
                </div>
                <pre className="max-h-64 overflow-auto px-2.5 py-2 text-[11px] leading-relaxed text-foreground/90 font-mono">
                  {generatedCode}
                </pre>
              </div>
            )}

            {run.logs.length > 0 && (
              <div className="rounded-md border border-border/60 bg-muted/10">
                <div className="border-b border-border/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  logs
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-2.5 py-2 text-[11px] leading-relaxed text-foreground/85 font-mono">
                  {run.logs.slice(-20).map(entry => `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`).join('\n')}
                </pre>
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function SimpleBarChart({ bars }: { bars: PreviewBarPoint[] }) {
  if (!bars.length) return null;
  const maxValue = Math.max(...bars.map(item => Math.abs(item.value)), 1);

  return (
    <div className="space-y-1.5">
      {bars.map((bar, index) => {
        const widthPct = Math.max(4, (Math.abs(bar.value) / maxValue) * 100);
        return (
          <div key={`${bar.label}-${index}`} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2 text-[11px]">
            <div className="truncate text-muted-foreground" title={bar.label}>{bar.label}</div>
            <div className="h-2 rounded bg-muted">
              <div
                className="h-2 rounded bg-primary/70"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <div className="font-mono text-foreground/90">{bar.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        type={type}
        placeholder={placeholder || label}
        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/35"
      />
    </div>
  );
}
