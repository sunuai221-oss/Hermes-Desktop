import { useEffect } from 'react';
import { Bot, Mic, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Message } from '../../types';

interface ChatMessagesProps {
  messages: Message[];
  streaming: boolean;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatMessages({ messages, streaming, chatEndRef }: ChatMessagesProps) {
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center h-full min-h-[40vh]">
        <div className="text-center">
          <Bot size={40} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">Send a message, attach context, paste an image, or speak through the microphone.</p>
          <p className="text-muted-foreground/50 text-xs mt-1">Vision multi-images + push-to-talk + Edge TTS backend.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-5 space-y-4">
      {messages.map((message, index) => (
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
              : 'bg-muted/50 border border-border text-foreground/85',
          )}>
            {message.isVoice && (
              <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                <Mic size={10} />
                Voice
              </div>
            )}
            <MessageContent content={message.content} />
            {message.audioUrl && (
              <audio controls preload="none" src={message.audioUrl} className="mt-3 w-full max-w-sm" />
            )}
            {streaming && index === messages.length - 1 && message.role === 'assistant' && (
              <span className="inline-block w-2 h-4 bg-primary/60 ml-0.5 animate-pulse rounded-sm" />
            )}
          </div>
        </div>
      ))}
      <div ref={chatEndRef} />
    </div>
  );
}

// ── Inline markdown (simplified for component) ─────────────

function MessageContent({ content }: { content: string }) {
  if (!content) return null;
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
            const cls = 'font-semibold text-foreground mt-2';
            if (level === 1) return <h1 key={i} className={cls}>{text}</h1>;
            if (level === 2) return <h2 key={i} className={cls}>{text}</h2>;
            if (level === 3) return <h3 key={i} className={cls}>{text}</h3>;
            if (level === 4) return <h4 key={i} className={cls}>{text}</h4>;
            if (level === 5) return <h5 key={i} className={cls}>{text}</h5>;
            return <h6 key={i} className={cls}>{text}</h6>;
          }
        }
        return <p key={i} className="whitespace-pre-wrap">{renderInline(block)}</p>;
      })}
    </div>
  );
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
    parts.push(remaining.slice(0, nextSpecial));
    remaining = remaining.slice(nextSpecial);
  }

  return <>{parts}</>;
}
