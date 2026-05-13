import { BrainCircuit, Loader2 } from 'lucide-react';
import { Card } from '../../components/Card';
import { cn } from '../../lib/utils';
import type { MemoryStore } from '../../types';
import { ConversationSearch } from './ConversationSearch';

type MemoryTarget = 'memory' | 'user';

export function MemoryPanel({
  memoryStore,
  userStore,
  memoryDrafts,
  savingTarget,
  onChange,
  onSave,
}: {
  memoryStore?: MemoryStore;
  userStore?: MemoryStore;
  memoryDrafts: Record<string, string>;
  savingTarget: string | null;
  onChange: (target: MemoryTarget, value: string) => void;
  onSave: (target: MemoryTarget) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <MemoryEditor
          title="MEMORY.md"
          subtitle="Durable facts, conventions, environment"
          store={memoryStore}
          value={memoryDrafts.memory || ''}
          saving={savingTarget === 'memory'}
          onChange={value => onChange('memory', value)}
          onSave={() => onSave('memory')}
        />
        <MemoryEditor
          title="USER.md"
          subtitle="User preferences, style, expectations"
          store={userStore}
          value={memoryDrafts.user || ''}
          saving={savingTarget === 'user'}
          onChange={value => onChange('user', value)}
          onSave={() => onSave('user')}
        />
      </div>

      <ConversationSearch />
    </div>
  );
}

function MemoryEditor({
  title,
  subtitle,
  store,
  value,
  saving,
  onChange,
  onSave,
}: {
  title: string;
  subtitle: string;
  store?: MemoryStore;
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const charLimit = store?.charLimit ?? 0;
  const charCount = value.length;
  const pct = charLimit > 0 ? Math.min(100, Math.round((charCount / charLimit) * 100)) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/40 px-5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit size={14} className="text-primary" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <button
          onClick={onSave}
          disabled={saving || (charLimit > 0 && charCount > charLimit)}
          className={cn(
            'rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15',
            saving && 'opacity-40',
          )}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
      </div>

      {charLimit > 0 && (
        <div className="px-5 pt-3">
          <div className="mb-1 flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{formatNumber(charCount)} / {formatNumber(charLimit)}</span>
            <span className={cn(pct >= 80 ? 'text-warning' : 'text-muted-foreground/50')}>{pct}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all', pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-h-[340px] w-full resize-y bg-transparent p-5 font-mono text-sm leading-7 focus:outline-none"
        spellCheck={false}
      />
      {store?.path && <p className="truncate px-5 pb-3 font-mono text-[9px] text-muted-foreground/30">{store.path}</p>}
    </Card>
  );
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}
