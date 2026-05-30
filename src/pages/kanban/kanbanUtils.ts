import type { KanbanStats, KanbanStatus } from '../../types';

export type LaneVisual = {
  status: KanbanStatus;
  label: string;
  dot: string;
  accent: string;
  accentSoft: string;
  accentFaint: string;
  accentRing: string;
};

function laneVisual(status: KanbanStatus, label: string, dot: string, token: string): LaneVisual {
  return {
    status,
    label,
    dot,
    accent: `hsl(var(${token}))`,
    accentSoft: `hsl(var(${token}) / 0.15)`,
    accentFaint: `hsl(var(${token}) / 0.08)`,
    accentRing: `hsl(var(${token}) / 0.4)`,
  };
}

export const LANES: LaneVisual[] = [
  laneVisual('triage', 'Triage', 'bg-brand-amber', '--brand-amber'),
  laneVisual('todo', 'Todo', 'bg-brand-ember', '--brand-ember'),
  laneVisual('ready', 'Ready', 'bg-brand-gold', '--brand-gold'),
  laneVisual('running', 'Running', 'bg-warning', '--warning'),
  laneVisual('blocked', 'Blocked', 'bg-destructive', '--destructive'),
  laneVisual('done', 'Done', 'bg-muted-foreground', '--muted-foreground'),
];

export const ARCHIVED_LANE = laneVisual('archived', 'Archived', 'bg-brand-smoke', '--brand-smoke');
export const ALL_LANES = [...LANES, ARCHIVED_LANE];
export const VALID_STATUSES = ALL_LANES.map(lane => lane.status);

export const emptyForm = {
  title: '',
  body: '',
  assignee: '',
  tenant: '',
  priority: '0',
  workspace: 'scratch',
  parents: '',
  maxRuntime: '',
  maxRetries: '',
  triage: false,
  skills: [] as string[],
};

export type KanbanTaskForm = typeof emptyForm;

export function countStatus(stats: KanbanStats | null, status: KanbanStatus) {
  const value = stats?.by_status?.[status];
  return typeof value === 'number' ? value : 0;
}

export function splitCsv(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

export function formatTs(value?: number | null) {
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString();
}

export function formatPayload(payload: unknown) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  try { return JSON.stringify(payload); } catch { return String(payload); }
}

export function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { details?: string; error?: string } } }).response;
    return response?.data?.details || response?.data?.error || 'Kanban request failed';
  }
  if (error instanceof Error) return error.message;
  return 'Kanban request failed';
}

export function getLane(status: KanbanStatus) {
  return ALL_LANES.find(item => item.status === status) || ARCHIVED_LANE;
}

export function isKanbanStatus(value: string): value is KanbanStatus {
  return VALID_STATUSES.includes(value as KanbanStatus);
}
