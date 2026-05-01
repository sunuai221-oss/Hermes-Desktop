function splitSseBlocks(source) {
  const normalized = String(source || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = [];
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

function parseSseChunk(buffer, chunk) {
  const source = `${buffer || ''}${chunk || ''}`;
  const { blocks, rest } = splitSseBlocks(source);
  const events = blocks
    .map(parseSseBlock)
    .filter(Boolean);
  return { events, buffer: rest };
}

function parseSseBlock(rawBlock) {
  const block = String(rawBlock || '').trim();
  if (!block) return null;

  let eventName = null;
  const dataLines = [];

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

  let payload = null;
  let malformed = false;

  try {
    payload = JSON.parse(rawData);
  } catch {
    malformed = true;
  }

  return {
    event: eventName,
    rawData,
    done: false,
    malformed,
    payload,
    contentDelta: extractContentDelta(payload),
    toolCallDeltas: extractToolCallDeltas(payload),
    usage: normalizeGatewayUsage(payload),
    error: extractSseError(eventName, payload),
    toolProgress: eventName === 'hermes.tool.progress' ? (payload ?? rawData) : null,
  };
}

function normalizeGatewayUsage(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload;
  const usageCandidates = [
    record.usage,
    Array.isArray(record.choices) ? record.choices?.[0]?.usage : null,
  ];

  for (const candidate of usageCandidates) {
    const normalized = normalizeUsageObject(candidate);
    if (normalized) return normalized;
  }

  return normalizeUsageObject(record);
}

function normalizeUsageObject(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const usage = candidate;

  const promptTokens = toNumber(usage.prompt_tokens ?? usage.promptTokens);
  const completionTokens = toNumber(usage.completion_tokens ?? usage.completionTokens);
  const totalTokens = toNumber(usage.total_tokens ?? usage.totalTokens);
  const cost = toNumber(usage.cost);
  const rateLimitRemaining = toNumber(usage.rate_limit_remaining ?? usage.rateLimitRemaining);
  const rateLimitReset = toRateLimitReset(usage.rate_limit_reset ?? usage.rateLimitReset);

  const hasAny = [promptTokens, completionTokens, totalTokens, cost, rateLimitRemaining, rateLimitReset]
    .some(value => value != null);
  if (!hasAny) return null;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cost,
    rateLimitRemaining,
    rateLimitReset,
  };
}

function extractContentDelta(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const delta = choices?.[0]?.delta;
  if (!delta || typeof delta !== 'object') return '';
  return typeof delta.content === 'string' ? delta.content : '';
}

function extractToolCallDeltas(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const delta = choices?.[0]?.delta;
  if (!delta || typeof delta !== 'object') return null;
  return delta.tool_calls ?? null;
}

function extractSseError(eventName, payload) {
  if (eventName === 'error') {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object') {
      if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
      if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
    }
    return 'SSE error event';
  }

  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (payload.error && typeof payload.error === 'object') {
    if (typeof payload.error.message === 'string' && payload.error.message.trim()) return payload.error.message.trim();
  }
  return null;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toRateLimitReset(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : normalized;
}

export {
  splitSseBlocks,
  parseSseChunk,
  parseSseBlock,
  normalizeGatewayUsage,
};
