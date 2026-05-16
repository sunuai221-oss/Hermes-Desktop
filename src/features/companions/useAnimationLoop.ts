import { useEffect, useRef, useCallback } from 'react';

/**
 * requestAnimationFrame-based animation loop that auto-pauses when the tab is hidden.
 *
 * @param callback  Called every frame with deltaMs since last frame. Paused when document.hidden.
 * @param active    Whether the loop should run. Set false to pause indefinitely.
 */
export function useAnimationLoop(
  callback: (deltaMs: number) => void,
  active: boolean,
): { stop: () => void } {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const callbackRef = useRef(callback);
  const stoppedRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!active) return;
    stoppedRef.current = false;

    const loop = (time: number) => {
      if (stoppedRef.current) return;
      if (document.hidden) {
        lastTimeRef.current = 0;
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const delta = lastTimeRef.current ? time - lastTimeRef.current : 16;
      lastTimeRef.current = time;
      callbackRef.current(delta);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = 0;
    };
  }, [active]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    lastTimeRef.current = 0;
  }, []);

  return { stop };
}
