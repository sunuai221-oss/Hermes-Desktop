import { Menu, X, Shield, ChevronDown, Sun, Moon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useProfiles } from '../contexts/ProfileContext';
import { useTheme } from '../hooks/useTheme';
import { useNavigation } from '../hooks/useNavigation';
import { statusLabels } from '../hooks/useRuntimeStatus';
import { useState, useRef, useEffect } from 'react';
import type { ConnectionStatus } from '../types';

interface HeaderProps {
  runtimeStatus: ConnectionStatus;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export function Header({ runtimeStatus, onToggleSidebar, sidebarOpen }: HeaderProps) {
  const { currentProfile, profiles, switchProfile } = useProfiles();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { pageTitle } = useNavigation();
  const [showProfiles, setShowProfiles] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProfiles(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header
      className="sticky top-0 z-30 w-full h-14 flex-shrink-0 flex items-center px-6 justify-between bg-background border-b border-border"
    >
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded-md transition-colors"
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <h2 className="text-sm font-semibold text-foreground">
          {pageTitle}
        </h2>
      </div>

      <div className="flex items-center gap-3">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={`Switch to ${resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
        >
          {resolvedTheme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        {/* Profile Selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowProfiles(!showProfiles)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors group"
          >
            <Shield size={14} className={cn(
              "transition-colors",
              currentProfile === 'default' ? "text-primary" : "text-muted-foreground"
            )} />
            <span className="text-xs font-semibold text-foreground">
              {currentProfile}
            </span>
            <ChevronDown size={14} className={cn("text-muted-foreground transition-transform duration-200", showProfiles && "rotate-180")} />
          </button>

          {showProfiles && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-popover border border-border rounded-lg shadow-lg py-1.5 overflow-hidden animate-in fade-in zoom-in duration-200">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border mb-1">
                Switch Profile
              </div>
              {profiles.map(p => (
                <button
                  key={p}
                  onClick={() => {
                    switchProfile(p);
                    setShowProfiles(false);
                  }}
                  className={cn(
                    "w-full px-4 py-2 text-left text-sm transition-colors hover:bg-muted",
                    currentProfile === p ? "text-primary font-medium bg-primary/5" : "text-foreground"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className={cn(
            'h-2 w-2 rounded-full',
            runtimeStatus === 'online'
              ? 'bg-success'
              : runtimeStatus === 'direct'
                ? 'bg-primary'
                : runtimeStatus === 'degraded' || runtimeStatus === 'connecting'
                  ? 'bg-warning'
                  : 'bg-destructive'
          )} />
          <span className="text-xs font-medium text-muted-foreground">
            {statusLabels[runtimeStatus]}
          </span>
        </div>
      </div>
    </header>
  );
}
