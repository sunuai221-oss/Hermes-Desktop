import { useCallback, useMemo } from 'react';
import * as apiClient from '../../../api';
import { buildVisionContent } from '../../../hooks/chatMediaUtils';
import { createMessageMutations } from '../../../hooks/chatMessageMutations';
import type { ChatProvider } from '../../../hooks/chatProviderRuntime';
import { normalizeGatewayUsage, normalizeToolCallDeltas, parseSseChunk } from '../../../lib/sseParser';
import { mergeToolCallDeltas, normalizeToolCalls } from '../chatToolCalls';
import { mergeUsage } from '../chatUsage';
import type {
  ChatToolCall,
  ChatUsage,
  ImageAttachment,
  Message,
  ModelThinkMode,
} from '../../../types';
import type { VoiceState } from '../../../hooks/chatVoice';

type SetState<T> = (value: T | ((current: T) => T)) => void;

interface UseChatMessagesOptions {
  input: string;
  setInput: SetState<string>;
  streaming: boolean;
  setStreaming: SetState<boolean>;
  uploadingImages: boolean;
  voiceState: VoiceState;
  attachmentsCount: number;
  imageAttachments: ImageAttachment[];
  messages: Message[];
  setMessages: SetState<Message[]>;
  activeSessionId: string | null;
  setActiveSessionId: SetState<string | null>;
  setUsage: SetState<ChatUsage | null>;
  model: string;
  provider?: ChatProvider;
  preferredThink: ModelThinkMode;
  buildUserContent: (base: string) => string;
  clearPendingAttachments: () => void;
  maybeSpeakAssistantReply: (assistantText: string) => Promise<void> | void;
  handleLocalCommand: (trimmedInput: string) => boolean | Promise<boolean>;
}

