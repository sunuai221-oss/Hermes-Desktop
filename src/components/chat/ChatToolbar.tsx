import { Trash2, Volume2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ConnectionStatus } from '../../types';

interface ChatToolbarProps {
  currentProfile: string;
  runtimeStatus: ConnectionStatus;
  runtimeProviderLabel: string;
  preferredModel: string;
  currentSessionLabel: string | null;
  voiceMode: boolean;
  onVoiceModeToggle: () => void;
  hasMessages: boolean;
  onNewChat: () => void;
}

export function ChatToolbar({
  currentProfile,
  runtimeStatus,
  runtimeProviderLabel,
  preferredModel,
  currentSessionLabel,
  voiceMode,
  onVoiceModeToggle,
  hasMessages,
  onNewChat,
}: ChatToolbarProps) {
  return (
    <div className="flex items-center justify-between mb-4 flex-shrink-0 gap-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-8 h-8 rounded-md flex items-center justify-center font-bold text-xs',
            runtimeStatus === 'online' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary',
          )}>
            {currentProfile[0].toUpperCase()}
          </div>
          <div>
            <h2 className="text-sm font-semibold leading-none">{currentProfile}</h2>
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5 font-medium">
              <span className={cn(
                'w-1.5 h-1.5 rounded-full',
                runtimeStatus === 'online' ? 'bg-success'
                  : runtimeStatus === 'direct' ? 'bg-primary'
                  : runtimeStatus === 'degraded' ? 'bg-warning'
                  : 'bg-muted-foreground/30',
              )} />
              {runtimeStatus}
            </p>
            <p className="text-[10px] text-muted-foreground/80 mt-1 font-mono">
              runtime {runtimeProviderLabel} {'->'} {preferredModel}
            </p>
            <p className="mt-1 max-w-[34rem] truncate text-[10px] text-muted-foreground/80">
              chat provider: <span className="font-mono text-foreground/75">{runtimeProviderLabel}</span>
              {' • '}
              model: <span className="font-mono text-foreground/75">{preferredModel}</span>
            </p>
            <p className="mt-1 max-w-[34rem] truncate text-[10px] text-muted-foreground/70">
              managed by Hermes runtime config
            </p>
            {currentSessionLabel && (
              <p className="mt-1 max-w-[28rem] truncate text-[10px] text-muted-foreground/80">
                session: <span className="font-mono text-foreground/75">{currentSessionLabel}</span>
              </p>
            )}
          </div>
        </div>

        <div className="h-6 w-[1px] bg-muted mx-1 hidden md:block" />

        <button
          onClick={onVoiceModeToggle}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs border transition-colors',
            voiceMode ? 'border-primary/30 bg-primary/12 text-primary' : 'border-border bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          <Volume2 size={13} />
          {voiceMode ? 'Voice ON' : 'Voice OFF'}
        </button>
      </div>

      {hasMessages && (
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 size={12} /> New chat
        </button>
      )}
    </div>
  );
}
