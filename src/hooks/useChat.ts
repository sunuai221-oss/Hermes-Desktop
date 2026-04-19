import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useProfiles } from '../contexts/ProfileContext';
import { useGatewayContext } from '../contexts/GatewayContext';
import * as apiClient from '../api';
import type {
  ChatToolCall,
  ContextReferenceAttachment,
  ImageAttachment,
  Message,
  ResolvedContextReference,
} from '../types';

type VoiceState = 'idle' | 'recording' | 'processing' | 'speaking';
export type ChatProvider = 'codex-openai' | 'custom' | 'ollama' | 'nous';
type RuntimeProvider = ChatProvider | 'profile-default';

const MAX_IMAGES = 5;
const ACTIVE_CHAT_SESSION_KEY_PREFIX = 'hermes_active_chat_session:';
const ACTIVE_CHAT_MESSAGES_KEY_PREFIX = 'hermes_active_chat_messages:';
const MESSAGE_OVERHEAD_TOKENS = 6;
const ESTIMATED_IMAGE_TOKENS = 256;
const CONTEXT_WINDOW_KEYS = [
  'context_window',
  'contextWindow',
  'max_context_tokens',
  'maxTokens',
  'max_tokens',
  'num_ctx',
] as const;

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

function isOllamaBaseUrl(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('127.0.0.1:11434') || normalized.includes('localhost:11434');
}

function isLlamaCppBaseUrl(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('127.0.0.1:8081') || normalized.includes('localhost:8081');
}

