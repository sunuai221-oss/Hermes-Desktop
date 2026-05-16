import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Eye, EyeOff, Maximize2, Play, RefreshCw, RotateCcw, Sparkles, Square } from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn } from '../lib/utils';
import {
  getDetachedShizukuSizeBounds,
  resetDetachedShizukuPosition,
  useDetachedShizukuState,
} from '../features/companions/detachedShizuku';
import {
  LIVE2D_AVATARS,
  getLive2DAvatarDefinition,
  type Live2DAvatarDefinition,
  type Live2DAvatarId,
  type ModelVersion,
} from '../features/companions/live2dAvatars';
import type { PawrtalCommandResult, PawrtalCompanion, PawrtalStatusResponse } from '../types';

type PawrtalErrorPayload = Partial<PawrtalCommandResult> & {
  details?: string;
  errorCode?: string;
  httpStatus?: number;
};

type UserLive2DModel = {
  id: string;
  label: string;
  description: string;
  modelUrl: string;
  modelVersion: ModelVersion;
  isUserModel: boolean;
};

function normalizeModelVersion(value: string): ModelVersion {
  return value === 'cubism4' ? 'cubism4' : 'cubism2';
}

function parseCompanionsFromStdout(stdout: unknown): PawrtalCompanion[] {
  if (typeof stdout !== 'string' || !stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      id: String(item?.id || ''),
      displayName: String(item?.displayName || item?.id || ''),
      description: String(item?.description || ''),
      packDir: String(item?.packDir || item?.path || ''),
    })).filter(item => item.id);
  } catch {
    return [];
  }
}

function getPawrtalErrorPayload(error: unknown): PawrtalErrorPayload | null {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? data as PawrtalErrorPayload : null;
}

