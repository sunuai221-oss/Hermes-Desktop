import { useEffect } from 'react';
import type { RefObject } from 'react';
import * as apiClient from '../api';
import { parseSseChunk } from '../lib/sseParser';
import type { ImageAttachment, Message, ModelThinkMode } from '../types';
import { extractVoiceAudioFileName, readBlobAsDataUrl } from './chatMediaUtils';

// ── Types ──

export type VoiceState = 'idle' | 'recording' | 'processing' | 'speaking';

// ── Pure helpers (former chatVoiceController.ts) ──

export function stopMicrophoneCapture(
  recorderRef: RefObject<MediaRecorder | null>,
  streamRef: RefObject<MediaStream | null>,
) {
  recorderRef.current = null;
  const stream = streamRef.current;
  streamRef.current = null;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
}

export function createVoiceAbortError(): Error {
  const error = new Error('Voice playback interrupted');
  error.name = 'AbortError';
  return error;
}

export function isVoiceAbortError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && String((error as { name?: unknown }).name) === 'AbortError',
  );
}

export function getVoiceStatusLabel(voiceState: VoiceState, voiceMode: boolean): string {
  if (voiceState === 'recording') return 'Recording...';
  if (voiceState === 'processing') return 'Transcription + reply + TTS...';
  if (voiceState === 'speaking') return 'Playing audio';
  return voiceMode ? 'Voice mode active' : 'Voice mode inactive';
}

// ── Voice event dispatch (for lipsync) ───────────────────────────

function dispatchVoiceEvent(state: 'start' | 'end') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hermes:voice:speaking', { detail: { state } }));
  }
}

// ── Audio playback (former chatAudioPlayback.ts) ──

type SetState<T> = (value: T | ((current: T) => T)) => void;

interface CreateAudioPlaybackParams {
  audioRef: { current: HTMLAudioElement | null };
  setMessages: SetState<Message[]>;
  setVoiceError: SetState<string | null>;
  setVoiceState: SetState<VoiceState>;
}

export function createAudioPlayback(params: CreateAudioPlaybackParams) {
  const clearAudioUrl = (audioUrl: string) => {
    const normalized = String(audioUrl || '').trim();
    if (!normalized) return;
    params.setMessages(current => {
      let changed = false;
      const next = current.map(message => {
        if (message.audioUrl !== normalized) return message;
        changed = true;
        return { ...message, audioUrl: undefined };
      });
      return changed ? next : current;
    });
  };

  const releaseAudioUrl = async (audioUrl: string) => {
    const normalized = String(audioUrl || '').trim();
    if (!normalized) return;
    clearAudioUrl(normalized);
    const fileName = extractVoiceAudioFileName(normalized);
    if (!fileName) return;
    try {
      await apiClient.voice.deleteAudio(fileName);
    } catch {
      // Keep UI responsive even if cleanup fails server-side.
    }
  };

  const playAudio = async (audioUrl: string) => {
    const audio = params.audioRef.current;
    if (!audioUrl || !audio) return;
    audio.pause();

    const cleanup = () => {
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
    function handleEnded() {
      dispatchVoiceEvent('end');
      cleanup();
      params.setVoiceState('idle');
    }
    function handleError() {
      dispatchVoiceEvent('end');
      cleanup();
    }

    audio.addEventListener('ended', handleEnded, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    audio.src = audioUrl;
    audio.load();
    try {
      params.setVoiceState('speaking');
      await audio.play();
      dispatchVoiceEvent('start');
    } catch (error) {
      cleanup();
      dispatchVoiceEvent('end');
      const errorName = typeof error === 'object' && error && 'name' in error ? String(error.name) : '';
      params.setVoiceError(
        errorName === 'NotAllowedError'
          ? 'Autoplay was blocked. Use the message audio player.'
          : 'Audio playback failed. Use the message audio player.',
      );
      params.setVoiceState('idle');
    }
  };

  const playAudioAndWait = async (audioUrl: string, signal?: AbortSignal) => {
    const audio = params.audioRef.current;
    if (!audioUrl || !audio) return;
    if (signal?.aborted) throw createVoiceAbortError();

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
        signal?.removeEventListener('abort', handleAbort);
      };
      const handleEnded = () => { dispatchVoiceEvent('end'); cleanup(); resolve(); };
      const handleError = () => { dispatchVoiceEvent('end'); cleanup(); void releaseAudioUrl(audioUrl); reject(new Error('Audio playback failed')); };
      const handleAbort = () => {
        dispatchVoiceEvent('end');
        cleanup(); audio.pause(); audio.removeAttribute('src'); audio.load();
        void releaseAudioUrl(audioUrl); reject(createVoiceAbortError());
      };

      audio.pause();
      audio.addEventListener('ended', handleEnded, { once: true });
      audio.addEventListener('error', handleError, { once: true });
      signal?.addEventListener('abort', handleAbort, { once: true });
      audio.src = audioUrl;
      audio.load();
      params.setVoiceState('speaking');
      audio.play()
        .then(() => dispatchVoiceEvent('start'))
        .catch(error => {
          dispatchVoiceEvent('end');
          cleanup();
          params.setVoiceState('idle');
          void releaseAudioUrl(audioUrl);
          reject(error);
        });
    });
  };

  return { clearAudioUrl, releaseAudioUrl, playAudio, playAudioAndWait };
}

