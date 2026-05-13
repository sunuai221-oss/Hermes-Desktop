import { useCallback, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

export type ChatSessionRequest = {
  sessionId: string | null;
  nonce: number;
};

export function useChatSessionOpener({
  navigate,
  chatPath,
  onBeforeOpen,
}: {
  navigate: NavigateFunction;
  chatPath: string;
  onBeforeOpen?: () => void;
}) {
  const [chatSessionRequest, setChatSessionRequest] = useState<ChatSessionRequest>({
    sessionId: null,
    nonce: 0,
  });

  const openChatSession = useCallback((sessionId: string | null = null) => {
    setChatSessionRequest({ sessionId, nonce: Date.now() });
    onBeforeOpen?.();
    navigate(chatPath);
  }, [chatPath, navigate, onBeforeOpen]);

  return { chatSessionRequest, openChatSession };
}
