import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import { useProfiles } from '../contexts/ProfileContext';
import { useGatewayContext } from '../contexts/GatewayContext';
import type { ContextReferenceAttachment } from '../types';
import { getRuntimeProviderKey, getRuntimeProviderLabel } from './chatProviderRuntime';
import { getVoiceStatusLabel, type VoiceState } from './chatVoice';
import { CHAT_COMMANDS } from '../features/chat/chatCommands';
import { getModelContextWindow } from '../features/chat/chatUsage';
import { useChatDraft } from '../features/chat/hooks/useChatDraft';
import { useChatContextFiles } from '../features/chat/hooks/useChatContextFiles';
import { useChatSession } from '../features/chat/hooks/useChatSession';
import { useChatAudio } from '../features/chat/hooks/useChatAudio';
import { useChatUploads } from '../features/chat/hooks/useChatUploads';
import { useChatMessages } from '../features/chat/hooks/useChatMessages';
import { useChatTokenEstimates, type ChatTokenEstimates } from '../features/chat/hooks/useChatTokenEstimates';
import { useChatLocalCommands } from '../features/chat/hooks/useChatLocalCommands';
import {
  getChatMessagesStorageKey,
  getChatSessionStorageKey,
} from '../features/chat/chatStorage';

const MAX_IMAGES = 5;
export { CHAT_COMMANDS };
export type { ChatCommandDefinition, ChatCommandId } from '../features/chat/chatCommands';

export const referenceTemplates: Array<{
  kind: ContextReferenceAttachment['kind'];
  label: string;
  placeholder: string;
}> = [
  { kind: 'file', label: '@file', placeholder: 'src/main.py:10-25' },
  { kind: 'folder', label: '@folder', placeholder: 'src/components' },
  { kind: 'diff', label: '@diff', placeholder: '' },
  { kind: 'staged', label: '@staged', placeholder: '' },
  { kind: 'git', label: '@git', placeholder: '5' },
  { kind: 'url', label: '@url', placeholder: 'https://example.com' },
];

// ── Hook ────────────────────────────────────────────────────────

interface UseChatOptions {
  requestedSessionId?: string | null;
  requestNonce?: number;
  audioRef: RefObject<HTMLAudioElement | null>;
}

