import { useEffect } from 'react';
import { consumeDraft } from '../chatDraftBridge';

interface UseChatDraftOptions {
  setInput: (value: string) => void;
}

export function useChatDraft({ setInput }: UseChatDraftOptions) {
  useEffect(() => {
    const delegatedDraft = consumeDraft();
    if (delegatedDraft?.text) {
      setInput(delegatedDraft.text);
    }
  }, [setInput]);
}
