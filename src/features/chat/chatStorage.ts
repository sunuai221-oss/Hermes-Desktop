import type { Message } from '../../types';

// preference: active runtime profile selected by the shell.
export const ACTIVE_PROFILE_KEY = 'hermes_profile';

// preference: chat display toggles.
export const CHAT_SHOW_THINKING_KEY = 'hermes_chat_show_thinking';
export const CHAT_SHOW_TOOLS_KEY = 'hermes_chat_show_tools';

// session: active chat session per profile.
const ACTIVE_CHAT_SESSION_KEY_PREFIX = 'hermes_active_chat_session:';

// cache: best-effort transcript snapshot per profile/session.
const ACTIVE_CHAT_MESSAGES_KEY_PREFIX = 'hermes_active_chat_messages:';

// transient: structured chat draft bridge between feature surfaces and chat.
export const CHAT_DRAFT_PAYLOAD_KEY = 'hermes-chat-draft-payload';

// transient legacy: kept in sync while old draft producers migrate.
export const LEGACY_CHAT_DRAFT_KEY = 'hermes-chat-draft';
export const LEGACY_CHAT_DRAFT_TS_KEY = 'hermes-chat-draft-ts';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getActiveProfileName(): string {
  if (!canUseStorage()) return 'default';
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY) || 'default';
}

export function getChatSessionStorageKey(profile: string): string {
  return `${ACTIVE_CHAT_SESSION_KEY_PREFIX}${profile}`;
}

export function getChatMessagesStorageKey(profile: string, sessionId: string): string {
  return `${ACTIVE_CHAT_MESSAGES_KEY_PREFIX}${profile}:${sessionId}`;
}

export function readStorageItem(key: string): string | null {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(key);
}

export function writeStorageItem(key: string, value: string): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, value);
}

export function removeStorageItem(key: string): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(key);
}

export function readChatPreference(key: string, defaultValue: boolean): boolean {
  const raw = readStorageItem(key);
  if (raw == null) return defaultValue;
  return raw === '1';
}

export function writeChatPreference(key: string, enabled: boolean): void {
  writeStorageItem(key, enabled ? '1' : '0');
}

export function persistChatMessages(key: string, messages: Message[]): void {
  try {
    writeStorageItem(key, JSON.stringify(messages));
  } catch {
    // Best-effort cache only.
  }
}
