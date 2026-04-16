import { ChevronDown, Trash2, Volume2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ConnectionStatus } from '../../types';

interface ChatToolbarProps {
  // Profile
  currentProfile: string;
  // Status
  runtimeStatus: ConnectionStatus;
  runtimeProviderLabel: string;
  preferredModel: string;
  // Provider
  provider: string;
  onProviderChange: (provider: string) => void;
  // Model
  model: string;
  onModelChange: (model: string) => void;
  modelOptions: Array<{ label: string; value: string }>;
  // Session
  currentSessionLabel: string | null;
  // Voice
  voiceMode: boolean;
  onVoiceModeToggle: () => void;
  // Actions
  hasMessages: boolean;
  onNewChat: () => void;
}

export function ChatToolbar({
  currentProfile,
  runtimeStatus, runtimeProviderLabel, preferredModel,
  provider, onProviderChange,
  model, onModelChange, modelOptions,
  currentSessionLabel,
  voiceMode, onVoiceModeToggle,
  hasMessages, onNewChat,
}: ChatToolbarProps) {
  return (
    <div className="flex items-center justify-between mb-4 flex-shrink-0 gap-3">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Profile + status */}
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
              chat provider: <span className="font-mono text-foreground/75">{provider}</span>
              {' • '}
              model: <span className="font-mono text-foreground/75">{model || preferredModel}</span>
            </p>
            {currentSessionLabel && (
              <p className="mt-1 max-w-[28rem] truncate text-[10px] text-muted-foreground/80">
                session: <span className="font-mono text-foreground/75">{currentSessionLabel}</span>
              </p>
            )}
          </div>
        </div>

        <div className="h-6 w-[1px] bg-muted mx-1 hidden md:block" />

        {/* Provider selector */}
        <div className="relative">
          <select
            value={provider}
            onChange={e => onProviderChange(e.target.value)}
            title="Provider selection"
            aria-label="Provider selection"
            className="appearance-none bg-muted border border-border rounded-lg px-3 py-1.5 pr-8 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
          >
            <option value="codex-openai">OpenAI / Codex</option>
            <option value="nous">Nous Research</option>
            <option value="ollama">Ollama</option>
            <option value="lmstudio">LM Studio</option>
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
        </div>

        {/* Model selector */}
        {modelOptions.length > 0 ? (
          <div className="relative">
            <select
              value={model}
              onChange={e => onModelChange(e.target.value)}
              title="Model selection for chat"
              aria-label="Model selection for chat"
              className="appearance-none bg-muted border border-border rounded-lg px-3 py-1.5 pr-8 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
            >
              {modelOptions.map(option => (
                <option key={option.value} value={option.value} className="bg-card">{option.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
          </div>
        ) : (
          <input
            value={model}
            onChange={e => onModelChange(e.target.value)}
            placeholder="Model name"
            className="bg-muted border border-border rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        )}

        {/* Voice mode toggle */}
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

      {/* New chat */}
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
