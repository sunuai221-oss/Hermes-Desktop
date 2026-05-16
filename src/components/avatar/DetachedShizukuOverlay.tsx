import { useRef, useState, useEffect, useCallback, type PointerEvent } from 'react';
import { Maximize2, Move, RotateCcw, X } from 'lucide-react';
import { ShizukuAvatar, type ShizukuAvatarRef } from './ShizukuAvatar';
import {
  getDetachedShizukuSizeBounds,
  getDetachedShizukuWidth,
  resetDetachedShizukuPosition,
  useDetachedShizukuState,
} from '../../features/companions/detachedShizuku';
import { getLive2DAvatarDefinition } from '../../features/companions/live2dAvatars';
import { cn } from '../../lib/utils';

interface PointerSession {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originSize: number;
}

const TOOLBAR_HIDE_DELAY = 2500; // ms before toolbar auto-hides

export function DetachedShizukuOverlay() {
  const [state, updateState] = useDetachedShizukuState();
  const [mode, setMode] = useState<'idle' | 'dragging' | 'resizing'>('idle');
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const pointerSessionRef = useRef<PointerSession | null>(null);
  const shizukuRef = useRef<ShizukuAvatarRef>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bounds = getDetachedShizukuSizeBounds();
  const avatar = getLive2DAvatarDefinition(state.avatarId);

  // ── Lipsync: listen for voice events ────────────────────────────
  useEffect(() => {
    const handleVoice = (event: Event) => {
      const detail = (event as CustomEvent<{ state: string }>).detail;
      if (detail.state === 'start') {
        shizukuRef.current?.startTalking();
      } else {
        shizukuRef.current?.stopTalking();
      }
    };
    window.addEventListener('hermes:voice:speaking', handleVoice);
    return () => window.removeEventListener('hermes:voice:speaking', handleVoice);
  }, []);

  // ── Toolbar auto-hide ──────────────────────────────────────────

  const scheduleHideToolbar = useCallback(() => {
    setToolbarVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
    }, TOOLBAR_HIDE_DELAY);
  }, []);

  const showToolbar = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setToolbarVisible(true);
  }, []);

  useEffect(() => {
    hideTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
    }, TOOLBAR_HIDE_DELAY);

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!state.visible) return null;

  const width = getDetachedShizukuWidth(state.size);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-shizuku-control]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.x,
      originY: state.y,
      originSize: state.size,
    };
    showToolbar();
    setMode('dragging');
    event.preventDefault();
  };

  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.x,
      originY: state.y,
      originSize: state.size,
    };
    showToolbar();
    setMode('resizing');
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    if (mode === 'dragging') {
      updateState({
        x: session.originX + event.clientX - session.startX,
        y: session.originY + event.clientY - session.startY,
      });
      return;
    }

    if (mode === 'resizing') {
      const delta = Math.max(event.clientX - session.startX, event.clientY - session.startY);
      updateState({
        size: Math.min(bounds.max, Math.max(bounds.min, session.originSize + delta)),
      });
    }
  };

  const stopPointerAction = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerSessionRef.current?.pointerId !== event.pointerId) return;
    pointerSessionRef.current = null;
    setMode('idle');
    scheduleHideToolbar();

    // ── Snap to edge ────────────────────────────────────────────────
    if (mode === 'dragging') {
      const vp = typeof window !== 'undefined'
        ? { width: window.innerWidth, height: window.innerHeight }
        : { width: 1280, height: 800 };
      const maxX = Math.max(8, vp.width - width - 8);
      const SNAP_THRESHOLD = 60;
      let snapX = state.x;
      if (state.x <= SNAP_THRESHOLD) snapX = 8;
      else if (state.x >= maxX - SNAP_THRESHOLD) snapX = maxX;
      if (snapX !== state.x) {
        updateState({ x: snapX });
      }
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        className={cn(
          'pointer-events-auto fixed select-none rounded-lg border transition-all duration-200',
          mode !== 'idle'
            ? 'border-primary/50 bg-background/20 shadow-2xl shadow-black/30 ring-1 ring-primary/30'
            : 'border-transparent bg-transparent shadow-lg shadow-black/20 hover:border-border/30 hover:bg-background/10 hover:shadow-xl hover:shadow-black/25',
        )}
        style={{
          left: 0,
          top: 0,
          width,
          height: state.size,
          transform: `translate3d(${state.x}px, ${state.y}px, 0)`,
        }}
        onPointerDown={startDrag}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPointerAction}
        onPointerCancel={stopPointerAction}
        onMouseEnter={showToolbar}
        onMouseLeave={scheduleHideToolbar}
        title="Drag Shizuku"
      >
        {/* ── Toolbar (auto-hides) ── */}
        <div
          className={cn(
            'absolute -top-8 left-0 flex cursor-grab items-center gap-1 rounded-md border border-border/60 bg-popover/95 px-1.5 py-1 text-muted-foreground shadow-lg active:cursor-grabbing transition-opacity duration-200',
            toolbarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        >
          <Move size={13} className="cursor-grab" />
          <span className="px-1 text-[10px] font-medium text-foreground/80">{avatar.label}</span>
          <button
            type="button"
            onClick={() => resetDetachedShizukuPosition()}
            data-shizuku-control
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Reset position"
            aria-label="Reset Shizuku position"
          >
            <RotateCcw size={12} />
          </button>
          <button
            type="button"
            onClick={() => updateState({ visible: false })}
            data-shizuku-control
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Vanish"
            aria-label="Hide detached Shizuku"
          >
            <X size={12} />
          </button>
        </div>

        <ShizukuAvatar
          ref={shizukuRef}
          avatar={avatar}
          width={width}
          height={state.size}
          active={mode !== 'idle'}
          showStatus
        />

        {/* ── Resize handle (fades with toolbar) ── */}
        <button
          type="button"
          className={cn(
            'absolute bottom-1 right-1 inline-flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded-md border border-border/40 bg-popover/70 text-muted-foreground/70 shadow-sm hover:text-foreground hover:bg-popover/90 transition-all duration-200',
            toolbarVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
          onPointerDown={startResize}
          data-shizuku-control
          title="Resize"
          aria-label="Resize detached Shizuku"
        >
          <Maximize2 size={11} />
        </button>
      </div>
    </div>
  );
}
