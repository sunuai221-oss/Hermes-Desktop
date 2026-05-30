import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';

export function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h3 className="mb-5 flex items-center gap-2 text-base font-bold">
      <span className="text-primary">{icon}</span> {title}
    </h3>
  );
}

export function ActionButton({
  icon,
  label,
  loading,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/35 px-2.5 py-1.5 text-[11px] text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
    >
      {loading ? <RefreshCw size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

export function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        title={label}
        placeholder={placeholder || label}
        className="w-full rounded-lg border border-border bg-muted px-4 py-2.5 font-mono text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}

export function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        title={label}
        aria-label={label}
        className={cn(
          'relative h-5 w-10 rounded-full transition-all',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
