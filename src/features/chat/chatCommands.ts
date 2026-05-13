import type { ChatUsage } from '../../types';

export type ChatCommandId = 'new' | 'usage' | 'status' | 'compact' | 'tools' | 'memory' | 'model';

export interface ChatCommandDefinition {
  id: ChatCommandId;
  command: `/${ChatCommandId}`;
  description: string;
  localOnly: boolean;
}

export const CHAT_COMMANDS: ChatCommandDefinition[] = [
  { id: 'new', command: '/new', description: 'Start a fresh chat session', localOnly: true },
  { id: 'usage', command: '/usage', description: 'Show latest token, cost, and limit usage', localOnly: true },
  { id: 'status', command: '/status', description: 'Show backend, gateway, profile, and model status', localOnly: true },
  { id: 'compact', command: '/compact', description: 'Ask Hermes runtime to compact the session context', localOnly: false },
  { id: 'tools', command: '/tools', description: 'Ask Hermes runtime to inspect enabled tools', localOnly: false },
  { id: 'memory', command: '/memory', description: 'Ask Hermes runtime to inspect memory state', localOnly: false },
  { id: 'model', command: '/model', description: 'Ask Hermes runtime to inspect/switch model behavior', localOnly: false },
];

export function parseCommandInput(input: string): { id: ChatCommandId; command: string; args: string } | null {
  const trimmed = String(input || '').trim();
  if (!trimmed.startsWith('/')) return null;
  const [commandToken, ...argsTokens] = trimmed.split(/\s+/);
  const id = commandToken.slice(1).toLowerCase() as ChatCommandId;
  if (!CHAT_COMMANDS.some(item => item.id === id)) return null;
  return { id, command: commandToken, args: argsTokens.join(' ') };
}

export function isLocalCommand(commandId: ChatCommandId): boolean {
  return commandId === 'new' || commandId === 'usage' || commandId === 'status';
}

function formatIntegerMetric(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function formatUsageStatus(usage: ChatUsage | null): string {
  if (!usage) return 'Usage unavailable for this session.';

  const tokens = [
    `prompt ${formatIntegerMetric(usage.promptTokens)}`,
    `completion ${formatIntegerMetric(usage.completionTokens)}`,
    `total ${formatIntegerMetric(usage.totalTokens)}`,
  ].join(' | ');

  const extras: string[] = [];
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
    extras.push(`cost $${usage.cost.toFixed(6)}`);
  }
  if (usage.rateLimitRemaining != null) {
    extras.push(`rate limit remaining ${formatIntegerMetric(usage.rateLimitRemaining)}`);
  }
  if (usage.rateLimitReset != null) {
    extras.push(`rate limit reset ${String(usage.rateLimitReset)}`);
  }

  return extras.length > 0 ? `${tokens}\n${extras.join(' | ')}` : tokens;
}
