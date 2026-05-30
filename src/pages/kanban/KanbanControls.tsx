import type { ReactNode } from 'react';
import { Inbox, Loader2, type LucideIcon } from 'lucide-react';
import type { KanbanStatus } from '../../types';
import { cn } from '../../lib/utils';
import { getLane, type LaneVisual } from './kanbanUtils';

export function StatPill({ lane, value }: { lane: LaneVisual; value: number }) {
  return (
    <div
      className="shrink-0 rounded-lg border border-border/50 bg-card/60 px-3 py-2 cursor-default"
      style={{ boxShadow: `0 0 16px ${lane.accentFaint}, 0 1px 2px rgba(0,0,0,0.04)` }}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', lane.dot)} style={{ boxShadow: `0 0 5px ${lane.accentRing}` }} />
        <span className="truncate text-[10px] font-medium text-muted-foreground">{lane.label}</span>
      </div>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

export function StatusBadge({ status }: { status: KanbanStatus }) {
  const lane = getLane(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{ borderColor: lane.accentSoft, background: lane.accentFaint, color: lane.accent }}
    >
      <span className={cn('h-2 w-2 rounded-full', lane.dot)} />
      {lane.label}
    </span>
  );
}

export function Field({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder || label}
        className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
      />
    </label>
  );
}

export function SelectField({ label, value, onChange, options, emptyLabel }: {
  label: string; value: string; onChange: (value: string) => void; options: string[]; emptyLabel?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30"
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export function TextArea({ label, value, onChange, placeholder, compact }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; compact?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder || label}
        className={cn(
          'w-full resize-y rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-amber/30',
          compact ? 'min-h-[72px]' : 'min-h-[100px]',
        )}
      />
    </label>
  );
}

export function ActionButton({ icon: Icon, label, loading, disabled, danger, onClick }: {
  icon: LucideIcon; label: string; loading?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-[34px] items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40 transition-colors',
        danger
          ? 'border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20'
          : 'border-border/50 bg-muted/40 hover:bg-muted/60',
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {label}
    </button>
  );
}

export function IconButton({ icon: Icon, label, loading, disabled, onClick }: {
  icon: LucideIcon; label: string; loading?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber text-white disabled:opacity-40 hover:bg-brand-amber/90"
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
    </button>
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground/60">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium">{value}</p>
    </div>
  );
}

export function TokenList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {values.map(value => <Chip key={value}>{value}</Chip>)}
      </div>
    </div>
  );
}

export function HistoryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="max-w-full truncate rounded-full bg-muted/50 px-2 py-0.5 text-[9px] text-muted-foreground">
      {children}
    </span>
  );
}

export function EmptyState() {
  return (
    <div className="flex h-[360px] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-2xl bg-muted/30 p-4">
        <Inbox size={28} className="text-muted-foreground/25" />
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground/60">No task selected</p>
        <p className="mt-1 text-xs text-muted-foreground/35">Click a card or create a new task</p>
      </div>
    </div>
  );
}