// ── Audio controller (former chatAudioController.ts) ──

interface CreateAudioControllerParams {
  audioRef: { current: HTMLAudioElement | null };
  voiceSynthesisAbortRef: { current: AbortController | null };
  releaseAudioUrl: (audioUrl: string) => Promise<void>;
  setSpeakingMessageIndex: SetState<number | null>;
  setVoiceState: SetState<VoiceState>;
}

export function createAudioController(params: CreateAudioControllerParams) {
  const stopCurrentVoicePlayback = () => {
    if (params.voiceSynthesisAbortRef.current) {
      params.voiceSynthesisAbortRef.current.abort();
      params.voiceSynthesisAbortRef.current = null;
    }
    const audio = params.audioRef.current;
    const playingAudioUrl = String(audio?.currentSrc || audio?.src || '').trim();
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    dispatchVoiceEvent('end');
    params.setSpeakingMessageIndex(null);
    params.setVoiceState('idle');
    if (playingAudioUrl) void params.releaseAudioUrl(playingAudioUrl);
  };

  const handleMessageAudioEnded = (audioUrl: string) => {
    void params.releaseAudioUrl(audioUrl);
  };

  return { stopCurrentVoicePlayback, handleMessageAudioEnded };
}

// ── Audio runtime composition (former chatAudioRuntime.ts) ──

interface CreateAudioRuntimeParams {
  audioRef: { current: HTMLAudioElement | null };
  voiceSynthesisAbortRef: { current: AbortController | null };
  setMessages: SetState<Message[]>;
  setVoiceError: SetState<string | null>;
  setVoiceState: SetState<VoiceState>;
  setSpeakingMessageIndex: SetState<number | null>;
}

export function createAudioRuntime(params: CreateAudioRuntimeParams) {
  const audioPlayback = createAudioPlayback({
    audioRef: params.audioRef, setMessages: params.setMessages,
    setVoiceError: params.setVoiceError, setVoiceState: params.setVoiceState,
  });
  const audioController = createAudioController({
    audioRef: params.audioRef, voiceSynthesisAbortRef: params.voiceSynthesisAbortRef,
    releaseAudioUrl: audioPlayback.releaseAudioUrl, setSpeakingMessageIndex: params.setSpeakingMessageIndex,
    setVoiceState: params.setVoiceState,
  });
  return {
    ...audioPlayback,
    stopCurrentVoicePlayback: audioController.stopCurrentVoicePlayback,
    handleMessageAudioEnded: audioController.handleMessageAudioEnded,
  };
}

export function useAudioEndedCleanup(params: {
  audioRef: { current: HTMLAudioElement | null };
  releaseAudioUrl: (audioUrl: string) => Promise<void>;
  setVoiceState: SetState<VoiceState>;
}) {
  const { audioRef, releaseAudioUrl, setVoiceState } = params;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handler = () => {
      const finishedAudioUrl = String(audio.currentSrc || audio.src || '').trim();
      dispatchVoiceEvent('end');
      setVoiceState('idle');
      audio.removeAttribute('src');
      audio.load();
      if (finishedAudioUrl) void releaseAudioUrl(finishedAudioUrl);
    };
    audio.addEventListener('ended', handler);
    return () => audio.removeEventListener('ended', handler);
  }, [audioRef, releaseAudioUrl, setVoiceState]);
}

// ── Voice workflow toggle (former chatVoiceWorkflow.ts) ──

