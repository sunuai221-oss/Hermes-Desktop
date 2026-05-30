export type DiagnosticsAction = 'health' | 'logs' | 'doctor' | 'dump' | 'backup';

export interface DiagnosticsSnapshot {
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

export function formatDiagnosticsSummary(snapshot: DiagnosticsSnapshot | null): string {
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

export function formatLogsOutput(logs: DiagnosticsSnapshot['logs'] | null | undefined): string {
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

export function formatCommandOutput(payload: Record<string, unknown>): string {
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
