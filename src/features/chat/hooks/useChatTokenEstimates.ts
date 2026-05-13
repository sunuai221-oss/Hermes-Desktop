import { useMemo } from 'react';
import type { ImageAttachment, Message } from '../../../types';
import {
  ESTIMATED_IMAGE_TOKENS,
  MESSAGE_OVERHEAD_TOKENS,
  estimateMessageTokens,
  estimateTextTokens,
} from '../chatUsage';

interface UseChatTokenEstimatesOptions {
  messages: Message[];
  input: string;
  attachmentsLength: number;
  imageAttachments: ImageAttachment[];
  attachedContext: string;
  contextWindowTokens: number;
}

export interface ChatTokenEstimates {
  persistedContextTokens: number;
  pendingDraftTokens: number;
  contextTokensEstimate: number;
  contextUsagePercent: number | null;
}

export function useChatTokenEstimates(options: UseChatTokenEstimatesOptions): ChatTokenEstimates {
  const { messages, input, attachmentsLength, imageAttachments, attachedContext, contextWindowTokens } = options;

  const persistedContextTokens = useMemo(
    () => messages.reduce((acc, message) => acc + estimateMessageTokens(message), 0),
    [messages],
  );

  const pendingDraftTokens = useMemo(() => {
    const hasPendingDraft = Boolean(input.trim()) || attachmentsLength > 0 || imageAttachments.length > 0;
    if (!hasPendingDraft) return 0;
    const textSeed = input.trim() || (imageAttachments.length > 0
      ? 'Analyze the attached images.'
      : 'Analyze the attached context references and answer from them.');
    const enrichedInput = attachedContext ? `${textSeed}\n\n${attachedContext}` : textSeed;
    return estimateTextTokens(enrichedInput) + MESSAGE_OVERHEAD_TOKENS + (imageAttachments.length * ESTIMATED_IMAGE_TOKENS);
  }, [attachmentsLength, attachedContext, imageAttachments.length, input]);

  const contextTokensEstimate = persistedContextTokens + pendingDraftTokens;

  const contextUsagePercent = contextWindowTokens
    ? Math.min(100, Math.max(0, Math.round((contextTokensEstimate / contextWindowTokens) * 100)))
    : null;

  return { persistedContextTokens, pendingDraftTokens, contextTokensEstimate, contextUsagePercent };
}
