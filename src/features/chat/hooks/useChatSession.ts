import { useCallback, useEffect, useRef, useState } from 'react';
import * as apiClient from '../../../api';
import {
  persistChatMessages,
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from '../chatStorage';
import { normalizeToolCalls } from '../chatToolCalls';
import type { ChatUsage, Message } from '../../../types';

interface UseChatSessionOptions {
  currentProfile: string;
  requestedSessionId?: string | null;
  requestNonce?: number;
  sessionStorageKey: string;
  sessionMessagesStorageKey: (sessionId: string) => string;
  resetComposer: () => void;
}

function isMessageRole(value: unknown): value is Message['role'] {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function normalizePersistedMessages(
  input: unknown,
): Message[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter(item => isMessageRole(item.role))
    .map(item => ({
      role: item.role as Message['role'],
      content: typeof item.content === 'string' ? item.content : String(item.content ?? ''),
      timestamp: typeof item.timestamp === 'number' ? item.timestamp : undefined,
      audioUrl: typeof item.audioUrl === 'string' ? item.audioUrl : undefined,
      isVoice: item.isVoice === true,
      tokenCount: typeof item.tokenCount === 'number' ? item.tokenCount : undefined,
      toolCalls: normalizeToolCalls(item.toolCalls),
      toolName: typeof item.toolName === 'string' ? item.toolName : undefined,
      toolResults: Object.prototype.hasOwnProperty.call(item, 'toolResults') ? item.toolResults : undefined,
    }));
}

export function useChatSession({
  currentProfile,
  requestedSessionId = null,
  requestNonce = 0,
  sessionStorageKey,
  sessionMessagesStorageKey,
  resetComposer,
}: UseChatSessionOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const hydrateRequestRef = useRef(0);

  const readPersistedMessages = useCallback((sessionId: string | null): Message[] => {
    if (!sessionId) return [];
    try {
      const raw = readStorageItem(sessionMessagesStorageKey(sessionId));
      if (!raw) return [];
      return normalizePersistedMessages(JSON.parse(raw));
    } catch {
      return [];
    }
  }, [sessionMessagesStorageKey]);

  const hydrateSession = useCallback(async (sessionId: string | null) => {
    const requestId = ++hydrateRequestRef.current;
    if (!sessionId) {
      setActiveSessionId(null);
      setMessages([]);
      setUsage(null);
      return;
    }

    const draftMessages = readPersistedMessages(sessionId);
    setActiveSessionId(sessionId);
    setUsage(null);
    if (draftMessages.length > 0) {
      setMessages(draftMessages);
    }

    try {
      const response = await apiClient.sessions.transcript(sessionId);
      if (hydrateRequestRef.current !== requestId) return;
      const transcript = Array.isArray(response.data)
        ? response.data
            .filter((entry): entry is Message => entry?.role === 'user' || entry?.role === 'assistant' || entry?.role === 'system')
            .map((entry) => ({
              role: entry.role,
              content: typeof entry.content === 'string' ? entry.content : String(entry.content ?? ''),
              timestamp: entry.timestamp,
              tokenCount: typeof (entry as { token_count?: unknown }).token_count === 'number'
                ? Number((entry as { token_count?: unknown }).token_count)
                : undefined,
              toolCalls: normalizeToolCalls((entry as { tool_calls?: unknown }).tool_calls),
              toolName: typeof (entry as { tool_name?: unknown }).tool_name === 'string'
                ? String((entry as { tool_name?: unknown }).tool_name)
                : undefined,
              toolResults: Object.prototype.hasOwnProperty.call(entry as object, 'tool_results')
                ? (entry as { tool_results?: unknown }).tool_results
                : undefined,
            }))
        : [];
      setMessages(transcript.length > 0 ? transcript : draftMessages);
    } catch {
      if (hydrateRequestRef.current !== requestId) return;
      if (draftMessages.length === 0) {
        setMessages([]);
      }
    }
  }, [readPersistedMessages]);

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setUsage(null);
    resetComposer();
    removeStorageItem(sessionStorageKey);
  }, [resetComposer, sessionStorageKey]);

  useEffect(() => {
    const storedSessionId = readStorageItem(sessionStorageKey);
    if (storedSessionId) {
      queueMicrotask(() => {
        void hydrateSession(storedSessionId);
      });
      return;
    }
    queueMicrotask(() => {
      setActiveSessionId(null);
      setMessages([]);
    });
  }, [currentProfile, hydrateSession, sessionStorageKey]);

  useEffect(() => {
    if (!requestNonce) return;
    if (requestedSessionId) {
      queueMicrotask(() => {
        void hydrateSession(requestedSessionId);
      });
      return;
    }
    queueMicrotask(() => {
      handleNewChat();
    });
  }, [handleNewChat, hydrateSession, requestNonce, requestedSessionId]);

  useEffect(() => {
    if (activeSessionId) {
      writeStorageItem(sessionStorageKey, activeSessionId);
    } else {
      removeStorageItem(sessionStorageKey);
    }
  }, [activeSessionId, sessionStorageKey]);

  useEffect(() => {
    if (!activeSessionId) return;
    persistChatMessages(sessionMessagesStorageKey(activeSessionId), messages);
  }, [activeSessionId, messages, sessionMessagesStorageKey]);

  return {
    messages,
    setMessages,
    activeSessionId,
    setActiveSessionId,
    usage,
    setUsage,
    hydrateSession,
    handleNewChat,
  };
}
