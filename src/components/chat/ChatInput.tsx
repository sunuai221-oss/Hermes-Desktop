import { useState } from 'react';
import {
  FileCode2, FolderOpen, GitBranch, Globe, ImagePlus,
  Link2, Mic, Plus, Send, Square, X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ContextReferenceAttachment, ImageAttachment } from '../../types';

const MAX_IMAGES = 5;

const REF_KINDS: Array<{
  kind: ContextReferenceAttachment['kind'];
  icon: React.ReactNode;
  label: string;
  placeholder: string;
}> = [
  { kind: 'file', icon: <FileCode2 size={13} />, label: 'File', placeholder: 'src/main.py:10-25' },
  { kind: 'folder', icon: <FolderOpen size={13} />, label: 'Folder', placeholder: 'src/components' },
  { kind: 'diff', icon: <GitBranch size={13} />, label: 'Diff', placeholder: '' },
  { kind: 'staged', icon: <GitBranch size={13} />, label: 'Staged', placeholder: '' },
  { kind: 'git', icon: <GitBranch size={13} />, label: 'Git log', placeholder: '5 commits' },
  { kind: 'url', icon: <Globe size={13} />, label: 'URL', placeholder: 'https://example.com' },
];

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  streaming: boolean;
  // Attachments
  attachments: ContextReferenceAttachment[];
  newAttachmentKind: ContextReferenceAttachment['kind'];
  newAttachmentValue: string;
  canAddReference: boolean;
  onKindChange: (kind: ContextReferenceAttachment['kind']) => void;
  onValueChange: (value: string) => void;
  onAddAttachment: () => void;
  onRemoveAttachment: (id: string) => void;
  contextStatusLabel: string;
  // Images
  imageAttachments: ImageAttachment[];
  uploadingImages: boolean;
  imageError: string | null;
  onRemoveImage: (id: string) => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  // Voice
  voiceState: 'idle' | 'recording' | 'processing' | 'speaking';
  voiceError: string | null;
  voiceSupported: boolean;
  voiceStatusLabel: string;
  onVoiceToggle: () => void;
}