interface CreateVoiceToggleParams {
  streaming: boolean;
  uploadingImages: boolean;
  voiceState: VoiceState;
  voiceSupported: boolean;
  mediaRecorderRef: { current: MediaRecorder | null };
  mediaStreamRef: { current: MediaStream | null };
  recordedChunksRef: { current: Blob[] };
  audioRef: { current: HTMLAudioElement | null };
  activeSessionId: string | null;
  model: string;
  preferredThink: ModelThinkMode;
  messages: Message[];
  imageAttachments: ImageAttachment[];
  buildAttachedContext: () => string;
  clearPendingAttachments: () => void;
  playAudio: (audioUrl: string) => Promise<void>;
  stopCurrentVoicePlayback: () => void;
  setActiveSessionId: SetState<string | null>;
  setMessages: SetState<Message[]>;
  setVoiceError: SetState<string | null>;
  setVoiceState: SetState<VoiceState>;
}

export function createHandleVoiceToggle(params: CreateVoiceToggleParams): () => Promise<void> {
  return async () => {
    if (params.streaming || params.uploadingImages) return;
    if (params.voiceState === 'recording') { params.mediaRecorderRef.current?.stop(); return; }
    if (params.voiceState === 'processing' || params.voiceState === 'speaking') { params.stopCurrentVoicePlayback(); return; }
    if (!params.voiceSupported) { params.setVoiceError('Microphone unavailable in this browser.'); return; }

    try {
      params.setVoiceError(null);
      params.audioRef.current?.pause();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      params.mediaStreamRef.current = stream;
      params.recordedChunksRef.current = [];

      const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });

      recorder.addEventListener('dataavailable', event => {
        if (event.data.size > 0) params.recordedChunksRef.current.push(event.data);
      });

      recorder.addEventListener('stop', async () => {
        stopMicrophoneCapture(params.mediaRecorderRef, params.mediaStreamRef);
        const blob = new Blob(params.recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        params.recordedChunksRef.current = [];

        const effectiveModel = params.model;
        if (blob.size === 0) { params.setVoiceState('idle'); return; }

        try {
          params.setVoiceState('processing');
          params.setVoiceError(null);

          let sessionId = params.activeSessionId;
          if (!sessionId) {
            try {
              const created = await apiClient.sessions.create({ source: 'api-server', model: effectiveModel });
              sessionId = created.data?.id || null;
              if (sessionId) params.setActiveSessionId(sessionId);
            } catch { sessionId = null; }
          }

          const audioDataUrl = await readBlobAsDataUrl(blob);
          const contextText = params.buildAttachedContext();
          const response = await apiClient.voice.respond({
            model: effectiveModel, think: params.preferredThink,
            messages: params.messages.map(m => ({ role: m.role, content: m.content })),
            audioDataUrl, contextText, images: params.imageAttachments,
          });

          const now = Date.now();
          const userVoiceMessage: Message = { role: 'user', content: response.data.transcript, timestamp: now, isVoice: true };
          const assistantVoiceMessage: Message = {
            role: 'assistant', content: response.data.assistantText, timestamp: now,
            audioUrl: response.data.audioUrl, isVoice: true,
          };

          params.clearPendingAttachments();
          params.setMessages(current => [...current, userVoiceMessage, assistantVoiceMessage]);

          if (sessionId) {
            apiClient.sessions.appendMessages(sessionId, {
              model: effectiveModel, source: 'api-server',
              messages: [
                { role: 'user', content: userVoiceMessage.content, timestamp: userVoiceMessage.timestamp },
                { role: 'assistant', content: assistantVoiceMessage.content, timestamp: assistantVoiceMessage.timestamp },
              ],
            }).catch(() => {});
          }

          await params.playAudio(response.data.audioUrl);
        } catch (error) {
          console.error(error);
          params.setVoiceError('Voice pipeline failed. Check STT, NeuTTS Server, and the gateway.');
          params.setVoiceState('idle');
        }
      });

      params.mediaRecorderRef.current = recorder;
      recorder.start(250);
      params.setVoiceState('recording');
    } catch (error) {
      console.error(error);
      stopMicrophoneCapture(params.mediaRecorderRef, params.mediaStreamRef);
      params.setVoiceError('Microphone access denied or unavailable.');
      params.setVoiceState('idle');
    }
  };
}

// ── Speech playback / TTS (former chatSpeechPlayback.ts) ──

interface CreateSpeechPlaybackParams {
  voiceMode: boolean;
  voiceState: VoiceState;
  speakingMessageIndex: number | null;
  messages: Message[];
  playAudioAndWait: (audioUrl: string, signal?: AbortSignal) => Promise<void>;
  stopCurrentVoicePlayback: () => void;
  updateLastAssistantMessage: (updater: (message: Message) => Message) => void;
  updateMessageAtIndex: (index: number, updater: (message: Message) => Message) => void;
  setVoiceError: SetState<string | null>;
  setVoiceState: SetState<VoiceState>;
  setSpeakingMessageIndex: SetState<number | null>;
  voiceSynthesisAbortRef: { current: AbortController | null };
}