export function useChat({
  requestedSessionId = null,
  requestNonce = 0,
  audioRef,
}: UseChatOptions) {
  // ── Dependencies ──────────────────────────────────────────
  const gateway = useGatewayContext();
  const { currentProfile } = useProfiles();

  const preferredModel = gateway.config?.model?.default || 'Qwen3.6-27B-UD-IQ3_XXS';
  const preferredThink = gateway.config?.model?.think ?? 'low';
  const runtimeProvider = getRuntimeProviderKey(gateway.config);
  const runtimeProviderLabel = getRuntimeProviderLabel(gateway.config);
  const sessionStorageKey = getChatSessionStorageKey(currentProfile);
  const contextWindowTokens = getModelContextWindow(
    gateway.config as { model?: Record<string, unknown> } | null,
    preferredModel,
  );

  // ── Local state ───────────────────────────────────────────
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);
  const voiceSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';

  // ── Sub-features ──────────────────────────────────────────
  const {
    attachments,
    newAttachmentKind,
    newAttachmentValue,
    resolvedAttachments,
    resolvingRefs,
    totalResolvedChars,
    canAddReference,
    attachedContext,
    setNewAttachmentKind,
    setNewAttachmentValue,
    addAttachment,
    removeAttachment,
    clearContextReferences,
    buildAttachedContext,
  } = useChatContextFiles({ referenceTemplates });

  const {
    imageAttachments,
    uploadingImages,
    imageError,
    setImageError,
    attachImageFiles,
    removeImage,
    clearImageAttachments,
    handlePaste,
    handleFileSelection,
  } = useChatUploads({ maxImages: MAX_IMAGES });

  const provider = runtimeProvider === 'profile-default' ? undefined : runtimeProvider;
  const model = preferredModel;

  const clearPendingAttachments = useCallback(() => {
    clearContextReferences();
    clearImageAttachments();
  }, [clearContextReferences, clearImageAttachments]);

  const resetComposer = useCallback(() => {
    setInput('');
    clearPendingAttachments();
    setNewAttachmentValue('');
    setImageError(null);
    setVoiceError(null);
  }, [clearPendingAttachments, setImageError, setNewAttachmentValue]);

  const sessionMessagesStorageKey = useCallback(
    (sessionId: string) => getChatMessagesStorageKey(currentProfile, sessionId),
    [currentProfile],
  );

  const {
    messages,
    setMessages,
    activeSessionId,
    setActiveSessionId,
    usage,
    setUsage,
    hydrateSession,
    handleNewChat,
  } = useChatSession({
    currentProfile,
    requestedSessionId,
    requestNonce,
    sessionStorageKey,
    sessionMessagesStorageKey,
    resetComposer,
  });

  useChatDraft({ setInput });

  // ── Computed: token estimates ─────────────────────────────
  const tokenEstimates: ChatTokenEstimates = useChatTokenEstimates({
    messages, input,
    attachmentsLength: attachments.length,
    imageAttachments, attachedContext,
    contextWindowTokens: contextWindowTokens ?? 0,
  });

  // ── Computed: session label ───────────────────────────────
  const currentSessionMeta = activeSessionId ? gateway.sessions[activeSessionId] : null;
  const currentSessionLabel = currentSessionMeta?.title || activeSessionId || null;

  // ── Computed: labels ──────────────────────────────────────
  const voiceStatusLabel = getVoiceStatusLabel(voiceState, voiceMode);
  const contextStatusLabel = resolvingRefs
    ? `Resolving ${attachments.length} reference(s)...`
    : `${attachments.length} text reference(s) - ${totalResolvedChars} chars - ${imageAttachments.length} image(s)`;

  // ── Commands ──────────────────────────────────────────────
  const buildUserContent = useCallback((base: string) => {
    const context = buildAttachedContext();
    return context ? `${base}\n\n${context}` : base;
  }, [buildAttachedContext]);

  const { handleLocalCommand } = useChatLocalCommands({
    activeSessionId, currentProfile,
    gatewayBuilderStatus: gateway.builderStatus,
    gatewayHealth: gateway.health,
    gatewayDirectHealth: gateway.directGatewayHealth,
    gatewayProcessStatus: gateway.processStatus,
    preferredModel, runtimeProviderLabel, usage,
    handleNewChat, setMessages,
  });

  // ── Audio & Messages ──────────────────────────────────────
  const {
    maybeSpeakAssistantReply,
    speakMessageAt,
    handleMessageAudioEnded,
    handleVoiceToggle,
  } = useChatAudio({
    audioRef, streaming, uploadingImages, voiceMode, voiceState, voiceSupported,
    speakingMessageIndex, setVoiceError, setVoiceState, setSpeakingMessageIndex,
    activeSessionId, setActiveSessionId, model, preferredThink,
    messages, imageAttachments, buildAttachedContext, clearPendingAttachments, setMessages,
  });

  const { send } = useChatMessages({
    input, setInput, streaming, setStreaming, uploadingImages, voiceState,
    attachmentsCount: attachments.length, imageAttachments,
    messages, setMessages, activeSessionId, setActiveSessionId, setUsage,
    model, provider, preferredThink, buildUserContent, clearPendingAttachments,
    maybeSpeakAssistantReply, handleLocalCommand,
  });

  // ── Return ──────────────────────────────────────────────────
  return {
    // State
    messages, activeSessionId, input, streaming, usage, model, provider,
    attachments, imageAttachments, uploadingImages,
    imageError, newAttachmentKind, newAttachmentValue, resolvedAttachments,
    resolvingRefs, voiceMode, voiceState, voiceError, voiceSupported, speakingMessageIndex,
    // Computed
    currentSessionId: activeSessionId,
    currentSessionLabel,
    totalResolvedChars, canAddReference,
    voiceStatusLabel, contextStatusLabel,
    contextTokensEstimate: tokenEstimates.contextTokensEstimate,
    contextWindowTokens,
    contextUsagePercent: tokenEstimates.contextUsagePercent,
    preferredModel, runtimeProvider, runtimeProviderLabel, chatCommands: CHAT_COMMANDS,
    // Setters
    setInput, setVoiceMode,
    setNewAttachmentKind, setNewAttachmentValue,
    // Actions
    send, handleNewChat, handleVoiceToggle,
    speakMessageAt, handleMessageAudioEnded,
    addAttachment, removeAttachment,
    attachImageFiles, removeImage,
    handlePaste, handleFileSelection,
    hydrateSession,
  };
}
