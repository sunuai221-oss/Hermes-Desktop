import { useCallback, useState } from 'react';
import type { PromptOptions } from '../FeedbackContext';

export type PromptState = PromptOptions & {
  resolve: (value: string | null) => void;
};

export function usePromptState() {
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(options.defaultValue || '');
      setPromptError(null);
      setPromptState({ ...options, resolve });
    });
  }, []);

  const changePromptValue = useCallback((next: string) => {
    setPromptValue(next);
    setPromptError(null);
  }, []);

  const closePrompt = useCallback((result: string | null) => {
    setPromptState((current) => {
      current?.resolve(result);
      return null;
    });
    setPromptError(null);
  }, []);

  const submitPrompt = useCallback(() => {
    if (!promptState) return;
    const trimmed = promptValue.trim();
    const validationError = promptState.validate ? promptState.validate(trimmed) : null;
    if (validationError) {
      setPromptError(validationError);
      return;
    }
    promptState.resolve(trimmed);
    setPromptState(null);
    setPromptError(null);
  }, [promptState, promptValue]);

  return {
    promptState,
    promptValue,
    promptError,
    prompt,
    changePromptValue,
    closePrompt,
    submitPrompt,
  };
}
