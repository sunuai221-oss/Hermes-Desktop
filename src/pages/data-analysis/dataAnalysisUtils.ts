import type { AxiosError } from 'axios';
import type {
  OpenPandasAiConnectorConfig,
  OpenPandasAiRunResponse,
  OpenPandasAiStatusResponse,
} from '../../types';

export type ConnectorDraft = {
  enabled: boolean;
  mode: 'cli' | 'api';
  project_path: string;
  venv_path: string;
  python_executable: string;
  cli_module: string;
  api_base_url: string;
  request_timeout_ms: number;
};

export const DEFAULT_CONNECTOR_DRAFT: ConnectorDraft = {
  enabled: false,
  mode: 'cli',
  project_path: '',
  venv_path: '',
  python_executable: '',
  cli_module: 'core.headless.cli',
  api_base_url: '',
  request_timeout_ms: 240000,
};

export const RUN_ACTIVE_STATUSES = new Set(['queued', 'running']);

const ABSENT_CHECK_KEYS = new Set(['project_path', 'python_executable', 'api_base_url']);

export type EngineUxState = {
  state: 'available' | 'launched' | 'error' | 'absent';
  label: string;
  detail: string;
};

export type PreviewBarPoint = {
  label: string;
  value: number;
};

export function normalizeConnectorDraft(config: OpenPandasAiConnectorConfig | undefined): ConnectorDraft {
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

export function toConnectorConfig(draft: ConnectorDraft): OpenPandasAiConnectorConfig {
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

export function bytesToLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function extractErrorMessage(error: unknown, fallback: string): string {
  const axiosError = error as AxiosError<{ error?: string; details?: string }>;
  const data = axiosError?.response?.data;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (typeof data?.details === 'string' && data.details.trim()) return data.details;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function statusTone(status: OpenPandasAiStatusResponse['status']) {
  if (status === 'ready') return 'text-success';
  if (status === 'disabled') return 'text-muted-foreground';
  return 'text-warning';
}

export function runTone(status: OpenPandasAiRunResponse['status']) {
  if (status === 'succeeded') return 'text-success';
  if (status === 'failed') return 'text-destructive';
  if (status === 'blocked') return 'text-warning';
  return 'text-primary';
}

export function engineTone(state: EngineUxState['state']) {
  if (state === 'available') return 'text-success';
  if (state === 'launched') return 'text-primary';
  if (state === 'absent') return 'text-muted-foreground';
  return 'text-destructive';
}

export function deriveEngineState(
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

export function checkActionHint(check: OpenPandasAiStatusResponse['checks'][number]): string | null {
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

export function stringifyForDraft(value: unknown, maxChars = 2400): string {
  let raw = '';
  try {
    raw = JSON.stringify(value, null, 2);
  } catch {
    raw = String(value ?? '');
  }
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n...`;
}

export function buildPreviewBars(
  preview: { columns: string[]; rows: Record<string, unknown>[] } | null,
): PreviewBarPoint[] {
  if (!preview || preview.columns.length === 0 || preview.rows.length === 0) return [];
  const numericColumn = preview.columns.find(column => (
    preview.rows.some(row => Number.isFinite(Number(row[column])))
  ));
  if (!numericColumn) return [];

  const preferredLabelColumn = preview.columns.find(column => column !== numericColumn)
    || preview.columns[0]
    || numericColumn;

  return preview.rows.slice(0, 8).map((row, index) => {
    const numeric = Number(row[numericColumn]);
    if (!Number.isFinite(numeric)) return null;
    const rawLabel = row[preferredLabelColumn];
    const label = String(rawLabel ?? `Row ${index + 1}`).trim() || `Row ${index + 1}`;
    return { label, value: numeric };
  }).filter((item): item is PreviewBarPoint => Boolean(item));
}
