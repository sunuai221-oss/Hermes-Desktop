import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, KeyRound, Loader2, Mic, User, Volume2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Message } from '../../types';

interface ChatMessagesProps {
  messages: Message[];
  streaming: boolean;
  sessionId?: string | null;
  showThinking: boolean;
  showTools: boolean;
  speakingMessageIndex?: number | null;
  onSpeakMessage?: (index: number, content: string) => Promise<void> | void;
}

const SCROLL_BOTTOM_THRESHOLD = 96;

export function ChatMessages({
  messages,
  streaming,
  sessionId = null,
  showThinking,
  showTools,
  speakingMessageIndex = null,
  onSpeakMessage,
}: ChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const previousSessionIdRef = useRef<string | null>(sessionId);
  const copyTimerRef = useRef<number | null>(null);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);

  useEffect(() => {
    if (messages.length === 0) return;

    const container = containerRef.current;
    if (!container) return;

    const updateStickiness = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
    };

    updateStickiness();
    container.addEventListener('scroll', updateStickiness, { passive: true });
    return () => container.removeEventListener('scroll', updateStickiness);
  }, [messages.length]);

  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return;
    previousSessionIdRef.current = sessionId;
    stickToBottomRef.current = true;
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [sessionId]);

  useEffect(() => () => {
    if (copyTimerRef.current != null) {
      window.clearTimeout(copyTimerRef.current);
    }
  }, []);

  const handleCopyMessage = useCallback(async (messageIndex: number, content: string) => {
    const text = String(content || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageIndex(messageIndex);
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedMessageIndex(current => (current === messageIndex ? null : current));
      }, 1500);
    } catch {
      // ignore clipboard errors silently
    }
  }, []);

  const handleSpeakMessage = useCallback((messageIndex: number, content: string) => {
    if (!onSpeakMessage) return;
    void onSpeakMessage(messageIndex, content);
  }, [onSpeakMessage]);

  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    chatEndRef.current?.scrollIntoView({
      behavior: streaming ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [messages.length, lastMessage?.content, lastMessage?.audioUrl, streaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full min-h-[40vh]">
        <div className="text-center">
          <Bot size={40} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">Send a message, attach context, paste an image, or speak through the microphone.</p>
          <p className="text-muted-foreground/50 text-xs mt-1">Vision multi-images + push-to-talk + Kokoro TTS backend.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-5 space-y-4">
      {messages.map((message, index) => (
        shouldRenderMessage(message, showThinking, showTools, streaming && index === messages.length - 1 && message.role === 'assistant') ? (
          <div
            key={index}
            className={cn(
              'flex gap-3 max-w-[85%] animate-fade-in',
              message.role === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto',
            )}
          >
            <div className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
              message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}>
              {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div className={cn(
              'px-4 py-3 rounded-lg text-sm leading-relaxed',
              message.role === 'user'
                ? 'bg-primary/15 border border-primary/15 text-foreground'
                : 'bg-muted/50 border border-border text-foreground',
            )}>
              {(() => {
                const isStreamingAssistant = streaming && index === messages.length - 1 && message.role === 'assistant';
                const hasMessageText = String(message.content || '').trim().length > 0;
                const isSpeaking = speakingMessageIndex === index;

                return (
                  <>
                    {message.isVoice && (
                      <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                        <Mic size={10} />
                        Voice
                      </div>
                    )}
                    <MessageContent content={message.content} showThinking={showThinking} />
                    {showTools && hasToolData(message) && <ToolCallList message={message} />}
                    {message.audioUrl && (
                      <audio controls preload="none" src={message.audioUrl} className="mt-3 w-full max-w-sm" />
                    )}
                    {hasMessageText && (
                      <div className="mt-3 flex items-center gap-1.5">
                        <button
                          onClick={() => void handleCopyMessage(index, message.content)}
                          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          title="Copy message"
                          aria-label="Copy message"
                        >
                          {copiedMessageIndex === index ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedMessageIndex === index ? 'Copied' : 'Copy'}</span>
                        </button>
                        <button
                          onClick={() => handleSpeakMessage(index, message.content)}
                          disabled={!onSpeakMessage || isStreamingAssistant}
                          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                          title={isSpeaking ? 'Synthesizing...' : 'Speak message'}
                          aria-label="Speak message"
                        >
                          {isSpeaking ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={12} />}
                          <span>{isSpeaking ? 'Speaking...' : 'Speak'}</span>
                        </button>
                      </div>
                    )}
                    {isStreamingAssistant && (
                      <span className="inline-block w-2 h-4 bg-primary/60 ml-0.5 animate-pulse rounded-sm" />
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        ) : null
      ))}
      <div ref={chatEndRef} />
    </div>
  );
}

// ── Inline markdown (simplified for component) ─────────────

function MessageContent({ content, showThinking }: { content: string; showThinking: boolean }) {
  if (!content) return null;
  const segments = splitThinkSegments(content).filter(segment => showThinking || segment.kind !== 'think');
  if (segments.length === 0) return null;
  return (
    <div className="space-y-3">
      {segments.map((segment, index) => (
        <div
          key={`${segment.kind}_${index}`}
          className={segment.kind === 'think' ? 'text-muted-foreground/70' : 'text-foreground'}
        >
          <RenderedSegment content={segment.content} isThink={segment.kind === 'think'} />
        </div>
      ))}
    </div>
  );
}

function ToolCallList({ message }: { message: Message }) {
  const toolCalls = message.toolCalls || [];
  const resultText = stringifyToolPayload(message.toolResults);

  return (
    <div className="mt-3 space-y-2">
      {toolCalls.map((toolCall, index) => {
        const toolName = toolCall.function?.name || toolCall.name || `tool ${index + 1}`;
        const argumentsText = stringifyToolPayload(toolCall.function?.arguments || toolCall.arguments);
        return (
          <div key={toolCall.id || `${toolName}_${index}`} className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
              <KeyRound size={11} />
              <span>{toolName}</span>
            </div>
            {argumentsText && (
              <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background/60 px-2.5 py-2 text-[11px] text-muted-foreground/80">
                {argumentsText}
              </pre>
            )}
          </div>
        );
      })}
      {!toolCalls.length && message.toolName && (
        <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <KeyRound size={11} />
            <span>{message.toolName}</span>
          </div>
        </div>
      )}
      {resultText && (
        <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2">
          <div className="text-[11px] font-medium text-muted-foreground/80">Tool result</div>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background/60 px-2.5 py-2 text-[11px] text-muted-foreground/80">
            {resultText}
          </pre>
        </div>
      )}
    </div>
  );
}

function RenderedSegment({ content, isThink }: { content: string; isThink: boolean }) {
  const blocks = content.split('\n');
  return (
    <div className="space-y-1">
      {blocks.map((block, i) => {
        if (block.startsWith('```')) return null;
        if (block.startsWith('#')) {
          const match = block.match(/^(#+)\s/);
          if (match) {
            const level = match[1].length;
            const text = block.slice(match[0].length);
            const cls = cn('font-semibold mt-2', isThink ? 'text-muted-foreground/75' : 'text-foreground');
            if (level === 1) return <h1 key={i} className={cls}>{text}</h1>;
            if (level === 2) return <h2 key={i} className={cls}>{text}</h2>;
            if (level === 3) return <h3 key={i} className={cls}>{text}</h3>;
            if (level === 4) return <h4 key={i} className={cls}>{text}</h4>;
            if (level === 5) return <h5 key={i} className={cls}>{text}</h5>;
            return <h6 key={i} className={cls}>{text}</h6>;
          }
        }
        return (
          <p key={i} className={cn('whitespace-pre-wrap', isThink ? 'text-muted-foreground/70' : 'text-foreground')}>
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}

function splitThinkSegments(content: string): Array<{ kind: 'think' | 'output'; content: string }> {
  const regex = /<\/?think>/gi;
  const segments: Array<{ kind: 'think' | 'output'; content: string }> = [];
  let mode: 'think' | 'output' = 'output';
  let cursor = 0;

  const pushSegment = (kind: 'think' | 'output', value: string) => {
    if (!value) return;
    const normalized = value.replace(/^\n+|\n+$/g, '');
    if (!normalized) return;
    const previous = segments[segments.length - 1];
    if (previous?.kind === kind) {
      previous.content = `${previous.content}\n${normalized}`;
      return;
    }
    segments.push({ kind, content: normalized });
  };

  for (const match of content.matchAll(regex)) {
    const index = match.index ?? 0;
    const token = match[0].toLowerCase();
    pushSegment(mode, content.slice(cursor, index));
    mode = token === '<think>' ? 'think' : 'output';
    cursor = index + match[0].length;
  }

  pushSegment(mode, content.slice(cursor));
  return segments.length > 0 ? segments : [{ kind: 'output', content }];
}

function hasToolData(message: Message): boolean {
  return Boolean(message.toolCalls?.length || message.toolName || message.toolResults != null);
}

function hasVisibleTextContent(content: string, showThinking: boolean): boolean {
  const segments = splitThinkSegments(content).filter(segment => showThinking || segment.kind !== 'think');
  return segments.some(segment => segment.content.trim().length > 0);
}

function shouldRenderMessage(message: Message, showThinking: boolean, showTools: boolean, isStreamingAssistant: boolean): boolean {
  if (isStreamingAssistant) return true;
  if (message.audioUrl || message.isVoice) return true;
  if (showTools && hasToolData(message)) return true;
  return hasVisibleTextContent(message.content, showThinking);
}

function stringifyToolPayload(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(<code key={key++} className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }
    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="font-semibold">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }
    // Italic
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }
    // Plain text
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    }
    if (nextSpecial === 0) {
      // Prevent infinite loops on unmatched markdown markers like
      // "* bullet" or stray backticks emitted by the model.
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
      continue;
    }
    parts.push(remaining.slice(0, nextSpecial));
    remaining = remaining.slice(nextSpecial);
  }

  return <>{parts}</>;
}
