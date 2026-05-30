import { useCallback, useRef, useState } from 'react';
import * as api from '../../../api';
import { setDraft } from '../../../features/chat/chatDraftBridge';
import type { AgentWorkspace, AgentWorkspaceExecutionResult } from '../../../types';

interface UseWorkspaceExecutionOptions {
  activeWorkspace: AgentWorkspace | null;
  saveWorkspace: () => Promise<AgentWorkspace | null>;
  clearLibraryError: () => void;
  onError: (message: string) => void;
  canNavigateToChat?: () => Promise<boolean>;
  onNavigateToChat: (sessionId?: string | null) => void;
  onAfterExecute?: () => void;
}

function formatError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; details?: string } } }).response;
    return response?.data?.error || response?.data?.details || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function useWorkspaceExecution({
  activeWorkspace,
  saveWorkspace,
  clearLibraryError,
  onError,
  canNavigateToChat,
  onNavigateToChat,
  onAfterExecute,
}: UseWorkspaceExecutionOptions) {
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [executionResult, setExecutionResult] = useState<AgentWorkspaceExecutionResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [sendingToChat, setSendingToChat] = useState(false);
  const sendingToChatRef = useRef(false);
  const [copied, setCopied] = useState(false);

  const resetExecutionState = useCallback(() => {
    setGeneratedPrompt('');
    setExecutionResult(null);
    setCopied(false);
  }, []);

  const generatePrompt = useCallback(async () => {
    if (!activeWorkspace) return;
    setGenerating(true);
    onError('');
    clearLibraryError();
    try {
      const saved = await saveWorkspace();
      if (!saved) return;
      const res = await api.agentStudio.generatePrompt(saved.id);
      setGeneratedPrompt(res.data.prompt);
    } catch (promptError) {
      onError(formatError(promptError, 'Could not generate workspace prompt.'));
    } finally {
      setGenerating(false);
    }
  }, [activeWorkspace, clearLibraryError, onError, saveWorkspace]);

  const copyPrompt = useCallback(async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [generatedPrompt]);

  const sendPromptToChat = useCallback(async () => {
    if (!activeWorkspace || sendingToChatRef.current) return;
    sendingToChatRef.current = true;
    setSendingToChat(true);
    onError('');
    clearLibraryError();
    try {
      if (canNavigateToChat && !(await canNavigateToChat())) return;
      let prompt = generatedPrompt;
      if (!prompt) {
        const saved = await saveWorkspace();
        if (!saved) return;
        const res = await api.agentStudio.generatePrompt(saved.id);
        prompt = res.data.prompt;
        setGeneratedPrompt(prompt);
      }
      const promptText = String(prompt || '').trim();
      if (!promptText) {
        throw new Error('Generated workspace prompt is empty.');
      }
      setDraft({
        text: promptText,
        source: 'agent-studio-workspaces',
        metadata: {
          workspaceId: activeWorkspace.id,
          workspaceName: activeWorkspace.name,
          mode: activeWorkspace.defaultMode,
        },
      });
      onNavigateToChat(null);
    } catch (sendError) {
      onError(formatError(sendError, 'Could not send workspace prompt to Chat.'));
    } finally {
      sendingToChatRef.current = false;
      setSendingToChat(false);
    }
  }, [activeWorkspace, canNavigateToChat, clearLibraryError, generatedPrompt, onError, onNavigateToChat, saveWorkspace]);

  const executeWorkspace = useCallback(async () => {
    if (!activeWorkspace) return;
    setExecuting(true);
    onError('');
    clearLibraryError();
    setExecutionResult(null);
    try {
      const saved = await saveWorkspace();
      if (!saved) return;
      const res = await api.agentStudio.executeWorkspace(saved.id, saved.defaultMode);
      setExecutionResult(res.data);
      if (res.data.prompt) setGeneratedPrompt(res.data.prompt);
      onAfterExecute?.();
    } catch (executeError) {
      onError(formatError(executeError, 'Could not execute workspace.'));
    } finally {
      setExecuting(false);
    }
  }, [activeWorkspace, clearLibraryError, onAfterExecute, onError, saveWorkspace]);

  const openExecutionSessionInChat = useCallback(async () => {
    const sessionId = executionResult?.session_id;
    if (!sessionId) return;
    if (canNavigateToChat && !(await canNavigateToChat())) return;
    onNavigateToChat(sessionId);
  }, [canNavigateToChat, executionResult?.session_id, onNavigateToChat]);

  return {
    generatedPrompt,
    executionResult,
    generating,
    executing,
    sendingToChat,
    copied,
    resetExecutionState,
    setGeneratedPrompt,
    setExecutionResult,
    generatePrompt,
    copyPrompt,
    sendPromptToChat,
    executeWorkspace,
    openExecutionSessionInChat,
  };
}