export function createSpeechPlayback(params: CreateSpeechPlaybackParams) {
  const speakStreamingText = async (text: string, signal?: AbortSignal) => {
    if (signal?.aborted) throw createVoiceAbortError();
    const response = await apiClient.voice.streamSynthesize(text, { signal });
    if (!response.ok || !response.body) throw new Error(`Speech stream failed with HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let playedAnySegment = false;

    while (true) {
      const { value, done } = await reader.read();
      const chunk = value ? decoder.decode(value, { stream: !done }) : '';
      const parsed = parseSseChunk(buffer, chunk);
      buffer = parsed.buffer;

      for (const event of parsed.events) {
        if (event.error) throw new Error(event.error);
        if (event.event !== 'voice.audio' || !event.payload || typeof event.payload !== 'object') continue;
        const audioUrl = String((event.payload as { audioUrl?: unknown }).audioUrl || '').trim();
        if (!audioUrl) continue;
        playedAnySegment = true;
        await params.playAudioAndWait(audioUrl, signal);
      }

      if (done) break;
    }

    if (!playedAnySegment) throw new Error('Speech stream returned no audio segments');
  };

  const speakText = async (text: string, options?: { cacheAudio?: (audioUrl: string) => void; signal?: AbortSignal }) => {
    try {
      await speakStreamingText(text, options?.signal);
    } catch (error) {
      if (isVoiceAbortError(error)) return;
      const response = await apiClient.voice.synthesize(text);
      options?.cacheAudio?.(response.data.audioUrl);
      await params.playAudioAndWait(response.data.audioUrl, options?.signal);
    }
  };

  const maybeSpeakAssistantReply = async (assistantText: string) => {
    if (!params.voiceMode || !assistantText.trim()) return;
    const controller = new AbortController();
    if (params.voiceSynthesisAbortRef.current) params.voiceSynthesisAbortRef.current.abort();
    params.voiceSynthesisAbortRef.current = controller;

    try {
      params.setVoiceError(null);
      params.setVoiceState('processing');
      await speakText(assistantText, {
        signal: controller.signal,
        cacheAudio: audioUrl => { params.updateLastAssistantMessage(message => ({ ...message, audioUrl })); },
      });
    } catch (error) {
      if (isVoiceAbortError(error)) { params.setVoiceState('idle'); return; }
      params.setVoiceError('Speech synthesis unavailable.');
      params.setVoiceState('idle');
    } finally {
      if (params.voiceSynthesisAbortRef.current === controller) params.voiceSynthesisAbortRef.current = null;
    }
  };

  const speakMessageAt = async (messageIndex: number, rawText: string) => {
    const text = String(rawText || '').trim();
    if (!text) return;
    if (params.speakingMessageIndex === messageIndex && (params.voiceState === 'processing' || params.voiceState === 'speaking')) {
      params.stopCurrentVoicePlayback();
      return;
    }
    if (params.voiceState === 'recording') return;

    const controller = new AbortController();
    if (params.voiceSynthesisAbortRef.current) params.voiceSynthesisAbortRef.current.abort();
    params.voiceSynthesisAbortRef.current = controller;

    const cachedAudioUrl = params.messages[messageIndex]?.audioUrl;
    try {
      params.setVoiceError(null);
      params.setSpeakingMessageIndex(messageIndex);
      if (cachedAudioUrl) { await params.playAudioAndWait(cachedAudioUrl, controller.signal); return; }

      params.setVoiceState('processing');
      await speakText(text, {
        signal: controller.signal,
        cacheAudio: audioUrl => { params.updateMessageAtIndex(messageIndex, message => ({ ...message, audioUrl })); },
      });
    } catch (error) {
      if (isVoiceAbortError(error)) { params.setVoiceState('idle'); return; }
      params.setVoiceError('Speech synthesis unavailable.');
      params.setVoiceState('idle');
    } finally {
      if (params.voiceSynthesisAbortRef.current === controller) params.voiceSynthesisAbortRef.current = null;
      params.setSpeakingMessageIndex(current => (current === messageIndex ? null : current));
    }
  };

  return { speakText, maybeSpeakAssistantReply, speakMessageAt };
}
