import { useCallback } from 'react';
import * as apiClient from '../../../api';
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

const PAWRTAL_HELP = [
  'Usage:',
  '  /pawrtal list',
  '  /pawrtal status [session]',
  '  /pawrtal spawn [pet_id] [session]',
  '  /pawrtal hide [session]',
  '  /pawrtal switch <pet_id> [session]',
  '  /pawrtal reset [pet_id] [session]',
  '  /pawrtal <pet_id> [session]   (alias for spawn)',
].join('\n');

function toCompactJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || '');
  }
}

function getPawrtalErrorMessage(error: unknown) {
  const data = (error as {
    response?: { data?: { error?: string; details?: string; stderr?: string; errorCode?: string } };
  })?.response?.data;
  const message = data?.error || data?.details || data?.stderr;
  return message || 'Pawrtal command failed.';
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

  const handlePawrtalCommand = useCallback(async (args: string) => {
    const tokens = String(args || '').trim().split(/\s+/).filter(Boolean);
    const action = (tokens[0] || '').toLowerCase();
    const defaultSession = 'current';

    if (!action || action === 'help' || action === '-h' || action === '--help') {
      appendLocalAssistantMessage(PAWRTAL_HELP);
      return;
    }

    try {
      if (action === 'list') {
        const response = await apiClient.pawrtal.list();
        const companions = Array.isArray(response.data?.companions) ? response.data.companions : [];
        if (companions.length > 0) {
          const lines = companions.map((item) => {
            const id = String(item?.id || '');
            const name = String(item?.displayName || id);
            const description = String(item?.description || '');
            return description
              ? `- ${id} (${name})\n  ${description}`
              : `- ${id} (${name})`;
          });
          appendLocalAssistantMessage(`Companions disponibles:\n${lines.join('\n')}`);
        } else {
          appendLocalAssistantMessage(toCompactJson(response.data));
        }
        return;
      }

      if (action === 'status') {
        const response = await apiClient.pawrtal.status(tokens[1] || defaultSession);
        appendLocalAssistantMessage(toCompactJson(response.data));
        return;
      }

      if (action === 'spawn') {
        const response = await apiClient.pawrtal.spawn({
          petId: tokens[1] || null,
          session: tokens[2] || defaultSession,
        });
        appendLocalAssistantMessage(toCompactJson(response.data));
        return;
      }

      if (action === 'hide' || action === 'vanish') {
        const response = await apiClient.pawrtal.vanish({
          petId: null,
          session: tokens[1] || defaultSession,
        });
        appendLocalAssistantMessage(toCompactJson(response.data));
        return;
      }

      if (action === 'use') {
        if (!tokens[1]) {
          appendLocalAssistantMessage(PAWRTAL_HELP);
          return;
        }
        const response = await apiClient.pawrtal.use({
          petId: tokens[1],
          session: tokens[2] || defaultSession,
        });
        appendLocalAssistantMessage(toCompactJson(response.data));
        return;
      }

      if (action === 'switch') {
        if (!tokens[1]) {
          appendLocalAssistantMessage(PAWRTAL_HELP);
          return;
        }
        const response = await apiClient.pawrtal.switch({
          petId: tokens[1],
          session: tokens[2] || defaultSession,
        });
        appendLocalAssistantMessage(toCompactJson(response.data));
        return;
      }

      if (action === 'reset') {
        const response = await apiClient.pawrtal.reset({
          petId: tokens[1] || null,
          session: tokens[2] || defaultSession,
        });
        appendLocalAssistantMessage(toCompactJson(response.data));
        return;
      }

      if (/^[\w.-]{1,120}$/.test(action)) {
        const response = await apiClient.pawrtal.spawn({
          petId: action,
          session: tokens[1] || defaultSession,
        });
        appendLocalAssistantMessage(toCompactJson(response.data));
        return;
      }

      appendLocalAssistantMessage(`Unknown /pawrtal command: ${action}\n\n${PAWRTAL_HELP}`);
    } catch (error) {
      appendLocalAssistantMessage(`Pawrtal error: ${getPawrtalErrorMessage(error)}`);
    }
  }, [appendLocalAssistantMessage]);

  const handleLocalCommand = useCallback(async (trimmedInput: string) => {
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

    if (command.id === 'pawrtal') {
      await handlePawrtalCommand(command.args);
      return true;
    }

    if (command.id === 'status') {
      appendLocalAssistantMessage(formatStatusMessage());
      return true;
    }

    return false;
  }, [appendLocalAssistantMessage, formatStatusMessage, handleNewChat, handlePawrtalCommand, usage]);

  return { handleLocalCommand };
}
