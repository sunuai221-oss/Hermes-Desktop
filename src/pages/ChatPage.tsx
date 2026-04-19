import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useProfiles } from '../contexts/ProfileContext';
import { useRuntimeStatus } from '../hooks/useRuntimeStatus';
import { useGatewayContext } from '../contexts/GatewayContext';
import { useChat } from '../hooks/useChat';
import { Card } from '../components/Card';
import { ChatToolbar } from '../components/chat/ChatToolbar';
import { ChatMessages } from '../components/chat/ChatMessages';
import { ChatInput } from '../components/chat/ChatInput';

interface Props {
  requestedSessionId?: string | null;
  requestNonce?: number;
}

export function ChatPage({ requestedSessionId = null, requestNonce = 0 }: Props) {
  const gateway = useGatewayContext();
  const { currentProfile, gatewayStatus } = useProfiles();
  const { status: chatRuntimeStatus } = useRuntimeStatus(gateway, gatewayStatus.status);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const chat = useChat({ requestedSessionId, requestNonce, audioRef });

  return (
    <motion.div
      key="chat"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full min-h-0 w-full flex flex-col"
    >
      <div className="flex-1 min-h-0">
        <div className="min-h-0 flex flex-col">
          <ChatToolbar
            currentProfile={currentProfile}
            runtimeStatus={chatRuntimeStatus}
            runtimeProviderLabel={chat.runtimeProviderLabel}
            preferredModel={chat.preferredModel}
            currentSessionLabel={chat.currentSessionLabel}
            voiceMode={chat.voiceMode}
            onVoiceModeToggle={() => chat.setVoiceMode(v => !v)}
            hasMessages={chat.messages.length > 0 || !!chat.activeSessionId}
            onNewChat={chat.handleNewChat}
          />

          <Card className="flex-1 flex flex-col p-0 overflow-hidden min-h-[60vh]">
            <ChatMessages
              messages={chat.messages}
              streaming={chat.streaming}
              sessionId={chat.activeSessionId}
            />

            <ChatInput
              input={chat.input}
              onInputChange={chat.setInput}
              onSend={chat.send}
              onPaste={chat.handlePaste}
              streaming={chat.streaming}
              attachments={chat.attachments}
              newAttachmentKind={chat.newAttachmentKind}
              newAttachmentValue={chat.newAttachmentValue}
              canAddReference={chat.canAddReference}
              onKindChange={chat.setNewAttachmentKind}
              onValueChange={chat.setNewAttachmentValue}
              onAddAttachment={chat.addAttachment}
              onRemoveAttachment={chat.removeAttachment}
              contextStatusLabel={chat.contextStatusLabel}
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
      </div>

      <audio ref={audioRef} className="hidden" />
    </motion.div>
  );
}