export function ChatInput({
  input, onInputChange, onSend, onPaste, streaming,
  attachments, newAttachmentKind, newAttachmentValue, canAddReference,
  onKindChange, onValueChange, onAddAttachment, onRemoveAttachment,
  imageAttachments, uploadingImages, imageError, onRemoveImage, onFileSelect, fileInputRef,
  voiceState, voiceError, onVoiceToggle,
}: ChatInputProps) {
  const [showRefBar, setShowRefBar] = useState(false);
  const isBusy = streaming || uploadingImages || voiceState === 'recording' || voiceState === 'processing';
  const canSend = (input.trim().length > 0 || attachments.length > 0 || imageAttachments.length > 0) && !isBusy;
  const hasAttachments = attachments.length > 0 || imageAttachments.length > 0;
  const hasErrors = imageError || voiceError;
  const activeRef = REF_KINDS.find(r => r.kind === newAttachmentKind);

  return (
    <div className="border-t border-border">
      {/* Attachment chips — shown above input when present */}
      {hasAttachments && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {attachments.map(item => (
            <span key={item.id} className="group inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-muted/80 text-xs border border-border/50">
              <span className="text-muted-foreground">{refIcon(item.kind)}</span>
              <span className="font-mono text-foreground/80">{shortRef(item)}</span>
              <button
                onClick={() => onRemoveAttachment(item.id)}
                className="ml-0.5 p-0.5 rounded-full text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {imageAttachments.map((image, index) => (
            <span key={image.id} className="group inline-flex items-center gap-1.5 pl-1.5 pr-1.5 py-1 rounded-full bg-primary/8 text-xs border border-primary/15">
              <span className="w-5 h-5 rounded overflow-hidden border border-primary/20 bg-muted">
                <img src={image.dataUrl} alt={image.fileName} className="w-full h-full object-cover" />
              </span>
              <span className="text-primary/80 font-medium">img {index + 1}</span>
              <button
                onClick={() => onRemoveImage(image.id)}
                className="p-0.5 rounded-full text-primary/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Errors — compact inline */}
      {hasErrors && (
        <div className="px-4 pt-2">
          <p className="text-[11px] text-destructive/80">{imageError || voiceError}</p>
        </div>
      )}

      {/* Context reference bar — collapsible */}
      {showRefBar && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-muted/50 border border-border/60">
            {/* Ref type pills */}
            <div className="flex items-center gap-0.5">
              {REF_KINDS.map(r => (
                <button
                  key={r.kind}
                  onClick={() => onKindChange(r.kind)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
                    newAttachmentKind === r.kind
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  title={r.label}
                >
                  {r.icon}
                  <span className="hidden sm:inline">{r.label}</span>
                </button>
              ))}
            </div>

            <div className="w-px h-5 bg-border mx-1" />

            {/* Value input */}
            <input
              value={newAttachmentValue}
              onChange={e => onValueChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddAttachment(); } }}
              placeholder={activeRef?.placeholder || 'Value'}
              disabled={newAttachmentKind === 'diff' || newAttachmentKind === 'staged'}
              className="flex-1 bg-transparent text-sm focus:outline-none disabled:opacity-40 min-w-0"
            />

            {/* Add button */}
            <button
              onClick={onAddAttachment}
              disabled={!canAddReference}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold disabled:opacity-30 hover:bg-primary/15 transition-colors"
            >
              <Plus size={12} />
              Add
            </button>

            {/* Close */}
            <button
              onClick={() => setShowRefBar(false)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Main input row */}
      <div className="flex items-end gap-2 p-3">
        {/* Action buttons — left of input */}
        <div className="flex items-center gap-1 pb-0.5">
          <button
            onClick={() => setShowRefBar(v => !v)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              showRefBar
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title="Attach context reference"
          >
            <Link2 size={15} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || uploadingImages || imageAttachments.length >= MAX_IMAGES || voiceState === 'processing'}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
            title="Attach image"
          >
            <ImagePlus size={15} />
          </button>
          <button
            onClick={onVoiceToggle}
            disabled={streaming || uploadingImages || voiceState === 'processing'}
            className={cn(
              'p-2 rounded-lg transition-colors disabled:opacity-30',
              voiceState === 'recording'
                ? 'bg-red-500/10 text-destructive hover:bg-red-500/15'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title={voiceState === 'recording' ? 'Stop recording' : 'Push-to-talk'}
          >
            {voiceState === 'recording' ? <Square size={15} /> : <Mic size={15} />}
          </button>
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileSelect} />

        {/* Text input */}
        <div className="relative flex-1">
          <textarea
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onPaste={onPaste}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            placeholder="Message Hermes…"
            disabled={streaming || voiceState === 'recording' || voiceState === 'processing'}
            rows={1}
            className="w-full resize-none bg-muted/40 border border-border/60 rounded-xl px-4 py-3 pr-12 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/30 transition-all disabled:opacity-50 placeholder:text-muted-foreground/50"
            style={{ maxHeight: '120px' }}
            onInput={e => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          {/* Send button — floating inside input */}
          <button
            onClick={() => void onSend()}
            disabled={!canSend}
            className={cn(
              'absolute right-2 bottom-2 p-2 rounded-lg transition-all',
              canSend
                ? 'bg-primary text-primary-foreground hover:shadow-md hover:shadow-primary/20'
                : 'bg-muted text-muted-foreground/40',
            )}
          >
            {isBusy ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Minimal status — only when relevant */}
      {voiceState !== 'idle' && (
        <div className="px-4 pb-2 text-[10px] text-muted-foreground/60">
          {voiceState === 'recording' && '● Recording…'}
          {voiceState === 'processing' && 'Processing voice…'}
          {voiceState === 'speaking' && 'Playing audio…'}
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function refIcon(kind: ContextReferenceAttachment['kind']) {
  const r = REF_KINDS.find(x => x.kind === kind);
  return r?.icon ?? <FileCode2 size={13} />;
}

function shortRef(ref: ContextReferenceAttachment): string {
  if (ref.kind === 'diff') return '@diff';
  if (ref.kind === 'staged') return '@staged';
  if (ref.kind === 'git') return `@git:${ref.value}`;
  const val = ref.value.length > 24 ? ref.value.slice(0, 24) + '…' : ref.value;
  return `@${ref.kind}:${val}`;
}
