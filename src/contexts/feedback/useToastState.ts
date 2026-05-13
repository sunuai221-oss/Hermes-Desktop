import { useCallback, useRef, useState } from 'react';
import type { ToastInput, ToastTone } from '../FeedbackContext';

export type ToastRecord = ToastInput & {
  id: number;
  tone: ToastTone;
};

export function useToastState() {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const notify = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const tone = input.tone || 'info';
    setToasts(current => [...current, { ...input, id, tone }]);
    window.setTimeout(() => {
      setToasts(current => current.filter(toast => toast.id !== id));
    }, 3600);
  }, []);

  return { toasts, dismissToast, notify };
}
