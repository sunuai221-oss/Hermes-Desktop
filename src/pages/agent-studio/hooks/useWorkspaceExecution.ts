import { useCallback, useState } from 'react';
import * as api from '../../../api';
import { setDraft } from '../../../features/chat/chatDraftBridge';
import type { AgentWorkspace, AgentWorkspaceExecutionResult } from '../../../types';

interface UseWorkspaceExecutionOptions {
  activeWorkspace: AgentWorkspace | null;
  saveWorkspace: () => Promise<AgentWorkspace | null>;
  clearLibraryError: () => void;
  onError: (message: string) => void;
  onNavigateToChat: () => void;
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
  onNavigateToChat,
  onAfterExecute,
}: UseWorkspaceExecutionOptions) {
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [executionResult, setExecutionResult] = useState<AgentWorkspaceExecutionResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
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
    if (!activeWorkspace) return;
    let prompt = generatedPrompt;
    if (!prompt) {
      const saved = await saveWorkspace();
      if (!saved) return;
      const res = await api.agentStudio.generatePrompt(saved.id);
      prompt = res.data.prompt;
      setGeneratedPrompt(prompt);
    }
    setDraft({
      text: prompt,
      source: 'agent-studio-workspaces',
      metadata: { workspaceId: activeWorkspace.id, mode: activeWorkspace.defaultMode },
    });
    onNavigateToChat();
  }, [activeWorkspace, generatedPrompt, onNavigateToChat, saveWorkspace]);

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

  return {
    generatedPrompt,
    executionResult,
    generating,
    executing,
    copied,
    resetExecutionState,
    setGeneratedPrompt,
    setExecutionResult,
    generatePrompt,
    copyPrompt,
    sendPromptToChat,
    executeWorkspace,
  };
}
