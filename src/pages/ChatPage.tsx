import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import * as api from '../api';
import { useProfiles } from '../contexts/ProfileContext';
import { useRuntimeStatus } from '../hooks/useRuntimeStatus';
import { useGatewayContext } from '../contexts/GatewayContext';
import { useChat } from '../hooks/useChat';
import { Card } from '../components/Card';
import { ChatToolbar } from '../components/chat/ChatToolbar';
import { ChatMessages } from '../components/chat/ChatMessages';
import { ChatInput } from '../components/chat/ChatInput';
import {
  CHAT_SHOW_THINKING_KEY,
  CHAT_SHOW_TOOLS_KEY,
  readChatPreference,
  writeChatPreference,
} from '../features/chat/chatStorage';
import type { AgentWorkspace } from '../types';

interface Props {
  requestedSessionId?: string | null;
  requestNonce?: number;
}

export function ChatPage({ requestedSessionId = null, requestNonce = 0 }: Props) {
  const gateway = useGatewayContext();
  const { currentProfile } = useProfiles();
  const { status: chatRuntimeStatus } = useRuntimeStatus(gateway);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [showThinking, setShowThinking] = useState(() => readChatPreference(CHAT_SHOW_THINKING_KEY, true));
  const [showTools, setShowTools] = useState(() => readChatPreference(CHAT_SHOW_TOOLS_KEY, false));
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [importingWorkspace, setImportingWorkspace] = useState(false);
  const [workspaceImportError, setWorkspaceImportError] = useState('');

  const chat = useChat({
    requestedSessionId,
    requestNonce,
    audioRef,
  });

  useEffect(() => {
    writeChatPreference(CHAT_SHOW_THINKING_KEY, showThinking);
  }, [showThinking]);

  useEffect(() => {
    writeChatPreference(CHAT_SHOW_TOOLS_KEY, showTools);
  }, [showTools]);

  useEffect(() => {
    let cancelled = false;
    api.agentStudio.workspaces()
      .then(response => {
        if (cancelled) return;
        const nextWorkspaces = Array.isArray(response.data.workspaces) ? response.data.workspaces : [];
        setWorkspaces(nextWorkspaces);
        setSelectedWorkspaceId(current => current || nextWorkspaces[0]?.id || '');
      })
      .catch(() => {
        if (!cancelled) setWorkspaceImportError('Could not load workspaces.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const importWorkspace = async () => {
    if (!selectedWorkspaceId || importingWorkspace) return;
    setImportingWorkspace(true);
    setWorkspaceImportError('');
    try {
      const response = await api.agentStudio.generatePrompt(selectedWorkspaceId);
      chat.setInput(`${response.data.prompt}\n\n## Task\n`);
    } catch {
      setWorkspaceImportError('Could not import workspace.');
    } finally {
      setImportingWorkspace(false);
    }
  };

  return (
    <motion.div
      key="chat"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full min-h-0 w-full flex flex-col"
    >
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatToolbar
          currentProfile={currentProfile}
          runtimeStatus={chatRuntimeStatus}
          runtimeProviderLabel={chat.runtimeProviderLabel}
          preferredModel={chat.preferredModel}
          usage={chat.usage}
          currentSessionLabel={chat.currentSessionLabel}
          showThinking={showThinking}
          showTools={showTools}
          onToggleThinking={() => setShowThinking(value => !value)}
          onToggleTools={() => setShowTools(value => !value)}
          voiceMode={chat.voiceMode}
          onVoiceModeToggle={() => chat.setVoiceMode(v => !v)}
          hasMessages={chat.messages.length > 0 || !!chat.activeSessionId}
          onNewChat={chat.handleNewChat}
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          importingWorkspace={importingWorkspace}
          workspaceImportError={workspaceImportError}
          onWorkspaceChange={setSelectedWorkspaceId}
          onImportWorkspace={importWorkspace}
        />

        <Card className="flex-1 flex flex-col p-0 overflow-hidden min-h-[60vh]">
          <ChatMessages
            messages={chat.messages}
            streaming={chat.streaming}
            sessionId={chat.activeSessionId}
            showThinking={showThinking}
            showTools={showTools}
            speakingMessageIndex={chat.speakingMessageIndex}
            onSpeakMessage={chat.speakMessageAt}
            onMessageAudioEnded={chat.handleMessageAudioEnded}
          />

          <ChatInput
            input={chat.input}
            onInputChange={chat.setInput}
            onSend={chat.send}
            onPaste={chat.handlePaste}
            streaming={chat.streaming}
            chatCommands={chat.chatCommands}
            attachments={chat.attachments}
            newAttachmentKind={chat.newAttachmentKind}
            newAttachmentValue={chat.newAttachmentValue}
            canAddReference={chat.canAddReference}
            onKindChange={chat.setNewAttachmentKind}
            onValueChange={chat.setNewAttachmentValue}
            onAddAttachment={chat.addAttachment}
            onRemoveAttachment={chat.removeAttachment}
            contextStatusLabel={chat.contextStatusLabel}
            contextTokensEstimate={chat.contextTokensEstimate}
            contextWindowTokens={chat.contextWindowTokens}
            contextUsagePercent={chat.contextUsagePercent}
            imageAttachments={chat.imageAttachments}
            uploadingImages={chat.uploadingImages}
            imageError={chat.imageError}
            onRemoveImage={chat.removeImage}
            onFileSelect={chat.handleFileSelection}
            fileInputRef={fileInputRef}
            voiceState={chat.voiceState}
            voiceError={chat.voiceError}
            voiceSupported={chat.voiceSupported}
            voiceStatusLabel={chat.voiceStatusLabel}
            onVoiceToggle={chat.handleVoiceToggle}
          />
        </Card>
      </div>

      <audio ref={audioRef} className="hidden" />
    </motion.div>
  );
}
