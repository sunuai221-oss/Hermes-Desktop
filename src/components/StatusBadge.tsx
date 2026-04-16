import { cn } from '../lib/utils';
import type { ConnectionStatus } from '../types';

interface StatusBadgeProps {
  status: ConnectionStatus | 'connected' | 'disconnected' | 'fatal';
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
}

const statusConfig: Record<string, { dot: string; text: string; label: string }> = {
  online:       { dot: 'status-online',     text: 'text-success',          label: 'Online' },
  connected:    { dot: 'status-online',     text: 'text-success',          label: 'Connected' },
  direct:       { dot: 'status-connecting', text: 'text-primary',          label: 'Direct' },
  degraded:     { dot: 'status-connecting', text: 'text-warning',          label: 'Degraded' },
  offline:      { dot: 'status-offline',    text: 'text-destructive',      label: 'Offline' },
  disconnected: { dot: 'status-offline',    text: 'text-destructive',      label: 'Disconnected' },
  fatal:        { dot: 'status-offline',    text: 'text-destructive',      label: 'Fatal error' },
  connecting:   { dot: 'status-connecting', text: 'text-warning',          label: 'Connecting...' },
};

const sizes = {
  sm: { dot: 'w-1.5 h-1.5', text: 'text-[10px]' },
  md: { dot: 'w-2 h-2',     text: 'text-xs' },
  lg: { dot: 'w-2.5 h-2.5', text: 'text-sm' },
};

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const cfg = statusConfig[status] || statusConfig.offline;
  const sz = sizes[size];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('rounded-full flex-shrink-0', cfg.dot, sz.dot)} />
      <span className={cn('font-medium', cfg.text, sz.text)}>{label || cfg.label}</span>
    </span>
  );
}