export function useChatMessages({
  input,
  setInput,
  streaming,
  setStreaming,
  uploadingImages,
  voiceState,
  attachmentsCount,
  imageAttachments,
  messages,
  setMessages,
  activeSessionId,
  setActiveSessionId,
  setUsage,
  model,
  provider,
  preferredThink,
  buildUserContent,
  clearPendingAttachments,
  maybeSpeakAssistantReply,
  handleLocalCommand,
}: UseChatMessagesOptions) {
  const {
    updateLastAssistantMessage,
  } = useMemo(
    () => createMessageMutations({ setMessages }),
    [setMessages],
  );

  const send = useCallback(async (overrideInput?: string) => {
    const draftInput = typeof overrideInput === 'string' ? overrideInput : input;
    const trimmedInput = draftInput.trim();
    const hasNoContent = !trimmedInput && attachmentsCount === 0 && imageAttachments.length === 0;
    if (hasNoContent || streaming || uploadingImages || voiceState === 'recording' || voiceState === 'processing') return;

    if (attachmentsCount === 0 && imageAttachments.length === 0) {
      const handledLocal = await handleLocalCommand(trimmedInput);
      if (handledLocal) {
        setInput('');
        return;
      }
    }

    const textSeed = trimmedInput || (imageAttachments.length > 0
      ? 'Analyze the attached images.'
      : 'Analyze the attached context references and answer from them.');
    const enrichedInput = buildUserContent(textSeed);
    const displayBlocks = [enrichedInput];
    if (imageAttachments.length > 0) displayBlocks.push(`[Attached images: ${imageAttachments.length}]`);
    const displayContent = displayBlocks.join('\n\n');
    const userMsg: Message = { role: 'user', content: displayContent, timestamp: Date.now() };
    const currentImages = imageAttachments;
    const effectiveModel = model;

    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const created = await apiClient.sessions.create({ source: 'api-server', model: effectiveModel });
        sessionId = created.data?.id || null;
        if (sessionId) setActiveSessionId(sessionId);
      } catch {
        sessionId = null;
      }
    }

    setInput('');
    setStreaming(true);
    setUsage(null);
    clearPendingAttachments();
    setMessages(current => [...current, userMsg, { role: 'assistant', content: '', timestamp: Date.now() }]);

    const payloadMessages = [
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: buildVisionContent(enrichedInput, currentImages) },
    ];

    let finalAssistantText = '';
    let finalAssistantToolCalls: ReturnType<typeof normalizeToolCalls> = undefined;
    let finalAssistantToolName: string | undefined;
    let finalAssistantToolResults: unknown;
    let persistedByGateway = false;
    let accumulatedUsage: ChatUsage | null = null;

    try {
      const response = await apiClient.gateway.streamChat({
        model: effectiveModel,
        provider,
        think: preferredThink,
        messages: payloadMessages,
        stream: true,
        session_id: sessionId || undefined,
        source: 'api-server',
      });
      if (!response.ok) throw new Error('Stream failed');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Reader unavailable');

      const decoder = new TextDecoder();
      let parserBuffer = '';
      let accumulated = '';
      let accumulatedToolCalls: ChatToolCall[] = [];

      const consumeParsedEvents = (parsedEvents: ReturnType<typeof parseSseChunk>['events']) => {
        for (const event of parsedEvents) {
          if (event.done || event.malformed) continue;

          if (event.usage) {
            accumulatedUsage = mergeUsage(accumulatedUsage, event.usage);
            setUsage(current => mergeUsage(current, event.usage));
          }

          if (event.error && !accumulated) {
            accumulated = event.error;
            updateLastAssistantMessage(message => ({ ...message, content: accumulated }));
          }

          const toolCallDeltas = normalizeToolCallDeltas(event.toolCallDeltas);
          if (Array.isArray(toolCallDeltas) && toolCallDeltas.length > 0) {
            accumulatedToolCalls = mergeToolCallDeltas(accumulatedToolCalls, toolCallDeltas);
            finalAssistantToolCalls = accumulatedToolCalls;
            updateLastAssistantMessage(message => ({ ...message, toolCalls: accumulatedToolCalls }));
          }

          if (!event.contentDelta) continue;
          accumulated += event.contentDelta;
          updateLastAssistantMessage(message => ({ ...message, content: accumulated }));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const parsedChunk = parseSseChunk(parserBuffer, text);
        parserBuffer = parsedChunk.buffer;
        consumeParsedEvents(parsedChunk.events);
      }

      if (parserBuffer.trim()) {
        const finalParsedChunk = parseSseChunk(parserBuffer, '\n\n');
        consumeParsedEvents(finalParsedChunk.events);
      }

      finalAssistantText = accumulated;
      finalAssistantToolCalls = accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined;
      void maybeSpeakAssistantReply(accumulated);
    } catch {
      try {
        const response = await apiClient.gateway.chat({
          model: effectiveModel,
          provider,
          think: preferredThink,
          messages: payloadMessages,
          session_id: sessionId || undefined,
          source: 'api-server',
        });
        const assistantMessage = response.data.choices?.[0]?.message || {};
        const content = assistantMessage.content || 'No response.';
        finalAssistantText = content;
        finalAssistantToolCalls = normalizeToolCalls(assistantMessage.tool_calls);
        finalAssistantToolName = typeof assistantMessage.tool_name === 'string' ? assistantMessage.tool_name : undefined;
        finalAssistantToolResults = Object.prototype.hasOwnProperty.call(assistantMessage, 'tool_results')
          ? assistantMessage.tool_results
          : undefined;
        accumulatedUsage = normalizeGatewayUsage(response.data);
        setUsage(accumulatedUsage);
        persistedByGateway = true;
        if (!sessionId && response.data?.session_id) {
          sessionId = String(response.data.session_id);
          setActiveSessionId(sessionId);
        }
        updateLastAssistantMessage(message => ({
          ...message,
          content,
          toolCalls: finalAssistantToolCalls,
          toolName: finalAssistantToolName,
          toolResults: finalAssistantToolResults,
        }));
        void maybeSpeakAssistantReply(content);
      } catch {
        finalAssistantText = 'Gateway unreachable. Verify that the Hermes Gateway is running.';
        updateLastAssistantMessage(message => ({ ...message, content: finalAssistantText }));
      }
    } finally {
      if (accumulatedUsage) {
        setUsage(current => mergeUsage(current, accumulatedUsage));
      }

      if (sessionId && !persistedByGateway && (finalAssistantText || finalAssistantToolCalls?.length || finalAssistantToolName || finalAssistantToolResults != null)) {
        apiClient.sessions.appendMessages(sessionId, {
          model: effectiveModel,
          source: 'api-server',
          messages: [
            { role: 'user', content: userMsg.content, timestamp: userMsg.timestamp },
            {
              role: 'assistant',
              content: finalAssistantText,
              timestamp: Date.now(),
              token_count: accumulatedUsage?.completionTokens ?? accumulatedUsage?.totalTokens ?? undefined,
              tool_calls: finalAssistantToolCalls,
              tool_name: finalAssistantToolName,
              tool_results: finalAssistantToolResults,
            },
          ],
        }).catch(() => {});
      }
      setStreaming(false);
    }
  }, [
    activeSessionId,
    attachmentsCount,
    buildUserContent,
    clearPendingAttachments,
    handleLocalCommand,
    imageAttachments,
    input,
    maybeSpeakAssistantReply,
    messages,
    model,
    preferredThink,
    provider,
    setActiveSessionId,
    setInput,
    setMessages,
    setStreaming,
    setUsage,
    streaming,
    updateLastAssistantMessage,
    uploadingImages,
    voiceState,
  ]);

  return { send };
}
