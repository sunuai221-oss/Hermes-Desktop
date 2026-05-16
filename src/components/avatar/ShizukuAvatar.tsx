/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useImperativeHandle, forwardRef, useState, type ForwardRefRenderFunction } from 'react';
import { getLive2DAvatarDefinition, type Live2DAvatarDefinition, type Live2DAvatarId } from '../../features/companions/live2dAvatars';
import { Live2DRuntimeManager } from '../../features/companions/live2dRuntime';
import { useAnimationLoop } from '../../features/companions/useAnimationLoop';
import { cn } from '../../lib/utils';

export interface ShizukuAvatarRef {
  setExpression: (name: string) => void;
  setMotion: (group: string, index?: number) => void;
  startAnimation: () => void;
  stopAnimation: () => void;
  focus: (x: number, y: number) => void;
  startTalking: (intensity?: number) => void;
  stopTalking: () => void;
}

interface ShizukuAvatarProps {
  className?: string;
  avatarId?: Live2DAvatarId;
  avatar?: Live2DAvatarDefinition;
  width?: number;
  height?: number;
  active?: boolean;
  showStatus?: boolean;
  disabled?: boolean;
  onLoad?: () => void;
  onError?: (error: Error) => void;
  onRetry?: () => void;
}

function detectWebGLSupport(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';
    const info = (gl as any).getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? (gl as any).getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    (gl as any).getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return String(renderer || 'webgl-ok').slice(0, 120);
  } catch { return 'error'; }
}

type Live2DLoadState = 'loading' | 'ready' | 'runtime-error' | 'model-error' | 'canvas-error';

const MOUTH_OPEN_PARAM_IDS = ['PARAM_MOUTH_OPEN_Y', 'ParamMouthOpenY'];
const MOUTH_FORM_PARAM_IDS = ['PARAM_MOUTH_FORM', 'ParamMouthForm'];

interface Live2DParameterBinding {
  id: string;
  index: number;
}

function findLive2DParameter(coreModel: any, ids: string[]): Live2DParameterBinding | null {
  if (!coreModel) return null;

  for (const id of ids) {
    if (typeof coreModel.getParamIndex === 'function') {
      const index = Number(coreModel.getParamIndex(id));
      if (Number.isFinite(index) && index >= 0) return { id, index };
    }

    if (typeof coreModel.getParameterIndex === 'function') {
      const index = Number(coreModel.getParameterIndex(id));
      if (Number.isFinite(index) && index >= 0) return { id, index };
    }
  }

  return null;
}

function setLive2DParameter(coreModel: any, parameter: Live2DParameterBinding | null, value: number) {
  if (!coreModel || !parameter) return;

  try {
    if (typeof coreModel.setParamFloat === 'function') {
      coreModel.setParamFloat(parameter.id, value);
      return;
    }

    if (typeof coreModel.setParameterValueByIndex === 'function') {
      coreModel.setParameterValueByIndex(parameter.index, value);
      return;
    }

    if (typeof coreModel.setParameterValueById === 'function') {
      coreModel.setParameterValueById(parameter.id, value);
      return;
    }

    if (typeof coreModel.setParamValue === 'function') {
      coreModel.setParamValue(parameter.id, value);
    }
  } catch {
    // Live2D models vary by Cubism runtime; a failed parameter write should not break audio playback.
  }
}

function playMotion(model: any, group: string, variants = 3) {
  if (!model?.motion) return;
  const motion = model.motion(group, Math.floor(Math.random() * variants));
  if (motion && typeof motion.catch === 'function') {
    motion.catch(() => {});
  }
}

function setExpression(model: any, name: string) {
  const expression = model?.internalModel?.expressionManager?.setExpression?.(name);
  if (expression && typeof expression.catch === 'function') {
    expression.catch(() => {});
  }
}

