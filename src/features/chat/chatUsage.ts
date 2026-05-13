import type { ChatUsage, Message } from '../../types';

export const MESSAGE_OVERHEAD_TOKENS = 6;
export const ESTIMATED_IMAGE_TOKENS = 256;
const CONTEXT_WINDOW_KEYS = [
  'context_window',
  'contextWindow',
  'max_context_tokens',
  'maxTokens',
  'max_tokens',
  'num_ctx',
] as const;

export function estimateTextTokens(text: string): number {
  const normalized = String(text || '').normalize('NFC').trim();
  if (!normalized) return 0;

  let tokens = 0;
  let asciiRun = 0;
  let nonAsciiRun = 0;

  const flush = () => {
    if (asciiRun > 0) {
      tokens += Math.max(1, Math.ceil(asciiRun / 4));
      asciiRun = 0;
    }
    if (nonAsciiRun > 0) {
      tokens += nonAsciiRun;
      nonAsciiRun = 0;
    }
  };

  for (const char of normalized) {
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (char.charCodeAt(0) <= 0x7F) {
      asciiRun += 1;
    } else {
      nonAsciiRun += 1;
    }
  }

  flush();
  return tokens;
}

function extractAttachedImageCount(text: string): number {
  const match = String(text || '').match(/\[Attached images:\s*(\d+)\]/i);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

export function estimateMessageTokens(message: Message): number {
  if (typeof message.tokenCount === 'number' && Number.isFinite(message.tokenCount) && message.tokenCount > 0) {
    return Math.round(message.tokenCount);
  }

  const attachedImages = extractAttachedImageCount(message.content);
  return estimateTextTokens(message.content) + MESSAGE_OVERHEAD_TOKENS + (attachedImages * ESTIMATED_IMAGE_TOKENS);
}

function parseContextWindowValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  const normalized = String(value || '').trim().toLowerCase().replace(/,/g, '');
  if (!normalized) return null;

  const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

function inferContextWindowFromModelName(modelName: string): number | null {
  const match = String(modelName || '').toLowerCase().match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)([km])(?:[^a-z0-9]|$)/);
  if (!match) return null;
  return parseContextWindowValue(`${match[1]}${match[2]}`);
}

export function getModelContextWindow(config: { model?: Record<string, unknown> } | null, modelName: string): number | null {
  const modelConfig = config?.model;
  if (modelConfig && typeof modelConfig === 'object') {
    for (const key of CONTEXT_WINDOW_KEYS) {
      const parsed = parseContextWindowValue(modelConfig[key]);
      if (parsed) return parsed;
    }
  }
  return inferContextWindowFromModelName(modelName);
}

export function mergeUsage(current: ChatUsage | null, incoming: ChatUsage | null): ChatUsage | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return {
    promptTokens: incoming.promptTokens ?? current.promptTokens ?? null,
    completionTokens: incoming.completionTokens ?? current.completionTokens ?? null,
    totalTokens: incoming.totalTokens ?? current.totalTokens ?? null,
    cost: incoming.cost ?? current.cost ?? null,
    rateLimitRemaining: incoming.rateLimitRemaining ?? current.rateLimitRemaining ?? null,
    rateLimitReset: incoming.rateLimitReset ?? current.rateLimitReset ?? null,
  };
}
