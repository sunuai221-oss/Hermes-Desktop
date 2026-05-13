import { useCallback } from 'react';
import type { Message } from '../../../types';
import {
  formatUsageStatus,
  isLocalCommand,
  parseCommandInput,
} from '../chatCommands';

type SetState<T> = (value: T | ((current: T) => T)) => void;

interface UseChatLocalCommandsOptions {
  activeSessionId: string | null;
  currentProfile: string;
  gatewayBuilderStatus: string;
  gatewayHealth: string;
  gatewayDirectHealth: string;
  gatewayProcessStatus: { status?: string; port?: number | null } | null | undefined;
  preferredModel: string;
  runtimeProviderLabel: string;
  usage: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    cost?: number | null;
    rateLimitRemaining?: number | null;
    rateLimitReset?: number | string | null;
  } | null;
  handleNewChat: () => void;
  setMessages: SetState<Message[]>;
}

export function useChatLocalCommands(options: UseChatLocalCommandsOptions) {
  const {
    activeSessionId, currentProfile,
    gatewayBuilderStatus, gatewayHealth, gatewayDirectHealth, gatewayProcessStatus,
    preferredModel, runtimeProviderLabel, usage,
    handleNewChat, setMessages,
  } = options;

  const appendLocalAssistantMessage = useCallback((content: string) => {
    if (!content.trim()) return;
    setMessages(current => [...current, { role: 'assistant', content, timestamp: Date.now() }]);
  }, [setMessages]);

  const formatStatusMessage = useCallback(() => {
    const processStatus = gatewayProcessStatus?.status || 'unknown';
    const processPort = gatewayProcessStatus?.port ?? 'n/a';
    const session = activeSessionId || 'none';

    return [
      `profile ${currentProfile}`,
      `backend ${gatewayBuilderStatus}`,
      `gateway ${gatewayHealth}`,
      `direct ${gatewayDirectHealth}`,
      `process ${processStatus} on :${processPort}`,
      `provider ${runtimeProviderLabel}`,
      `model ${preferredModel}`,
      `session ${session}`,
    ].join('\n');
  }, [
    activeSessionId, currentProfile,
    gatewayBuilderStatus, gatewayHealth, gatewayDirectHealth,
    gatewayProcessStatus?.port, gatewayProcessStatus?.status,
    preferredModel, runtimeProviderLabel,
  ]);

  const handleLocalCommand = useCallback((trimmedInput: string) => {
    const command = parseCommandInput(trimmedInput);
    if (!command || !isLocalCommand(command.id)) return false;

    if (command.id === 'new') {
      handleNewChat();
      return true;
    }

    if (command.id === 'usage') {
      appendLocalAssistantMessage(formatUsageStatus(usage));
      return true;
    }

    if (command.id === 'status') {
      appendLocalAssistantMessage(formatStatusMessage());
      return true;
    }

    return false;
  }, [appendLocalAssistantMessage, formatStatusMessage, handleNewChat, usage]);

  return { handleLocalCommand };
}
