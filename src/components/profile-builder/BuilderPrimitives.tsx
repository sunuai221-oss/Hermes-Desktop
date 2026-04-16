import type { ReactNode } from 'react';
import { Card } from '../Card';
import { cn } from '../../lib/utils';

export function BuilderSection({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('p-6', className)}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          {eyebrow && (
            <p className="text-[11px] text-muted-foreground mb-2 font-semibold">
              {eyebrow}
            </p>
          )}
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-2 max-w-3xl">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

export function BuilderMetric({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-md border border-border bg-muted/50 p-4', className)}>
      <p className="text-[11px] text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-semibold mt-2">{value}</p>
      {detail && <p className="text-xs text-muted-foreground mt-2">{detail}</p>}
    </div>
  );
}

export function BuilderModuleCard({
  icon,
  title,
  summary,
  detail,
  badge,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  summary: string;
  detail?: string;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-lg border border-border bg-card p-5 transition-colors',
        onClick && 'hover:bg-muted'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center text-primary">
          {icon}
        </div>
        {badge && (
          <span className="text-[10px] text-primary font-semibold">
            {badge}
          </span>
        )}
      </div>
      <p className="text-base font-semibold mt-4">{title}</p>
      <p className="text-sm text-foreground/90 mt-2">{summary}</p>
      {detail && <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{detail}</p>}
    </button>
  );
}

export function HermesHomeTree({
  homePath,
  items,
}: {
  homePath?: string | null;
  items: Array<{ name: string; description: string; onClick?: () => void; actionLabel?: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-5">
      <div className="mb-4">
        <p className="text-[11px] text-muted-foreground font-semibold">Isolated HERMES_HOME</p>
        <p className="text-sm font-mono mt-2 break-all">{homePath || 'Profile home unresolved'}</p>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          item.onClick ? (
            <button
              key={item.name}
              type="button"
              onClick={item.onClick}
              className="w-full rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="text-primary font-mono text-xs mt-0.5">+</span>
                  <div>
                    <p className="text-sm font-medium font-mono">{item.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                  </div>
                </div>
                <span className="text-[10px] text-primary font-semibold">
                  {item.actionLabel || 'Open'}
                </span>
              </div>
            </button>
          ) : (
            <div key={item.name} className="rounded-md border border-border bg-card px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="text-primary font-mono text-xs mt-0.5">+</span>
                <div>
                  <p className="text-sm font-medium font-mono">{item.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                </div>
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
