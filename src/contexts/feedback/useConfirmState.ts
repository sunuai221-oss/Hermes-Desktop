import { useCallback, useState } from 'react';
import type { ConfirmOptions } from '../FeedbackContext';

export type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function useConfirmState() {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...options, resolve });
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    setConfirmState((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  return { confirmState, confirm, closeConfirm };
}