const ShizukuAvatarInner: ForwardRefRenderFunction<ShizukuAvatarRef, ShizukuAvatarProps> = (
  { className, avatarId, avatar: avatarProp, width = 300, height = 400, active = false, showStatus = false, disabled = false, onLoad, onError, onRetry },
  ref
) => {
  const avatar = avatarProp || getLive2DAvatarDefinition(avatarId);
  const containerRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<any>(null); // using any to avoid type issues
  const appRef = useRef<any>(null);
  const activeRef = useRef(active);
  const avatarRef = useRef(avatar);
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  const totalElapsedRef = useRef(0);
  const tapResetTimerRef = useRef<number | null>(null);
  const talkingRef = useRef(false);
  const talkingTimeRef = useRef(0);
  const talkingIntensityRef = useRef(0.75);
  const talkingFrameHandlerRef = useRef<(() => void) | null>(null);
  const mouthOpenParamRef = useRef<Live2DParameterBinding | null>(null);
  const mouthFormParamRef = useRef<Live2DParameterBinding | null>(null);
  const [loadState, setLoadState] = useState<Live2DLoadState>('loading');

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    avatarRef.current = avatar;
  }, [avatar]);

  useEffect(() => {
    onLoadRef.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const applyTalkingMouthFrame = useCallback(() => {
    if (!talkingRef.current) return;
    const model = modelRef.current;
    const coreModel = model?.internalModel?.coreModel;
    const mouthOpenParam = mouthOpenParamRef.current || findLive2DParameter(coreModel, MOUTH_OPEN_PARAM_IDS);
    if (!coreModel || !mouthOpenParam) return;

    talkingTimeRef.current += 1;
    mouthOpenParamRef.current = mouthOpenParam;

    // Applied in Live2D's beforeModelUpdate hook so motions/expressions cannot erase lipsync before draw.
    const t = talkingTimeRef.current * 0.15;
    const base = Math.sin(t * 2.3) * 0.5 + 0.5;
    const detail = Math.sin(t * 5.1) * 0.2;
    const micro = Math.sin(t * 11.7) * 0.1;
    const intensity = talkingIntensityRef.current;
    const value = Math.max(0, Math.min(1, (base + detail + micro) * intensity));
    setLive2DParameter(coreModel, mouthOpenParam, value);

    const mouthFormParam = mouthFormParamRef.current;
    if (mouthFormParam) {
      const form = Math.max(0, Math.sin(t * 3.7 + 1) * 0.5);
      setLive2DParameter(coreModel, mouthFormParam, form * intensity * 0.6);
    }
  }, []);

  // Expose imperative methods to parent
  useImperativeHandle(ref, () => ({
    setExpression: (name: string) => {
      if (modelRef.current?.internalModel?.expressionManager) {
        modelRef.current.internalModel.expressionManager.setExpression(name).catch(() => {});
      }
    },

    setMotion: (group: string, index: number = 0) => {
      if (modelRef.current) {
        modelRef.current.motion?.(group, index).catch(() => {});
      }
    },

    startAnimation: () => {
      playMotion(modelRef.current, avatarRef.current.idleMotion);
    },

    stopAnimation: () => {
      totalElapsedRef.current = 0;
      if (modelRef.current?.internalModel?.motionManager) {
        modelRef.current.internalModel.motionManager.stopAllMotions();
      }
    },

    focus: (x: number, y: number) => {
      if (modelRef.current?.internalModel?.focusController) {
        modelRef.current.internalModel.focusController.focus(x, y, true);
      }
    },

    startTalking: (intensity = 0.7) => {
      const model = modelRef.current;
      const coreModel = model?.internalModel?.coreModel;
      const mouthOpenParam = mouthOpenParamRef.current || findLive2DParameter(coreModel, MOUTH_OPEN_PARAM_IDS);
      if (!coreModel || !mouthOpenParam || talkingRef.current) return;

      talkingRef.current = true;
      talkingTimeRef.current = 0;
      talkingIntensityRef.current = Math.max(0, Math.min(1, intensity));
      mouthOpenParamRef.current = mouthOpenParam;
      setLive2DParameter(coreModel, mouthOpenParam, 0.12 * talkingIntensityRef.current);
    },

    stopTalking: () => {
      talkingRef.current = false;
      talkingTimeRef.current = 0;

      const model = modelRef.current;
      const coreModel = model?.internalModel?.coreModel;
      setLive2DParameter(coreModel, mouthOpenParamRef.current || findLive2DParameter(coreModel, MOUTH_OPEN_PARAM_IDS), 0);
    },
  }));

  useEffect(() => {
    let mounted = true;
    let view: any = null;

    const init = async () => {
      try {
        setLoadState('loading');
        const runtime = Live2DRuntimeManager.getInstance();
        view = await runtime.createView(avatar.modelUrl, avatar, width, height, avatar.modelVersion);

        if (!mounted) {
          runtime.destroyView(view);
          return;
        }

        appRef.current = view.app;
        modelRef.current = view.model;
        const coreModel = view.model?.internalModel?.coreModel;
        mouthOpenParamRef.current = findLive2DParameter(coreModel, MOUTH_OPEN_PARAM_IDS);
        mouthFormParamRef.current = findLive2DParameter(coreModel, MOUTH_FORM_PARAM_IDS);
        const handleBeforeModelUpdate = () => applyTalkingMouthFrame();
        talkingFrameHandlerRef.current = handleBeforeModelUpdate;
        view.model?.internalModel?.on?.('beforeModelUpdate', handleBeforeModelUpdate);
        if (containerRef.current) {
          containerRef.current.appendChild(view.canvas);
        }

        // Enable mouse tracking
        view.model.interactive = true;
        view.model.on('pointertap', () => {
          const currentModel = modelRef.current;
          const currentAvatar = avatarRef.current;
          playMotion(currentModel, currentAvatar.tapMotion);
          setExpression(currentModel, currentAvatar.tapExpression);
          if (tapResetTimerRef.current != null) {
            window.clearTimeout(tapResetTimerRef.current);
          }
          tapResetTimerRef.current = window.setTimeout(() => {
            const currentAvatar = avatarRef.current;
            setExpression(modelRef.current, activeRef.current ? currentAvatar.activeExpression : currentAvatar.idleExpression);
          }, 1200);
        });

        runtime.fitModelToCanvas(view.model, width, height, avatar);
        view.app.render();
        setLoadState('ready');
        onLoadRef.current?.();
      } catch (e: any) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        let errorState: Live2DLoadState = 'runtime-error';
        if (errorMessage.includes('model') || errorMessage.includes('Model') || errorMessage.includes('.model.json')) {
          errorState = 'model-error';
        } else if (errorMessage.includes('canvas') || errorMessage.includes('Canvas') || errorMessage.includes('WebGL') || errorMessage.includes('webgl')) {
          errorState = 'canvas-error';
        }
        console.error(
          '[Live2D] Failed to load avatar:', {
            avatar: avatar.label,
            modelUrl: avatar.modelUrl,
            error: e instanceof Error ? { message: e.message, stack: e.stack?.split('\n').slice(0, 3).join('\n') } : String(e),
            userAgent: navigator.userAgent.slice(0, 100),
            webgl: detectWebGLSupport(),
          }
        );
        setLoadState(errorState);
        onErrorRef.current?.(e instanceof Error ? e : new Error(errorMessage));
      }
    };

    init();

    return () => {
      mounted = false;
      if (tapResetTimerRef.current != null) {
        window.clearTimeout(tapResetTimerRef.current);
        tapResetTimerRef.current = null;
      }
      talkingRef.current = false;
      const handler = talkingFrameHandlerRef.current;
      const internalModel = modelRef.current?.internalModel;
      if (handler) {
        internalModel?.off?.('beforeModelUpdate', handler);
        internalModel?.removeListener?.('beforeModelUpdate', handler);
        talkingFrameHandlerRef.current = null;
      }
      if (view) {
        Live2DRuntimeManager.getInstance().destroyView(view);
      }
      modelRef.current = null;
      appRef.current = null;
      mouthOpenParamRef.current = null;
      mouthFormParamRef.current = null;
    };
  }, [applyTalkingMouthFrame, avatar, height, width]);

  // ── Animation loop via RAF ──────────────────────────────────────

  const IDLE_INTERVAL = 9000;
  const ACTIVE_INTERVAL = 2400;

  useAnimationLoop((deltaMs) => {
    const model = modelRef.current;
    if (!model || loadState !== 'ready') return;
    if (activeRef.current) {
      setExpression(model, avatarRef.current.activeExpression);
    }

    totalElapsedRef.current += deltaMs;
    const interval = activeRef.current ? ACTIVE_INTERVAL : IDLE_INTERVAL;

    if (totalElapsedRef.current >= interval) {
      totalElapsedRef.current = 0;
      if (activeRef.current) {
        const motions = avatarRef.current.activeMotions;
        playMotion(model, motions[Math.floor(Math.random() * motions.length)] || avatarRef.current.idleMotion);
      } else {
        playMotion(model, avatarRef.current.idleMotion);
      }
    }
  }, loadState === 'ready');

  const errorMessages: Record<Live2DLoadState, string> = {
    loading: '',
    ready: '',
    'runtime-error': 'Runtime Live2D introuvable. Vérifie public/live2d-runtime/.',
    'model-error': `Modèle "${avatar.label}" impossible à charger. Fichier .model.json corrompu ?`,
    'canvas-error': 'Canvas WebGL indisponible. Navigateur trop ancien ?',
  };

  if (disabled) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-lg border border-border/40 bg-background/20 text-[10px] text-muted-foreground', className)}
        style={{ width, height }}
      >
        Live2D désactivé
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden rounded-lg bg-transparent', className)}
      style={{ width, height }}
    >
      {showStatus && loadState !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-border/40 bg-background/30 p-2 text-center">
          {loadState === 'loading' ? (
            <span className="text-[10px] text-muted-foreground">Shizuku...</span>
          ) : (
            <>
              <span className="text-[10px] text-destructive/80 leading-tight">{errorMessages[loadState]}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onRetry?.();
                    setLoadState('loading');
                  }}
                  className="rounded bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/30 transition-colors"
                >
                  Retry
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const ShizukuAvatar = forwardRef(ShizukuAvatarInner);
