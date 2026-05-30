import { useEffect, useRef } from 'react';
import { consumeDraft } from '../chatDraftBridge';
import type { StoredChatDraft } from '../chatDraftBridge';

interface UseChatDraftOptions {
  setInput: (value: string) => void;
  onDraft?: (draft: StoredChatDraft) => Promise<void> | void;
}

export function useChatDraft({ setInput, onDraft }: UseChatDraftOptions) {
  const setInputRef = useRef(setInput);
  const onDraftRef = useRef(onDraft);

  useEffect(() => {
    setInputRef.current = setInput;
  }, [setInput]);

  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);

  useEffect(() => {
    let cancelled = false;
    const delegatedDraft = consumeDraft();
    if (delegatedDraft?.text) {
      void (async () => {
        try {
          await onDraftRef.current?.(delegatedDraft);
        } finally {
          if (!cancelled) {
            setInputRef.current(delegatedDraft.text);
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, []);
}