function describePawrtalPayload(payload: PawrtalErrorPayload | null | undefined, fallback: string) {
  const message = payload?.error || payload?.details || payload?.stderr;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function isCliMissingPayload(payload: PawrtalErrorPayload | null | undefined) {
  return payload?.errorCode === 'pawrtal_cli_missing';
}

function summarizeCommandResult(payload: PawrtalCommandResult) {
  if (payload.ok === false) {
    return describePawrtalPayload(payload, 'Commande Pawrtal en échec.');
  }
  const stdout = String(payload.stdout || '').trim();
  if (stdout) return stdout;
  return `Done: ${payload.command || 'pawrtal command'}`;
}

export function CompanionsPage() {
  const [companions, setCompanions] = useState<PawrtalCompanion[]>([]);
  const [status, setStatus] = useState<PawrtalStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cliMissingMessage, setCliMissingMessage] = useState<string | null>(null);
  const [detachedShizuku, setDetachedShizuku] = useDetachedShizukuState();
  const shizukuSizeBounds = getDetachedShizukuSizeBounds();
  const selectedLive2DAvatar = getLive2DAvatarDefinition(detachedShizuku.avatarId);
  const [userModels, setUserModels] = useState<UserLive2DModel[]>([]);

  const allAvatars = useMemo<Live2DAvatarDefinition[]>(() => {
    const builtin = LIVE2D_AVATARS.filter(a => !a.isUserModel);
    const user = userModels.map(m => ({
      ...m,
      id: m.id,
      label: m.label,
      description: m.description,
      modelUrl: m.modelUrl,
      modelVersion: m.modelVersion,
      isUserModel: true,
      idleMotion: 'Idle',
      activeMotions: ['Tap'],
      tapMotion: 'Tap',
      idleExpression: '',
      activeExpression: '',
      tapExpression: '',
    }));
    return [...builtin, ...user];
  }, [userModels]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    setCliMissingMessage(null);
    try {
      const [listResult, statusResult] = await Promise.allSettled([
        api.pawrtal.list(),
        api.pawrtal.status('current'),
      ]);

      let nextError: string | null = null;
      let nextCliMissing: string | null = null;

      if (listResult.status === 'fulfilled') {
        const payload = listResult.value.data;
        if (payload?.ok === false) {
          nextError = describePawrtalPayload(payload, 'Impossible de charger les companions Pawrtal.');
          if (isCliMissingPayload(payload)) nextCliMissing = nextError;
          setCompanions([]);
        } else {
          const fromApi = Array.isArray(payload?.companions) ? payload.companions : [];
          const normalized = fromApi.length > 0 ? fromApi : parseCompanionsFromStdout(payload?.stdout);
          setCompanions(normalized);
        }
      } else {
        const payload = getPawrtalErrorPayload(listResult.reason);
        nextError = describePawrtalPayload(payload, 'Impossible de charger les companions Pawrtal.');
        if (isCliMissingPayload(payload)) nextCliMissing = nextError;
        setCompanions([]);
      }

      if (statusResult.status === 'fulfilled') {
        setStatus(statusResult.value.data || null);
      } else {
        const payload = getPawrtalErrorPayload(statusResult.reason);
        setStatus(null);
        nextError ||= describePawrtalPayload(payload, 'Impossible de lire le statut Pawrtal.');
        if (isCliMissingPayload(payload)) nextCliMissing = describePawrtalPayload(payload, nextError);
      }

      setError(nextError);
      setCliMissingMessage(nextCliMissing);
    } catch {
      setError('Impossible de charger les companions Pawrtal.');
      setCliMissingMessage(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    // Fetch user-imported Live2D models
    try {
      const modelRes = await api.live2d.listModels();
      setUserModels((modelRes.data?.userModels || []).map(model => ({
        ...model,
        modelVersion: normalizeModelVersion(model.modelVersion),
      })));
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(async (
    actionKey: string,
    action: () => Promise<{ data: PawrtalCommandResult }>,
  ) => {
    setBusyAction(actionKey);
    setError(null);
    setFeedback(null);
    setCliMissingMessage(null);
    try {
      const result = await action();
      setFeedback(summarizeCommandResult(result.data));
      await load();
    } catch (actionError) {
      const payload = getPawrtalErrorPayload(actionError);
      const message = describePawrtalPayload(payload, 'Action Pawrtal impossible.');
      setError(message);
      if (isCliMissingPayload(payload)) setCliMissingMessage(message);
    } finally {
      setBusyAction(null);
    }
  }, [load]);

  const activePetId = status?.active?.activePetId || null;
  const isRunning = status?.desktop?.running === true;
  const actionsDisabled = busyAction != null || cliMissingMessage != null;

  const sortedCompanions = useMemo(() => {
    return [...companions].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [companions]);

  return (
    <motion.div
      key="companions"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-6xl space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Companions</h2>
          <p className="text-sm text-muted-foreground">
            Pawrtal intégré nativement dans Hermes Desktop.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void runAction('vanish', () => api.pawrtal.vanish({ session: 'current' }))}
            disabled={actionsDisabled}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
          >
            <Square size={13} />
            Hide
          </button>
          <button
            onClick={() => void runAction('reset', () => api.pawrtal.reset({ session: 'current' }))}
            disabled={actionsDisabled}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
          >
            <RefreshCw size={13} className={busyAction === 'reset' ? 'animate-spin' : ''} />
            Reset
          </button>
          <button
            onClick={() => void load()}
            disabled={refreshing || busyAction != null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            active: <span className="font-mono text-foreground/80">{activePetId || 'none'}</span>
          </span>
          <span>
            desktop: <span className={cn('font-medium', isRunning ? 'text-success' : 'text-muted-foreground')}>{isRunning ? 'running' : 'stopped'}</span>
          </span>
          <span>
            pid: <span className="font-mono text-foreground/80">{status?.desktop?.pid ?? 'n/a'}</span>
          </span>
          <span>
            session: <span className="font-mono text-foreground/80">{status?.session || 'current'}</span>
          </span>
          <span>
            pawrtal: <span className={cn('font-medium', cliMissingMessage ? 'text-destructive' : 'text-success')}>
              {cliMissingMessage ? 'unavailable' : 'ready'}
            </span>
          </span>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Live2D detached</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedLive2DAvatar.label} · {detachedShizuku.visible ? 'visible' : 'hidden'} · size {detachedShizuku.size}px
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setDetachedShizuku({ visible: true })}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/12 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/18 transition-colors"
            >
              <Eye size={13} />
              Invoke
            </button>
            <button
              type="button"
              onClick={() => setDetachedShizuku({ visible: false })}
              disabled={!detachedShizuku.visible}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
            >
              <EyeOff size={13} />
              Vanish
            </button>
            <button
              type="button"
              onClick={() => resetDetachedShizukuPosition()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-foreground/85 hover:bg-muted transition-colors"
            >
              <RotateCcw size={13} />
              Reset
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {allAvatars.map((avatar) => {
            const selected = avatar.id === detachedShizuku.avatarId;
            return (
              <button
                key={avatar.id}
                type="button"
                onClick={() => setDetachedShizuku({ avatarId: avatar.id as Live2DAvatarId, visible: true })}
                className={cn(
                  'rounded-md border px-3 py-2 text-left transition-colors',
                  selected
                    ? 'border-primary/60 bg-primary/10 text-foreground'
                    : 'border-border/70 bg-muted/20 text-muted-foreground hover:bg-muted/35 hover:text-foreground',
                )}
              >
                <span className="block text-xs font-semibold">{avatar.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug opacity-80">{avatar.description}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground sm:w-28">
            <Maximize2 size={13} />
            Size
          </label>
          <input
            type="range"
            min={shizukuSizeBounds.min}
            max={shizukuSizeBounds.max}
            step={5}
            value={detachedShizuku.size}
            onChange={(event) => setDetachedShizuku({ size: Number(event.currentTarget.value) })}
            className="h-2 flex-1 cursor-pointer accent-primary"
          />
          <span className="text-xs font-mono text-muted-foreground sm:w-14 sm:text-right">
            {detachedShizuku.size}px
          </span>
        </div>
      </Card>

      {feedback && (
        <Card className="p-3">
          <p className="text-xs text-success whitespace-pre-wrap">{feedback}</p>
        </Card>
      )}

      {error && (
        <Card className="p-3">
          <p className="text-xs text-destructive">{error}</p>
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <p className="py-14 text-center text-sm italic text-muted-foreground">Loading companions...</p>
        ) : cliMissingMessage ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <AlertTriangle size={24} className="text-destructive" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">CLI Pawrtal introuvable dans WSL</h3>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {cliMissingMessage}
              </p>
              <p className="mt-2 max-w-xl text-xs text-muted-foreground">
                Installe `pawrtal` dans la distribution WSL utilisée par Hermes, ou définis `PAWRTAL_CLI_PATH`, puis relance Refresh.
              </p>
            </div>
          </div>
        ) : sortedCompanions.length === 0 ? (
          <p className="py-14 text-center text-sm italic text-muted-foreground">
            Aucun companion trouvé. Vérifie `pawrtal list --json` côté WSL.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {sortedCompanions.map((companion) => {
              const isActive = activePetId === companion.id;
              const cardBusy = busyAction === `switch:${companion.id}` || busyAction === `spawn:${companion.id}`;
              return (
                <div key={companion.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                        <h3 className="text-sm font-semibold">{companion.displayName}</h3>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {companion.id}
                        </span>
                        {isActive && (
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-medium',
                            isRunning ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                          )}>
                            {isRunning ? 'active' : 'selected'}
                          </span>
                        )}
                      </div>
                      {companion.description && (
                        <p className="mt-1.5 text-xs text-muted-foreground whitespace-pre-wrap">
                          {companion.description}
                        </p>
                      )}
                      {companion.packDir && (
                        <p className="mt-1 text-[11px] font-mono text-muted-foreground/70 break-all">
                          {companion.packDir}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void runAction(
                          `switch:${companion.id}`,
                          () => api.pawrtal.switch({ petId: companion.id, session: 'current' }),
                        )}
                        disabled={actionsDisabled}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary/12 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/18 disabled:opacity-45 transition-colors"
                      >
                        <Play size={13} className={cardBusy ? 'animate-pulse' : ''} />
                        {isActive && isRunning ? 'Respawn' : 'Launch'}
                      </button>
                      <button
                        onClick={() => void runAction(
                          `spawn:${companion.id}`,
                          () => api.pawrtal.spawn({ petId: companion.id, session: 'current' }),
                        )}
                        disabled={actionsDisabled}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
                      >
                        Spawn
                      </button>
                      <button
                        onClick={() => void runAction(
                          `vanish:${companion.id}`,
                          () => api.pawrtal.vanish({ petId: companion.id, session: 'current' }),
                        )}
                        disabled={actionsDisabled}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-3 py-1.5 text-xs text-foreground/85 hover:bg-muted disabled:opacity-45 transition-colors"
                      >
                        Vanish
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
