import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Plus, Play, Square, Trash2, Shield, Check, ArrowRight,
} from 'lucide-react';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { useProfiles } from '../contexts/ProfileContext';
import { useFeedback } from '../contexts/FeedbackContext';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { NavItem } from '../hooks/useNavigation';

type ProfileMeta = {
  name: string;
  isDefault: boolean;
  model: string;
  port?: number;
  status: 'online' | 'offline';
  managed?: boolean;
  status_source?: string;
  home?: string;
};

interface Props {
  onNavigate: (item: NavItem) => void;
}

export function ProfilesPage({ onNavigate }: Props) {
  const { currentProfile, switchProfile, createProfile, deleteProfile, startGateway, stopGateway } = useProfiles();
  const { confirm, notify } = useFeedback();

  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);

  const fetchProfiles = async () => {
    try {
      const { data } = await api.profiles.metadata();
      setProfiles(Array.isArray(data) ? data : []);
    } catch { /* handle */ }
  };

  useEffect(() => {
    void fetchProfiles();
    const timer = setInterval(fetchProfiles, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleCreate = async () => {
    const name = newName.trim().toLowerCase().replace(/[^\w.-]+/g, '_');
    if (!name) return;
    setCreating(true);
    try {
      await createProfile(name);
      switchProfile(name);
      setNewName('');
      setShowCreate(false);
      await fetchProfiles();
    } catch { notify({ tone: 'error', message: 'Could not create profile.' }); }
    finally { setCreating(false); }
  };

  const handleStart = async (name: string) => {
    setBusyName(name);
    try { await startGateway(name); await fetchProfiles(); }
    finally { setBusyName(null); }
  };

  const handleStop = async (name: string) => {
    setBusyName(name);
    try { await stopGateway(name); await fetchProfiles(); }
    finally { setBusyName(null); }
  };

  const handleDelete = async (name: string) => {
    if (name === 'default') return;
    const ok = await confirm({ title: 'Delete profile', message: `Delete "${name}" and all its data?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setBusyName(name);
    try {
      await deleteProfile(name);
      await fetchProfiles();
      notify({ tone: 'success', message: `Profile ${name} deleted.` });
    } catch { notify({ tone: 'error', message: 'Could not delete.' }); }
    finally { setBusyName(null); }
  };

  return (
    <motion.div key="profiles" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Profiles</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {profiles.length} profile(s) · active: <span className="font-medium text-foreground">{currentProfile}</span>
          </p>
        </div>
        <button onClick={() => setShowCreate(v => !v)} className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', showCreate ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary hover:bg-primary/15')}>
          {showCreate ? 'Cancel' : <><Plus size={13} /> New profile</>}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="p-4">
          <div className="flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} placeholder="profile-name" className="flex-1 bg-muted/30 border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <button onClick={handleCreate} disabled={creating || !newName.trim()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
              {creating ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
            </button>
          </div>
        </Card>
      )}

      {/* Profile list */}
      <div className="space-y-2">
        {profiles.map(profile => {
          const isActive = currentProfile === profile.name;
          const isBusy = busyName === profile.name;
          const isOnline = profile.status === 'online';

          return (
            <Card key={profile.name} className={cn('p-4 transition-colors', isActive && 'border-primary/20 bg-primary/[0.02]')}>
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold',
                  isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}>
                  {profile.name[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{profile.name}</p>
                    {profile.isDefault && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">default</span>}
                    {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">active</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={isOnline ? 'online' : 'offline'} size="sm" />
                    <span className="text-[11px] text-muted-foreground/50">·</span>
                    <span className="text-[11px] font-mono text-muted-foreground/60">{profile.model || 'unset'}</span>
                    {profile.port && (
                      <>
                        <span className="text-[11px] text-muted-foreground/50">·</span>
                        <span className="text-[11px] text-muted-foreground/40">:{profile.port}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!isActive && (
                    <button onClick={() => switchProfile(profile.name)} className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors" title="Switch to">
                      <ArrowRight size={14} />
                    </button>
                  )}
                  {isActive && <Check size={14} className="text-primary" />}

                  {isOnline ? (
                    <button onClick={() => void handleStop(profile.name)} disabled={isBusy} className="p-2 rounded-lg text-muted-foreground hover:text-warning hover:bg-warning/5 transition-colors disabled:opacity-40" title="Stop">
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                    </button>
                  ) : (
                    <button onClick={() => void handleStart(profile.name)} disabled={isBusy} className="p-2 rounded-lg text-muted-foreground hover:text-success hover:bg-success/5 transition-colors disabled:opacity-40" title="Start">
                      {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    </button>
                  )}

                  {!profile.isDefault && (
                    <button onClick={() => void handleDelete(profile.name)} disabled={isBusy} className="p-2 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-40" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 pt-2">
        <QuickLink label="Agent Studio" onClick={() => onNavigate('soul')} />
        <QuickLink label="Config" onClick={() => onNavigate('config')} />
        <QuickLink label="Sessions" onClick={() => onNavigate('sessions')} />
      </div>
    </motion.div>
  );
}

function QuickLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
      <Shield size={10} />
      {label}
    </button>
  );
}
