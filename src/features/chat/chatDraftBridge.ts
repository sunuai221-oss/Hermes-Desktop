import {
  CHAT_DRAFT_PAYLOAD_KEY,
  LEGACY_CHAT_DRAFT_KEY,
  LEGACY_CHAT_DRAFT_TS_KEY,
  readStorageItem,
  removeStorageItem,
  writeStorageItem,
} from './chatStorage';

type ChatDraftPayload = {
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

type StoredChatDraft = {
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

function parseStoredDraft(raw: string | null): StoredChatDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredChatDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearDraftStorage() {
  removeStorageItem(CHAT_DRAFT_PAYLOAD_KEY);
  removeStorageItem(LEGACY_CHAT_DRAFT_KEY);
  removeStorageItem(LEGACY_CHAT_DRAFT_TS_KEY);
}

export function setDraft(payload: ChatDraftPayload) {
  const text = String(payload.text || '').trim();
  if (!text) {
    clearDraftStorage();
    return;
  }

  const stored: StoredChatDraft = {
    text,
    source: payload.source,
    metadata: payload.metadata,
    createdAt: payload.createdAt || new Date().toISOString(),
  };

  writeStorageItem(CHAT_DRAFT_PAYLOAD_KEY, JSON.stringify(stored));
  // Keep legacy keys in sync for backward compatibility during migration.
  writeStorageItem(LEGACY_CHAT_DRAFT_KEY, text);
  writeStorageItem(LEGACY_CHAT_DRAFT_TS_KEY, String(Date.now()));
}

export function consumeDraft(): StoredChatDraft | null {
  const structured = parseStoredDraft(readStorageItem(CHAT_DRAFT_PAYLOAD_KEY));
  if (structured) {
    clearDraftStorage();
    return structured;
  }

  const legacy = readStorageItem(LEGACY_CHAT_DRAFT_KEY);
  if (!legacy || !legacy.trim()) {
    clearDraftStorage();
    return null;
  }

  const fallback: StoredChatDraft = {
    text: legacy,
    source: 'legacy-localStorage',
    createdAt: new Date().toISOString(),
  };
  clearDraftStorage();
  return fallback;
}
