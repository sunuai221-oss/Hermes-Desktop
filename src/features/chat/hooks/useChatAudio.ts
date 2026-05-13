/* eslint-disable react-hooks/refs */
import { useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { ImageAttachment, Message, ModelThinkMode } from '../../../types';
import {
  createAudioRuntime,
  createHandleVoiceToggle,
  createSpeechPlayback,
  useAudioEndedCleanup as useAudioRuntimeEffects,
} from '../../../hooks/chatVoice';
import type { VoiceState } from '../../../hooks/chatVoice';
import { createMessageMutations } from '../../../hooks/chatMessageMutations';

type SetState<T> = (value: T | ((current: T) => T)) => void;

interface UseChatAudioOptions {
  audioRef: RefObject<HTMLAudioElement | null>;
  streaming: boolean;
  uploadingImages: boolean;
  voiceMode: boolean;
  voiceState: VoiceState;
  voiceSupported: boolean;
  speakingMessageIndex: number | null;
  setVoiceError: SetState<string | null>;
  setVoiceState: SetState<VoiceState>;
  setSpeakingMessageIndex: SetState<number | null>;
  activeSessionId: string | null;
  setActiveSessionId: SetState<string | null>;
  model: string;
  preferredThink: ModelThinkMode;
  messages: Message[];
  imageAttachments: ImageAttachment[];
  buildAttachedContext: () => string;
  clearPendingAttachments: () => void;
  setMessages: SetState<Message[]>;
}

export function useChatAudio({
  audioRef,
  streaming,
  uploadingImages,
  voiceMode,
  voiceState,
  voiceSupported,
  speakingMessageIndex,
  setVoiceError,
  setVoiceState,
  setSpeakingMessageIndex,
  activeSessionId,
  setActiveSessionId,
  model,
  preferredThink,
  messages,
  imageAttachments,
  buildAttachedContext,
  clearPendingAttachments,
  setMessages,
}: UseChatAudioOptions) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const voiceSynthesisAbortRef = useRef<AbortController | null>(null);

  const {
    updateLastAssistantMessage,
    updateMessageAtIndex,
  } = useMemo(
    () => createMessageMutations({ setMessages }),
    [setMessages],
  );

  const {
    releaseAudioUrl,
    playAudio,
    playAudioAndWait,
    stopCurrentVoicePlayback,
    handleMessageAudioEnded,
  } = useMemo(() => createAudioRuntime({
    audioRef,
    voiceSynthesisAbortRef,
    setMessages,
    setVoiceError,
    setVoiceState,
    setSpeakingMessageIndex,
  }), [audioRef, setMessages, setVoiceError, setVoiceState, setSpeakingMessageIndex]);

  useAudioRuntimeEffects({
    audioRef,
    releaseAudioUrl,
    setVoiceState,
  });

  const {
    maybeSpeakAssistantReply,
    speakMessageAt,
  } = useMemo(() => createSpeechPlayback({
    voiceMode,
    voiceState,
    speakingMessageIndex,
    messages,
    playAudioAndWait,
    stopCurrentVoicePlayback,
    updateLastAssistantMessage,
    updateMessageAtIndex,
    setVoiceError,
    setVoiceState,
    setSpeakingMessageIndex,
    voiceSynthesisAbortRef,
  }), [
    messages,
    playAudioAndWait,
    setSpeakingMessageIndex,
    setVoiceError,
    setVoiceState,
    speakingMessageIndex,
    stopCurrentVoicePlayback,
    updateLastAssistantMessage,
    updateMessageAtIndex,
    voiceMode,
    voiceState,
  ]);

  const handleVoiceToggle = useMemo(
    () => createHandleVoiceToggle({
      streaming,
      uploadingImages,
      voiceState,
      voiceSupported,
      mediaRecorderRef,
      mediaStreamRef,
      recordedChunksRef,
      audioRef,
      activeSessionId,
      model,
      preferredThink,
      messages,
      imageAttachments,
      buildAttachedContext,
      clearPendingAttachments,
      playAudio,
      stopCurrentVoicePlayback,
      setActiveSessionId,
      setMessages,
      setVoiceError,
      setVoiceState,
    }),
    [
      activeSessionId,
      audioRef,
      buildAttachedContext,
      clearPendingAttachments,
      imageAttachments,
      messages,
      model,
      playAudio,
      preferredThink,
      setActiveSessionId,
      setMessages,
      setVoiceError,
      setVoiceState,
      stopCurrentVoicePlayback,
      streaming,
      uploadingImages,
      voiceState,
      voiceSupported,
    ],
  );

  return {
    maybeSpeakAssistantReply,
    speakMessageAt,
    handleMessageAudioEnded,
    handleVoiceToggle,
  };
}
