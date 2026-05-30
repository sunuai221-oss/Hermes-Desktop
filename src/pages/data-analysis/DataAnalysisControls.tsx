import type { PreviewBarPoint } from './dataAnalysisUtils';

export function SimpleBarChart({ bars }: { bars: PreviewBarPoint[] }) {
  if (!bars.length) return null;
  const maxValue = Math.max(...bars.map(item => Math.abs(item.value)), 1);

  return (
    <div className="space-y-1.5">
      {bars.map((bar, index) => {
        const widthPct = Math.max(4, (Math.abs(bar.value) / maxValue) * 100);
        return (
          <div key={`${bar.label}-${index}`} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2 text-[11px]">
            <div className="truncate text-muted-foreground" title={bar.label}>{bar.label}</div>
            <div className="h-2 rounded bg-muted">
              <div
                className="h-2 rounded bg-primary/70"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <div className="font-mono text-foreground/90">{bar.value}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        type={type}
        placeholder={placeholder || label}
        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/35"
      />
    </div>
  );
}
