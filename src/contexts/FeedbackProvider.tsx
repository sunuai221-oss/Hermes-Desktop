import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  FeedbackContext,
  type FeedbackContextValue,
  type ToastTone,
} from './FeedbackContext';
import { useConfirmState, type ConfirmState } from './feedback/useConfirmState';
import { usePromptState, type PromptState } from './feedback/usePromptState';
import { useToastState, type ToastRecord } from './feedback/useToastState';

// ── Toast Styles ──

const TOAST_STYLES: Record<ToastTone, { icon: ReactNode; border: string; iconColor: string }> = {
  info: { icon: <Info size={16} />, border: 'border-primary/20 bg-card', iconColor: 'text-primary' },
  success: { icon: <CheckCircle2 size={16} />, border: 'border-green-500/20 bg-card', iconColor: 'text-success' },
  warning: { icon: <AlertTriangle size={16} />, border: 'border-amber-500/20 bg-card', iconColor: 'text-warning' },
  error: { icon: <XCircle size={16} />, border: 'border-red-500/20 bg-card', iconColor: 'text-destructive' },
};

// ── Provider ──

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { toasts, dismissToast, notify } = useToastState();
  const { confirmState, confirm, closeConfirm } = useConfirmState();
  const { promptState, promptValue, promptError, prompt, changePromptValue, closePrompt, submitPrompt } = usePromptState();

  const value = useMemo<FeedbackContextValue>(() => ({ notify, confirm, prompt }), [notify, confirm, prompt]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {confirmState && <ConfirmDialog options={confirmState} onClose={closeConfirm} />}
      {promptState && (
        <PromptDialog
          options={promptState} value={promptValue} error={promptError}
          onChange={changePromptValue} onClose={closePrompt} onSubmit={submitPrompt}
        />
      )}
    </FeedbackContext.Provider>
  );
}

// ── Internal Components ──

function ToastStack({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-3">
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.tone];
        return (
          <div key={toast.id} className={cn('pointer-events-auto rounded-xl border p-4 shadow-2xl backdrop-blur', style.border)}>
            <div className="flex items-start gap-3">
              <div className={cn('mt-0.5', style.iconColor)}>{style.icon}</div>
              <div className="min-w-0 flex-1">
                {toast.title && <p className="text-sm font-semibold text-foreground">{toast.title}</p>}
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{toast.message}</p>
              </div>
              <button onClick={() => onDismiss(toast.id)} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Close notification">
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConfirmDialog({ options, onClose }: { options: ConfirmState; onClose: (result: boolean) => void }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-foreground">{options.title}</h3>
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{options.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => onClose(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">{options.cancelLabel || 'Cancel'}</button>
          <button onClick={() => onClose(true)} className={cn('rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors', options.danger ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90')}>{options.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

function PromptDialog({ options, value, error, onChange, onClose, onSubmit }: {
  options: PromptState; value: string; error: string | null;
  onChange: (value: string) => void; onClose: (value: string | null) => void; onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-foreground">{options.title}</h3>
        {options.message && <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{options.message}</p>}
        <label className="mt-5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{options.label || 'Value'}</label>
        <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } if (e.key === 'Escape') { e.preventDefault(); onClose(null); } }} placeholder={options.placeholder} className="mt-2 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none ring-0 transition focus:border-primary/40 focus:bg-background" />
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => onClose(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">{options.cancelLabel || 'Cancel'}</button>
          <button onClick={onSubmit} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">{options.confirmLabel || 'Submit'}</button>
        </div>
      </div>
    </div>
  );
}
