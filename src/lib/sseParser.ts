import type { ChatToolCall, ChatUsage } from '../types';

type JsonRecord = Record<string, unknown>;

export interface ParsedSseMessage {
  event: string | null;
  rawData: string;
  done: boolean;
  malformed: boolean;
  payload: unknown | null;
  contentDelta: string;
  toolCallDeltas: unknown;
  usage: ChatUsage | null;
  error: string | null;
  toolProgress: unknown;
}

export interface ParsedSseChunk {
  events: ParsedSseMessage[];
  buffer: string;
}

export function parseSseChunk(buffer: string, chunk: string): ParsedSseChunk {
  const source = `${buffer || ''}${chunk || ''}`;
  const { blocks, rest } = splitSseBlocks(source);
  const events = blocks
    .map(parseSseBlock)
    .filter((event): event is ParsedSseMessage => event != null);
  return { events, buffer: rest };
}

export function splitSseBlocks(source: string): { blocks: string[]; rest: string } {
  const normalized = String(source || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const boundary = normalized.indexOf('\n\n', cursor);
    if (boundary === -1) break;
    blocks.push(normalized.slice(cursor, boundary));
    cursor = boundary + 2;
  }

  return {
    blocks,
    rest: normalized.slice(cursor),
  };
}

export function parseSseBlock(rawBlock: string): ParsedSseMessage | null {
  const block = String(rawBlock || '').trim();
  if (!block) return null;

  let eventName: string | null = null;
  const dataLines: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || null;
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const rawData = dataLines.join('\n').trim();
  if (!rawData) return null;

  if (rawData === '[DONE]') {
    return {
      event: eventName,
      rawData,
      done: true,
      malformed: false,
      payload: null,
      contentDelta: '',
      toolCallDeltas: null,
      usage: null,
      error: null,
      toolProgress: null,
    };
  }

  let payload: unknown = null;
  let malformed = false;

  try {
    payload = JSON.parse(rawData);
  } catch {
    malformed = true;
  }

  const contentDelta = extractContentDelta(payload);
  const toolCallDeltas = extractToolCallDeltas(payload);
  const usage = normalizeGatewayUsage(payload);
  const error = extractSseError(eventName, payload);
  const toolProgress = eventName === 'hermes.tool.progress'
    ? payload ?? rawData
    : null;

  return {
    event: eventName,
    rawData,
    done: false,
    malformed,
    payload,
    contentDelta,
    toolCallDeltas,
    usage,
    error,
    toolProgress,
  };
}

export function normalizeToolCallDeltas(input: unknown): ChatToolCall[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const calls = input
    .filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      ...item,
      id: typeof item.id === 'string' ? item.id : undefined,
      type: typeof item.type === 'string' ? item.type : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      arguments: typeof item.arguments === 'string' ? item.arguments : undefined,
      function: item.function && typeof item.function === 'object'
        ? {
            name: typeof (item.function as { name?: unknown }).name === 'string'
              ? String((item.function as { name?: unknown }).name)
              : undefined,
            arguments: typeof (item.function as { arguments?: unknown }).arguments === 'string'
              ? String((item.function as { arguments?: unknown }).arguments)
              : undefined,
          }
        : undefined,
    } satisfies ChatToolCall));

  return calls.length > 0 ? calls : undefined;
}

export function normalizeGatewayUsage(payload: unknown): ChatUsage | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as JsonRecord;
  const usageCandidates = [
    record.usage,
    (record as { choices?: unknown[] }).choices && Array.isArray((record as { choices?: unknown[] }).choices)
      ? ((record as { choices?: unknown[] }).choices?.[0] as JsonRecord | undefined)?.usage
      : null,
  ];

  for (const candidate of usageCandidates) {
    const normalized = normalizeUsageObject(candidate);
    if (normalized) return normalized;
  }

  return normalizeUsageObject(record);
}

function normalizeUsageObject(candidate: unknown): ChatUsage | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const usage = candidate as JsonRecord;

  const promptTokens = toNumber(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = toNumber(usage.completion_tokens ?? usage.completionTokens);
  const totalTokens = toNumber(usage.total_tokens ?? usage.totalTokens);
  const cost = toNumber(usage.cost);
  const rateLimitRemaining = toNumber(usage.rate_limit_remaining ?? usage.rateLimitRemaining);
  const rateLimitReset = toRateLimitReset(usage.rate_limit_reset ?? usage.rateLimitReset);

  const hasAnyValue = [
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    rateLimitRemaining,
    rateLimitReset,
  ].some((value) => value != null);

  if (!hasAnyValue) return null;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    rateLimitRemaining,
    rateLimitReset,
  };
}

function extractContentDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') return '';
  const delta = (firstChoice as { delta?: unknown }).delta;
  if (!delta || typeof delta !== 'object') return '';
  return typeof (delta as { content?: unknown }).content === 'string'
    ? String((delta as { content?: unknown }).content)
    : '';
}

function extractToolCallDeltas(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') return null;
  const delta = (firstChoice as { delta?: unknown }).delta;
  if (!delta || typeof delta !== 'object') return null;
  return (delta as { tool_calls?: unknown }).tool_calls ?? null;
}

function extractSseError(eventName: string | null, payload: unknown): string | null {
  if (eventName === 'error') {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object') {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message.trim();
      const error = (payload as { error?: unknown }).error;
      if (typeof error === 'string' && error.trim()) return error.trim();
    }
    return 'SSE error event';
  }

  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }

  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRateLimitReset(value: unknown): number | string | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : normalized;
}
