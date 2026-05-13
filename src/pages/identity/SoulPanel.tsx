import { Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Card } from '../../components/Card';
import { cn } from '../../lib/utils';

export function SoulPanel({
  content,
  hasChanges,
  saving,
  saved,
  onChange,
  onSave,
  onReset,
}: {
  content: string;
  hasChanges: boolean;
  saving: boolean;
  saved: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <span className="text-sm font-medium">SOUL.md</span>
          {hasChanges && <span className="h-1.5 w-1.5 rounded-full bg-warning" title="Unsaved changes" />}
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button onClick={onReset} className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
              <RotateCcw size={11} /> Reset
            </button>
          )}
          <button
            onClick={onSave}
            disabled={saving || !hasChanges}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              saved ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary hover:bg-primary/15',
              (saving || !hasChanges) && 'opacity-40',
            )}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <><Check size={13} className="mr-1 inline" />Saved</> : 'Save'}
          </button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={event => onChange(event.target.value)}
        className="min-h-[500px] w-full resize-y bg-transparent p-6 font-mono text-sm leading-7 focus:outline-none"
        spellCheck={false}
        placeholder="# Identity&#10;&#10;You are..."
      />
    </Card>
  );
}
