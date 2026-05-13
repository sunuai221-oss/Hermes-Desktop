import type { ChatToolCall } from '../../types';

export function normalizeToolCalls(input: unknown): ChatToolCall[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const calls = input
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
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

export function mergeToolCallDeltas(current: ChatToolCall[], deltas: unknown): ChatToolCall[] {
  const normalizedDeltas = normalizeToolCalls(deltas);
  if (!normalizedDeltas?.length) return current;

  const next = [...current];
  normalizedDeltas.forEach((delta, index) => {
    const existing = next[index] || {};
    const existingFunction = existing.function || {};
    const deltaFunction = delta.function || {};
    next[index] = {
      ...existing,
      ...delta,
      id: delta.id || existing.id,
      type: delta.type || existing.type,
      name: delta.name || existing.name,
      arguments: `${existing.arguments || ''}${delta.arguments || ''}` || undefined,
      function: {
        name: `${existingFunction.name || ''}${deltaFunction.name || ''}` || undefined,
        arguments: `${existingFunction.arguments || ''}${deltaFunction.arguments || ''}` || undefined,
      },
    };
  });

  return next;
}