function normalizeRuntimeValue(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function getRuntimeProviderKey(config: { model?: { provider?: string; base_url?: string } } | null): RuntimeProvider {
  const provider = normalizeRuntimeValue(config?.model?.provider);
  const baseUrl = String(config?.model?.base_url || '').trim();
  if (provider === 'ollama' || ((provider === 'custom' || !provider) && isOllamaBaseUrl(baseUrl))) return 'ollama';
  if (provider === 'custom' || (!provider && !!baseUrl)) return 'custom';
  if (provider === 'codex-openai' || provider === 'openai-codex' || provider === 'openai' || provider === 'codex') return 'codex-openai';
  if (provider === 'nous' || provider === 'nous-research' || provider === 'nousresearch') return 'nous';
  return 'profile-default';
}

function getRuntimeProviderLabel(config: { model?: { provider?: string; base_url?: string } } | null): string {
  const key = getRuntimeProviderKey(config);
  const provider = normalizeRuntimeValue(config?.model?.provider);
  const baseUrl = String(config?.model?.base_url || '').trim();
  if (key === 'ollama') return 'Ollama';
  if (key === 'custom') return isLlamaCppBaseUrl(baseUrl) ? 'llama.cpp' : 'Custom API';
  if (key === 'codex-openai') return 'OpenAI / Codex';
  if (key === 'profile-default') return provider || 'Profile default';
  return 'Nous Research';
}

function estimateTextTokens(text: string): number {
  const normalized = String(text || '').normalize('NFC').trim();
  if (!normalized) return 0;

  let tokens = 0;
  let asciiRun = 0;
  let nonAsciiRun = 0;

  const flush = () => {
    if (asciiRun > 0) {
      tokens += Math.max(1, Math.ceil(asciiRun / 4));
      asciiRun = 0;
    }
    if (nonAsciiRun > 0) {
      tokens += nonAsciiRun;
      nonAsciiRun = 0;
    }
  };

  for (const char of normalized) {
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (char.charCodeAt(0) <= 0x7F) {
      asciiRun += 1;
    } else {
      nonAsciiRun += 1;
    }
  }

  flush();
  return tokens;
}

function buildAttachedContextText(resolvedAttachments: ResolvedContextReference[]): string {
  if (resolvedAttachments.length === 0) return '';
  const blocks = resolvedAttachments.map(item => {
    const header = `### ${item.ref}`;
    const warning = item.warning ? `Warning: ${item.warning}\n` : '';
    const body = item.content || '[no content extracted]';
    return `${header}\n${warning}${body}`;
  }).join('\n\n');
  return `--- Attached Context ---\n\n${blocks}`;
}

function extractAttachedImageCount(text: string): number {
  const match = String(text || '').match(/\[Attached images:\s*(\d+)\]/i);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

function estimateMessageTokens(message: Message): number {
  if (typeof message.tokenCount === 'number' && Number.isFinite(message.tokenCount) && message.tokenCount > 0) {
    return Math.round(message.tokenCount);
  }

  const attachedImages = extractAttachedImageCount(message.content);
  return estimateTextTokens(message.content) + MESSAGE_OVERHEAD_TOKENS + (attachedImages * ESTIMATED_IMAGE_TOKENS);
}

function parseContextWindowValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  const normalized = String(value || '').trim().toLowerCase().replace(/,/g, '');
  if (!normalized) return null;

  const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

function inferContextWindowFromModelName(modelName: string): number | null {
  const match = String(modelName || '').toLowerCase().match(/(?:^|[^a-z0-9])(\d+(?:\.\d+)?)([km])(?:[^a-z0-9]|$)/);
  if (!match) return null;
  return parseContextWindowValue(`${match[1]}${match[2]}`);
}

function getModelContextWindow(config: { model?: Record<string, unknown> } | null, modelName: string): number | null {
  const modelConfig = config?.model;
  if (modelConfig && typeof modelConfig === 'object') {
    for (const key of CONTEXT_WINDOW_KEYS) {
      const parsed = parseContextWindowValue(modelConfig[key]);
      if (parsed) return parsed;
    }
  }
  return inferContextWindowFromModelName(modelName);
}

function normalizeToolCalls(input: unknown): ChatToolCall[] | undefined {
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

function mergeToolCallDeltas(current: ChatToolCall[], deltas: unknown): ChatToolCall[] {
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

function isMessageRole(value: unknown): value is Message['role'] {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function normalizePersistedMessages(input: unknown): Message[] {
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

function getSessionMessagesStorageKey(profile: string, sessionId: string): string {
  return `${ACTIVE_CHAT_MESSAGES_KEY_PREFIX}${profile}:${sessionId}`;
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
  const contextWindowTokens = getModelContextWindow(gateway.config as { model?: Record<string, unknown> } | null, preferredModel);

  // ── State ───────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
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
  const provider = runtimeProvider === 'profile-default' ? undefined : runtimeProvider;
  const model = preferredModel;

  // ── Computed ────────────────────────────────────────────────
  const currentSessionMeta = activeSessionId ? gateway.sessions[activeSessionId] : null;
  const currentSessionLabel = currentSessionMeta?.title || activeSessionId || null;
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
  const persistedContextTokens = useMemo(
    () => messages.reduce((acc, message) => acc + estimateMessageTokens(message), 0),
    [messages],
  );
  const pendingDraftTokens = useMemo(() => {
    const hasPendingDraft = Boolean(input.trim()) || attachments.length > 0 || imageAttachments.length > 0;
    if (!hasPendingDraft) return 0;
    const textSeed = input.trim() || (imageAttachments.length > 0
      ? 'Analyze the attached images.'
      : 'Analyze the attached context references and answer from them.');
    const attachedContext = buildAttachedContextText(resolvedAttachments);
    const enrichedInput = attachedContext ? `${textSeed}\n\n${attachedContext}` : textSeed;
    return estimateTextTokens(enrichedInput) + MESSAGE_OVERHEAD_TOKENS + (imageAttachments.length * ESTIMATED_IMAGE_TOKENS);
  }, [attachments.length, imageAttachments.length, input, resolvedAttachments]);
  const contextTokensEstimate = persistedContextTokens + pendingDraftTokens;
  const contextUsagePercent = contextWindowTokens
    ? Math.min(100, Math.max(0, Math.round((contextTokensEstimate / contextWindowTokens) * 100)))
    : null;

  // ── Effects: init ───────────────────────────────────────────
  useEffect(() => {
    setVoiceSupported(
      typeof window !== 'undefined'
      && typeof navigator !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof MediaRecorder !== 'undefined'
    );
  }, []);


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

  useEffect(() => {
    if (typeof window === 'undefined' || !activeSessionId) return;
    try {
      window.localStorage.setItem(
        getSessionMessagesStorageKey(currentProfile, activeSessionId),
        JSON.stringify(messages),
      );
    } catch {
      // Best-effort only.
    }
  }, [activeSessionId, currentProfile, messages]);

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
  const buildAttachedContext = useCallback(() => buildAttachedContextText(resolvedAttachments), [resolvedAttachments]);

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

  const readPersistedMessages = useCallback((sessionId: string | null): Message[] => {
    if (!sessionId || typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(getSessionMessagesStorageKey(currentProfile, sessionId));
      if (!raw) return [];
      return normalizePersistedMessages(JSON.parse(raw));
    } catch {
      return [];
    }
  }, [currentProfile]);

  const hydrateSession = useCallback(async (sessionId: string | null) => {
    if (!sessionId) { setActiveSessionId(null); setMessages([]); return; }
    const draftMessages = readPersistedMessages(sessionId);
    setActiveSessionId(sessionId);
    if (draftMessages.length > 0) {
      setMessages(draftMessages);
    }
    try {
      const response = await apiClient.sessions.transcript(sessionId);
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
      setMessages(draftMessages.length >= transcript.length ? draftMessages : transcript);
    } catch {
      if (draftMessages.length === 0) {
        setMessages([]);
      }
    }
  }, [readPersistedMessages]);

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
    const effectiveModel = model;

    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const created = await apiClient.sessions.create({ source: 'api-server', title: 'Hermes Desktop chat session', model: effectiveModel });
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
    let finalAssistantToolCalls: ChatToolCall[] | undefined;
    let finalAssistantToolName: string | undefined;
    let finalAssistantToolResults: unknown;
    let persistedByGateway = false;
    try {
      const response = await apiClient.gateway.streamChat({ model: effectiveModel, provider, think: preferredThink, messages: payloadMessages, stream: true, session_id: sessionId || undefined, source: 'api-server' });
      if (!response.ok) throw new Error('Stream failed');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Reader unavailable');
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let accumulatedToolCalls: ChatToolCall[] = [];
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
            const toolCalls = parsed.choices?.[0]?.delta?.tool_calls;
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
              accumulatedToolCalls = mergeToolCallDeltas(accumulatedToolCalls, toolCalls);
              finalAssistantToolCalls = accumulatedToolCalls;
              updateLastAssistantMessage(message => ({ ...message, toolCalls: accumulatedToolCalls }));
            }
            if (!content) continue;
            accumulated += content;
            updateLastAssistantMessage(message => ({ ...message, content: accumulated }));
          } catch { continue; }
        }
      }
      finalAssistantText = accumulated;
      finalAssistantToolCalls = accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined;
      await maybeSpeakAssistantReply(accumulated);
    } catch {
      try {
        const response = await apiClient.gateway.chat({ model: effectiveModel, provider, think: preferredThink, messages: payloadMessages, session_id: sessionId || undefined, source: 'api-server' });
        const assistantMessage = response.data.choices?.[0]?.message || {};
        const content = assistantMessage.content || 'No response.';
        finalAssistantText = content;
        finalAssistantToolCalls = normalizeToolCalls(assistantMessage.tool_calls);
        finalAssistantToolName = typeof assistantMessage.tool_name === 'string' ? assistantMessage.tool_name : undefined;
        finalAssistantToolResults = Object.prototype.hasOwnProperty.call(assistantMessage, 'tool_results')
          ? assistantMessage.tool_results
          : undefined;
        persistedByGateway = true;
        if (!sessionId && response.data?.session_id) { sessionId = String(response.data.session_id); setActiveSessionId(sessionId); }
        updateLastAssistantMessage(message => ({
          ...message,
          content,
          toolCalls: finalAssistantToolCalls,
          toolName: finalAssistantToolName,
          toolResults: finalAssistantToolResults,
        }));
        await maybeSpeakAssistantReply(content);
      } catch {
        finalAssistantText = 'Gateway unreachable. Verify that the Hermes Gateway is running.';
        updateLastAssistantMessage(message => ({ ...message, content: finalAssistantText }));
      }
    } finally {
      if (sessionId && !persistedByGateway && (finalAssistantText || finalAssistantToolCalls?.length || finalAssistantToolName || finalAssistantToolResults != null)) {
        apiClient.sessions.appendMessages(sessionId, { model: effectiveModel, source: 'api-server', messages: [
          { role: 'user', content: userMsg.content, timestamp: userMsg.timestamp },
          {
            role: 'assistant',
            content: finalAssistantText,
            timestamp: Date.now(),
            tool_calls: finalAssistantToolCalls,
            tool_name: finalAssistantToolName,
            tool_results: finalAssistantToolResults,
          },
        ] }).catch(() => {});
      }
      setStreaming(false);
    }
  }, [activeSessionId, attachments.length, buildUserContent, clearPendingAttachments, imageAttachments, input, messages, model, maybeSpeakAssistantReply, preferredThink, provider, streaming, updateLastAssistantMessage, uploadingImages, voiceState]);

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
        const effectiveModel = model;
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
  }, [audioRef, buildAttachedContext, clearPendingAttachments, imageAttachments, messages, model, playAudio, preferredThink, streaming, uploadingImages, voiceState, voiceSupported]);

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
    attachments, imageAttachments, uploadingImages,
    imageError, newAttachmentKind, newAttachmentValue, resolvedAttachments,
    resolvingRefs, voiceMode, voiceState, voiceError, voiceSupported,
    // Computed
    currentSessionId: activeSessionId,
    currentSessionLabel,
    totalResolvedChars, canAddReference,
    voiceStatusLabel, contextStatusLabel,
    contextTokensEstimate, contextWindowTokens, contextUsagePercent,
    preferredModel, runtimeProvider, runtimeProviderLabel,
    // Setters
    setInput, setVoiceMode,
    setNewAttachmentKind, setNewAttachmentValue,
    // Actions
    send, handleNewChat, handleVoiceToggle,
    addAttachment, removeAttachment,
    attachImageFiles, removeImage,
    handlePaste, handleFileSelection,
    hydrateSession,
  };
}

