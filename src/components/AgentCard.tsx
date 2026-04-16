import {
  Play,
  Square,
  Settings,
  MessageSquare,
  Zap,
  Cpu,
  Trash2,
} from 'lucide-react';
import { Card } from './Card';
import { cn } from '../lib/utils';

interface AgentCardProps {
  name: string;
  isDefault: boolean;
  model: string;
  port?: number;
  status: 'online' | 'offline';
  managed?: boolean;
  statusSource?: 'managed-profile' | 'shared-global' | 'offline';
  isActive: boolean;
  onStart: () => void;
  onStop: () => void;
  onSwitch: () => void;
  onDelete: () => void;
  onConfigure: () => void;
}

export function AgentCard({
  name,
  isDefault,
  model,
  port,
  status,
  managed = false,
  statusSource = 'offline',
  isActive,
  onStart,
  onStop,
  onSwitch,
  onDelete,
  onConfigure,
}: AgentCardProps) {
  const isOnline = status === 'online';
  const gatewayLabel = statusSource === 'managed-profile'
    ? 'Dedicated'
    : statusSource === 'shared-global'
      ? 'Shared'
      : 'Offline';
  const gatewayHint = statusSource === 'managed-profile'
    ? 'runtime launched for this profile'
    : statusSource === 'shared-global'
      ? 'shared gateway detected'
      : 'gateway unreachable';

  return (
    <Card
      className={cn(
        'group relative transition-all',
        isActive ? 'border-primary/40 bg-primary/5' : 'hover:border-border',
      )}
    >
      <div className="p-5">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                isOnline ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
              )}
            >
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">{name}</h3>
                {isDefault && (
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Primary
                  </span>
                )}
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Zap size={10} className="text-primary/60" />
                {model}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onConfigure}
              className="rounded-md bg-muted p-2 text-muted-foreground transition-colors hover:text-foreground"
              title="Open profile"
            >
              <Settings size={16} />
            </button>
            {!isDefault && (
              <button
                onClick={onDelete}
                className="rounded-md bg-destructive/5 p-2 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                title="Delete profile"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Runtime mode</p>
            <div className="flex items-center gap-2">
              <div className={cn('h-1.5 w-1.5 rounded-full', isOnline ? 'bg-success' : 'bg-muted-foreground/30')} />
              <span className={cn('text-xs font-medium', isOnline ? 'text-success' : 'text-muted-foreground')}>
                {gatewayLabel}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">{gatewayHint}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/50 p-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Local Port</p>
            <p className="text-xs font-mono text-foreground">{port || 'N/A'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isOnline ? (
            <>
              <button
                onClick={onSwitch}
                className={cn(
                  'flex-1 h-10 rounded-md flex items-center justify-center gap-2 text-sm font-semibold transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/80',
                )}
              >
                <MessageSquare size={14} />
                {isActive ? 'Open chat' : 'Activate profile'}
              </button>
              {managed && (
                <button
                  onClick={onStop}
                  className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
                  title="Stop runtime"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              )}
            </>
          ) : (
            <button
              onClick={onStart}
              className="flex-1 h-10 rounded-md bg-primary text-primary-foreground flex items-center justify-center gap-2 text-sm font-semibold transition-colors hover:bg-primary/90"
            >
              <Play size={14} fill="currentColor" />
              Start runtime
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
