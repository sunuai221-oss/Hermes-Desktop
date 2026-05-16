import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LIVE2D_AVATAR_ID, getLive2DAvatarDefinition, type Live2DAvatarId } from './live2dAvatars';

export interface DetachedShizukuState {
  visible: boolean;
  avatarId: Live2DAvatarId;
  size: number;
  x: number;
  y: number;
}

export const DETACHED_SHIZUKU_EVENT = 'hermes:detached-shizuku:update';

const STORAGE_KEY = 'hermes_detached_shizuku';
const MIN_SIZE = 120;
const MAX_SIZE = 720;

export function getDetachedShizukuSizeBounds() {
  return { min: MIN_SIZE, max: MAX_SIZE };
}

export function getDetachedShizukuWidth(size: number) {
  return Math.round(size * 0.76);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getViewport() {
  if (typeof window === 'undefined') return { width: 1280, height: 800 };
  return {
    width: Math.max(window.innerWidth, 320),
    height: Math.max(window.innerHeight, 320),
  };
}

function getDefaultState(): DetachedShizukuState {
  const size = 190;
  const avatarWidth = getDetachedShizukuWidth(size);
  const viewport = getViewport();
  return {
    visible: false,
    avatarId: DEFAULT_LIVE2D_AVATAR_ID,
    size,
    x: Math.max(24, viewport.width - avatarWidth - 56),
    y: Math.max(72, viewport.height - size - 88),
  };
}

export function normalizeDetachedShizukuState(value: Partial<DetachedShizukuState>): DetachedShizukuState {
  const defaults = getDefaultState();
  const size = clamp(Number(value.size) || defaults.size, MIN_SIZE, MAX_SIZE);
  const viewport = getViewport();
  const avatarWidth = getDetachedShizukuWidth(size);
  const maxX = Math.max(8, viewport.width - avatarWidth - 8);
  const maxY = Math.max(8, viewport.height - size - 8);

  return {
    visible: typeof value.visible === 'boolean' ? value.visible : defaults.visible,
    avatarId: getLive2DAvatarDefinition(value.avatarId).id,
    size,
    x: clamp(Number.isFinite(value.x) ? Number(value.x) : defaults.x, 8, maxX),
    y: clamp(Number.isFinite(value.y) ? Number(value.y) : defaults.y, 8, maxY),
  };
}

export function readDetachedShizukuState(): DetachedShizukuState {
  if (typeof window === 'undefined') return getDefaultState();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    return normalizeDetachedShizukuState(JSON.parse(raw));
  } catch {
    return getDefaultState();
  }
}

export function writeDetachedShizukuState(next: DetachedShizukuState) {
  const normalized = normalizeDetachedShizukuState(next);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent<DetachedShizukuState>(DETACHED_SHIZUKU_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function updateDetachedShizukuState(
  patch: Partial<DetachedShizukuState> | ((current: DetachedShizukuState) => Partial<DetachedShizukuState>),
) {
  const current = readDetachedShizukuState();
  const nextPatch = typeof patch === 'function' ? patch(current) : patch;
  return writeDetachedShizukuState({ ...current, ...nextPatch });
}

export function resetDetachedShizukuPosition() {
  const current = readDetachedShizukuState();
  const defaults = getDefaultState();
  return writeDetachedShizukuState({
    ...current,
    x: defaults.x,
    y: defaults.y,
  });
}

export function useDetachedShizukuState() {
  const [state, setState] = useState<DetachedShizukuState>(() => readDetachedShizukuState());

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<DetachedShizukuState>).detail;
      setState(detail ? normalizeDetachedShizukuState(detail) : readDetachedShizukuState());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setState(readDetachedShizukuState());
    };

    const handleResize = () => {
      setState(updateDetachedShizukuState(current => current));
    };

    window.addEventListener(DETACHED_SHIZUKU_EVENT, handleUpdate);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener(DETACHED_SHIZUKU_EVENT, handleUpdate);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const update = useCallback((
    patch: Partial<DetachedShizukuState> | ((current: DetachedShizukuState) => Partial<DetachedShizukuState>),
  ) => {
    setState(updateDetachedShizukuState(patch));
  }, []);

  return [state, update] as const;
}
