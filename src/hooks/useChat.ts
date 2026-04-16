import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useProfiles } from '../contexts/ProfileContext';
import { useGatewayContext } from '../contexts/GatewayContext';
import * as apiClient from '../api';
import type {
  ContextReferenceAttachment,
  ImageAttachment,
  Message,
  ProviderModelOption,
  ResolvedContextReference,
} from '../types';

type VoiceState = 'idle' | 'recording' | 'processing' | 'speaking';
export type ChatProvider = 'codex-openai' | 'ollama' | 'lmstudio' | 'nous';

const MAX_IMAGES = 5;
const ACTIVE_CHAT_SESSION_KEY_PREFIX = 'hermes_active_chat_session:';

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

// ── Helpers ─────────────────────────────────────────────────────

function stopMicrophoneCapture(
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

function toReferenceString(ref: ContextReferenceAttachment): string {
  if (ref.kind === 'diff' || ref.kind === 'staged') return `@${ref.kind}`;
  if (ref.kind === 'git') return `@git:${ref.value}`;
  return `@${ref.kind}:${ref.value}`;
}

function buildVisionContent(text: string, images: ImageAttachment[]): string {
  if (images.length === 0) return text;
  const imageBlock = images
    .map((img, i) => `![image-${i + 1}](${img.path || img.dataUrl})`)
    .join('\n');
  return `${text}\n\n${imageBlock}`;
}

function extractImageFilesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function convertDataUrlToPng(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unsupported')); return; }
      ctx.drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

async function normalizeImageFile(file: File): Promise<{ fileName: string; dataUrl: string; width: number; height: number }> {
  const raw = await readBlobAsDataUrl(file);
  if (file.type === 'image/png') {
    const dims = await readImageDimensions(raw);
    return { fileName: file.name, dataUrl: raw, ...dims };
  }
  const converted = await convertDataUrlToPng(raw);
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return { fileName: `${baseName}.png`, ...converted };
}

function getRuntimeProviderKey(config: { model?: { provider?: string } } | null): ChatProvider {
  const p = config?.model?.provider?.toLowerCase();
  if (p === 'ollama') return 'ollama';
  if (p === 'lmstudio') return 'lmstudio';
  if (p === 'nous') return 'nous';
  return 'codex-openai';
}

function getRuntimeProviderLabel(config: { model?: { provider?: string } } | null): string {
  const key = getRuntimeProviderKey(config);
  if (key === 'ollama') return 'Ollama';
  if (key === 'lmstudio') return 'LM Studio';
  if (key === 'nous') return 'Nous Research';
  return 'OpenAI / Codex';
}

function getModelOptions(
  provider: ChatProvider,
  preferredModel: string,
  ollamaModels: Array<{ name: string }>,
  lmStudioModels: ProviderModelOption[],
): Array<{ label: string; value: string }> {
  if (provider === 'codex-openai') {
    const defaults = ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'codex-mini'];
    const extras = preferredModel && !defaults.includes(preferredModel) ? [preferredModel] : [];
    return [...extras, ...defaults].map(name => ({ label: name, value: name }));
  }
  if (provider === 'nous') {
    const defaults = ['mimo-v2-pro', 'deephermes-3', 'hermes-3'];
    const extras = preferredModel && !defaults.includes(preferredModel) ? [preferredModel] : [];
    return [...extras, ...defaults].map(name => ({ label: name, value: name }));
  }
  if (provider === 'ollama') {
    return ollamaModels.map(m => ({ label: m.name, value: m.name }));
  }
  return lmStudioModels.map(m => ({ label: m.name, value: m.id ?? m.name }));
}

// ── Hook ────────────────────────────────────────────────────────

interface UseChatOptions {
  requestedSessionId?: string | null;
  requestNonce?: number;
  audioRef: RefObject<HTMLAudioElement | null>;
}

export function useChat({ requestedSessionId = null, requestNonce = 0, audioRef }: UseChatOptions) {
  const gateway = useGatewayContext();
  const { currentProfile } = useProfiles();

  // ── Config ──────────────────────────────────────────────────
  const preferredModel = gateway.config?.model?.default || 'qwen3.5:27b';
  const preferredThink = gateway.config?.model?.think ?? 'low';
  const runtimeProvider = getRuntimeProviderKey(gateway.config);
  const runtimeProviderLabel = getRuntimeProviderLabel(gateway.config);
  const sessionStorageKey = `${ACTIVE_CHAT_SESSION_KEY_PREFIX}${currentProfile}`;

  // ── State ───────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState<ChatProvider>('codex-openai');
  const [lmStudioModels, setLmStudioModels] = useState<ProviderModelOption[]>([]);
  const [attachments, setAttachments] = useState<ContextReferenceAttachment[]>([]);
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [newAttachmentKind, setNewAttachmentKind] = useState<ContextReferenceAttachment['kind']>('file');
  const [newAttachmentValue, setNewAttachmentValue] = useState('');
  const [resolvedAttachments, setResolvedAttachments] = useState<ResolvedContextReference[]>([]);
  const [resolvingRefs, setResolvingRefs] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);

  // ── Refs ────────────────────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // ── Computed ────────────────────────────────────────────────
  const currentSessionMeta = activeSessionId ? gateway.sessions[activeSessionId] : null;
  const currentSessionLabel = currentSessionMeta?.title || activeSessionId || null;
  const modelOptions = useMemo(
    () => getModelOptions(provider, preferredModel, gateway.models, lmStudioModels),
    [provider, preferredModel, gateway.models, lmStudioModels],
  );
  const totalResolvedChars = useMemo(
    () => resolvedAttachments.reduce((acc, item) => acc + item.charCount, 0),
    [resolvedAttachments],
  );
  const canAddReference = useMemo(() => {
    if (newAttachmentKind === 'diff' || newAttachmentKind === 'staged') {
      return !attachments.some(item => item.kind === newAttachmentKind);
    }
    return Boolean(newAttachmentValue.trim());
  }, [attachments, newAttachmentKind, newAttachmentValue]);

  // ── Effects: init ───────────────────────────────────────────
  useEffect(() => {
    setVoiceSupported(
      typeof window !== 'undefined'
      && typeof navigator !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof MediaRecorder !== 'undefined'
    );
  }, []);

  useEffect(() => { setProvider(runtimeProvider); }, [runtimeProvider]);

  useEffect(() => {
    if (provider !== 'lmstudio') return;
    apiClient.models.lmstudio()
      .then(res => setLmStudioModels(Array.isArray(res.data?.models) ? res.data.models : []))
      .catch(() => setLmStudioModels([]));
  }, [provider]);

  useEffect(() => {
    if (model) return;
    if (preferredModel) { setModel(preferredModel); return; }
    if (modelOptions.length > 0) { setModel(modelOptions[0].value); }
  }, [model, modelOptions, preferredModel]);

  useEffect(() => {
    if (provider === 'codex-openai') { setModel(preferredModel || ''); return; }
    if (provider === 'nous') { setModel(preferredModel || ''); return; }
    if (provider === 'ollama') { setModel(gateway.models[0]?.name || preferredModel || ''); return; }
    setModel(lmStudioModels[0]?.name || preferredModel || '');
  }, [provider, preferredModel, gateway.models, lmStudioModels]);

  useEffect(() => {
    const delegatedDraft = localStorage.getItem('hermes-chat-draft');
    if (delegatedDraft) {
      setInput(delegatedDraft);
      localStorage.removeItem('hermes-chat-draft');
    }
  }, []);

  // ── Effects: session persistence ────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedSessionId = window.localStorage.getItem(sessionStorageKey);
    if (storedSessionId) { void hydrateSession(storedSessionId); return; }
    setActiveSessionId(null);
    setMessages([]);
  }, [currentProfile, sessionStorageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!requestNonce) return;
    if (requestedSessionId) { void hydrateSession(requestedSessionId); return; }
    handleNewChat();
  }, [requestNonce, requestedSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeSessionId) {
      window.localStorage.setItem(sessionStorageKey, activeSessionId);
    } else {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, [activeSessionId, sessionStorageKey]);

  // ── Effects: resolve attachments ────────────────────────────
  useEffect(() => {
    if (attachments.length === 0) { setResolvedAttachments([]); return; }
    let cancelled = false;
    setResolvingRefs(true);
    const refStrings = attachments.map(toReferenceString);
    apiClient.contextReferences.resolve(refStrings)
      .then(res => {
        if (cancelled) return;
        const results = Array.isArray(res.data) ? res.data : [];
        setResolvedAttachments(results.map((r: ResolvedContextReference, i: number) => ({
          ref: r.ref || refStrings[i],
          kind: r.kind || attachments[i]?.kind || 'file',
          label: r.label || attachments[i]?.value || '',
          content: r.content || '[no content]',
          charCount: r.charCount || 0,
          warning: r.warning,
        })));
        setResolvingRefs(false);
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedAttachments(attachments.map((ref, i) => ({
          ref: refStrings[i],
          kind: ref.kind,
          label: ref.value,
          content: '[Resolution failed]',
          charCount: 0,
          warning: 'Could not resolve this reference.',
        })));
        setResolvingRefs(false);
      });
    return () => { cancelled = true; };
  }, [attachments]);

  // ── Effects: audio ended ────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handler = () => setVoiceState('idle');
    audio.addEventListener('ended', handler);
    return () => audio.removeEventListener('ended', handler);
  }, [audioRef]);

  // ── Callbacks ───────────────────────────────────────────────
  const buildAttachedContext = useCallback(() => {
    if (resolvedAttachments.length === 0) return '';
    const blocks = resolvedAttachments.map(item => {
      const header = `### ${item.ref}`;
      const warning = item.warning ? `Warning: ${item.warning}\n` : '';
      const body = item.content || '[no content extracted]';
      return `${header}\n${warning}${body}`;
    }).join('\n\n');
    return `--- Attached Context ---\n\n${blocks}`;
  }, [resolvedAttachments]);

  const buildUserContent = useCallback((base: string) => {
    const context = buildAttachedContext();
    return context ? `${base}\n\n${context}` : base;
  }, [buildAttachedContext]);

  const updateLastAssistantMessage = useCallback((updater: (message: Message) => Message) => {
    setMessages(current => {
      const copy = [...current];
      for (let index = copy.length - 1; index >= 0; index -= 1) {
        if (copy[index].role !== 'assistant') continue;
        copy[index] = updater(copy[index]);
        return copy;
      }
      return current;
    });
  }, []);

  const playAudio = useCallback(async (audioUrl: string) => {
    const audio = audioRef.current;
    if (!audioUrl || !audio) return;
    audio.pause();
    audio.src = audioUrl;
    audio.load();
    try {
      setVoiceState('speaking');
      await audio.play();
    } catch {
      setVoiceError('Autoplay was blocked. Use the message audio player.');
      setVoiceState('idle');
    }
  }, [audioRef]);

  const maybeSpeakAssistantReply = useCallback(async (assistantText: string) => {
    if (!voiceMode || !assistantText.trim()) return;
    try {
      setVoiceError(null);
      setVoiceState('processing');
      const response = await apiClient.voice.synthesize(assistantText);
      updateLastAssistantMessage(message => ({ ...message, audioUrl: response.data.audioUrl }));
      await playAudio(response.data.audioUrl);
    } catch {
      setVoiceError('Speech synthesis unavailable.');
      setVoiceState('idle');
    }
  }, [playAudio, updateLastAssistantMessage, voiceMode]);

  const clearPendingAttachments = useCallback(() => {
    setAttachments([]);
    setResolvedAttachments([]);
    setImageAttachments([]);
  }, []);

  const resetComposer = useCallback(() => {
    setInput('');
    clearPendingAttachments();
    setNewAttachmentValue('');
    setImageError(null);
    setVoiceError(null);
  }, [clearPendingAttachments]);

  const hydrateSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId) { setActiveSessionId(null); setMessages([]); return; }
    try {
      const response = await apiClient.sessions.transcript(sessionId);
      const transcript = Array.isArray(response.data)
        ? response.data
            .filter((entry): entry is Message => entry?.role === 'user' || entry?.role === 'assistant' || entry?.role === 'system')
            .map((entry) => ({
              role: entry.role,
              content: typeof entry.content === 'string' ? entry.content : String(entry.content ?? ''),
              timestamp: entry.timestamp,
            }))
        : [];
      setActiveSessionId(sessionId);
      setMessages(transcript);
    } catch {
      setActiveSessionId(sessionId);
      setMessages([]);
    }
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    resetComposer();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, [resetComposer, sessionStorageKey]);

  const addAttachment = useCallback(() => {
    const template = referenceTemplates.find(item => item.kind === newAttachmentKind);
    if (!template) return;
    if ((newAttachmentKind === 'diff' || newAttachmentKind === 'staged') && attachments.some(item => item.kind === newAttachmentKind)) return;
    if ((newAttachmentKind === 'file' || newAttachmentKind === 'folder' || newAttachmentKind === 'git' || newAttachmentKind === 'url') && !newAttachmentValue.trim()) return;
    const value = newAttachmentKind === 'diff' || newAttachmentKind === 'staged' ? template.label : newAttachmentValue.trim();
    setAttachments(current => [...current, { id: `${newAttachmentKind}_${Date.now()}`, kind: newAttachmentKind, value }]);
    setNewAttachmentValue('');
  }, [attachments, newAttachmentKind, newAttachmentValue]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(current => current.filter(item => item.id !== id));
  }, []);

  const attachImageFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const availableSlots = MAX_IMAGES - imageAttachments.length;
    const selectedFiles = files.filter(file => file.type.startsWith('image/')).slice(0, availableSlots);
    if (selectedFiles.length === 0) {
      setImageError(imageAttachments.length >= MAX_IMAGES ? `Maximum ${MAX_IMAGES} images per message.` : 'No usable image detected.');
      return;
    }
    setUploadingImages(true);
    setImageError(null);
    try {
      const uploaded = await Promise.all(selectedFiles.map(async file => {
        const normalized = await normalizeImageFile(file);
        const response = await apiClient.images.upload(normalized.fileName, normalized.dataUrl);
        return { ...response.data, dataUrl: normalized.dataUrl, width: normalized.width, height: normalized.height } satisfies ImageAttachment;
      }));
      setImageAttachments(current => [...current, ...uploaded]);
    } catch (error) {
      console.error(error);
      setImageError("Could not add the image.");
    } finally {
      setUploadingImages(false);
    }
  }, [imageAttachments.length]);

  const removeImage = useCallback((id: string) => {
    setImageAttachments(current => current.filter(item => item.id !== id));
  }, []);

  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLElement>) => {
    const files = extractImageFilesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await attachImageFiles(files);
  }, [attachImageFiles]);

  const handleFileSelection = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await attachImageFiles(files);
    event.target.value = '';
  }, [attachImageFiles]);

  const send = useCallback(async () => {
    if ((!input.trim() && attachments.length === 0 && imageAttachments.length === 0) || streaming || uploadingImages || voiceState === 'recording' || voiceState === 'processing') return;

    const textSeed = input.trim() || (imageAttachments.length > 0 ? 'Analyze the attached images.' : 'Analyze the attached context references and answer from them.');
    const enrichedInput = buildUserContent(textSeed);
    const displayContent = imageAttachments.length > 0 ? `${enrichedInput}\n\n[Attached images: ${imageAttachments.length}]` : enrichedInput;
    const userMsg: Message = { role: 'user', content: displayContent, timestamp: Date.now() };
    const currentImages = imageAttachments;
    const effectiveModel = model || preferredModel;

    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const created = await apiClient.sessions.create({ source: 'api-server', title: 'builder chat session', model: effectiveModel });
        sessionId = created.data?.id || null;
        if (sessionId) setActiveSessionId(sessionId);
      } catch { sessionId = null; }
    }

    setInput('');
    setStreaming(true);
    clearPendingAttachments();
    setMessages(current => [...current, userMsg, { role: 'assistant', content: '', timestamp: Date.now() }]);

    const payloadMessages = [
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: buildVisionContent(enrichedInput, currentImages) },
    ];

    let finalAssistantText = '';
    let persistedByGateway = false;
    try {
      const response = await apiClient.gateway.streamChat({ model: effectiveModel, provider, think: preferredThink, messages: payloadMessages, stream: true, session_id: sessionId || undefined, source: 'api-server' });
      if (!response.ok) throw new Error('Stream failed');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Reader unavailable');
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (!content) continue;
            accumulated += content;
            updateLastAssistantMessage(message => ({ ...message, content: accumulated }));
          } catch { continue; }
        }
      }
      finalAssistantText = accumulated;
      await maybeSpeakAssistantReply(accumulated);
    } catch {
      try {
        const response = await apiClient.gateway.chat({ model: effectiveModel, provider, think: preferredThink, messages: payloadMessages, session_id: sessionId || undefined, source: 'api-server' });
        const content = response.data.choices?.[0]?.message?.content || 'No response.';
        finalAssistantText = content;
        persistedByGateway = true;
        if (!sessionId && response.data?.session_id) { sessionId = String(response.data.session_id); setActiveSessionId(sessionId); }
        updateLastAssistantMessage(message => ({ ...message, content }));
        await maybeSpeakAssistantReply(content);
      } catch {
        finalAssistantText = 'Gateway unreachable. Verify that the Hermes Gateway is running.';
        updateLastAssistantMessage(message => ({ ...message, content: finalAssistantText }));
      }
    } finally {
      if (sessionId && finalAssistantText && !persistedByGateway) {
        apiClient.sessions.appendMessages(sessionId, { model: effectiveModel, source: 'api-server', messages: [
          { role: 'user', content: userMsg.content, timestamp: userMsg.timestamp },
          { role: 'assistant', content: finalAssistantText, timestamp: Date.now() },
        ] }).catch(() => {});
      }
      setStreaming(false);
    }
  }, [activeSessionId, attachments.length, buildUserContent, clearPendingAttachments, imageAttachments, input, messages, model, maybeSpeakAssistantReply, preferredModel, preferredThink, provider, streaming, updateLastAssistantMessage, uploadingImages, voiceState]);

  const handleVoiceToggle = useCallback(async () => {
    if (streaming || uploadingImages || voiceState === 'processing') return;
    if (voiceState === 'recording') { mediaRecorderRef.current?.stop(); return; }
    if (!voiceSupported) { setVoiceError('Microphone unavailable in this browser.'); return; }
    try {
      setVoiceError(null);
      audioRef.current?.pause();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });
      recorder.addEventListener('dataavailable', event => { if (event.data.size > 0) recordedChunksRef.current.push(event.data); });
      recorder.addEventListener('stop', async () => {
        stopMicrophoneCapture(mediaRecorderRef, mediaStreamRef);
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        recordedChunksRef.current = [];
        const effectiveModel = model || preferredModel;
        if (blob.size === 0) { setVoiceState('idle'); return; }
        try {
          setVoiceState('processing');
          setVoiceError(null);
          const audioDataUrl = await readBlobAsDataUrl(blob);
          const contextText = buildAttachedContext();
          const response = await apiClient.voice.respond({ model: effectiveModel, think: preferredThink, messages: messages.map(m => ({ role: m.role, content: m.content })), audioDataUrl, contextText, images: imageAttachments });
          clearPendingAttachments();
          setMessages(current => [...current, { role: 'user', content: response.data.transcript, timestamp: Date.now(), isVoice: true }, { role: 'assistant', content: response.data.assistantText, timestamp: Date.now(), audioUrl: response.data.audioUrl, isVoice: true }]);
          await playAudio(response.data.audioUrl);
        } catch (error) {
          console.error(error);
          setVoiceError('Voice pipeline failed. Check STT, Edge TTS, and the gateway.');
          setVoiceState('idle');
        }
      });
      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setVoiceState('recording');
    } catch (error) {
      console.error(error);
      stopMicrophoneCapture(mediaRecorderRef, mediaStreamRef);
      setVoiceError('Microphone access denied or unavailable.');
      setVoiceState('idle');
    }
  }, [audioRef, buildAttachedContext, clearPendingAttachments, imageAttachments, messages, model, playAudio, preferredModel, preferredThink, streaming, uploadingImages, voiceState, voiceSupported]);

  // ── Voice label ─────────────────────────────────────────────
  const voiceStatusLabel = voiceState === 'recording' ? 'Recording...'
    : voiceState === 'processing' ? 'Transcription + reply + TTS...'
    : voiceState === 'speaking' ? 'Playing audio'
    : voiceMode ? 'Voice mode active' : 'Voice mode inactive';

  const contextStatusLabel = resolvingRefs
    ? `Resolving ${attachments.length} reference(s)...`
    : `${attachments.length} text reference(s) - ${totalResolvedChars} chars - ${imageAttachments.length} image(s)`;

  // ── Return ──────────────────────────────────────────────────
  return {
    // State
    messages, activeSessionId, input, streaming, model, provider,
    lmStudioModels, attachments, imageAttachments, uploadingImages,
    imageError, newAttachmentKind, newAttachmentValue, resolvedAttachments,
    resolvingRefs, voiceMode, voiceState, voiceError, voiceSupported,
    // Computed
    currentSessionId: activeSessionId,
    currentSessionLabel,
    modelOptions, totalResolvedChars, canAddReference,
    voiceStatusLabel, contextStatusLabel,
    preferredModel, runtimeProvider, runtimeProviderLabel,
    // Setters
    setInput, setModel, setProvider, setVoiceMode,
    setNewAttachmentKind, setNewAttachmentValue,
    // Actions
    send, handleNewChat, handleVoiceToggle,
    addAttachment, removeAttachment,
    attachImageFiles, removeImage,
    handlePaste, handleFileSelection,
    hydrateSession,
  };
}
