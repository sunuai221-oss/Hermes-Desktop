import { createContext, useContext } from 'react';

// ── Types ──

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastInput = {
  title?: string;
  message: string;
  tone?: ToastTone;
};

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
};

export type FeedbackContextValue = {
  notify: (input: ToastInput) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

// ── Context + Hook ──

export const FeedbackContext = createContext<FeedbackContextValue | undefined>(undefined);

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return context;
}
