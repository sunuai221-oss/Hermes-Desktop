export type ChatProvider = 'codex-openai' | 'custom' | 'ollama' | 'nous';
export type RuntimeProvider = ChatProvider | 'profile-default';

function isOllamaBaseUrl(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('127.0.0.1:11434') || normalized.includes('localhost:11434');
}

function isLlamaCppBaseUrl(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('127.0.0.1:8081') || normalized.includes('localhost:8081');
}

function normalizeRuntimeValue(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function getRuntimeProviderKey(config: { model?: { provider?: string; base_url?: string } } | null): RuntimeProvider {
  const provider = normalizeRuntimeValue(config?.model?.provider);
  const baseUrl = String(config?.model?.base_url || '').trim();
  if (provider === 'ollama' || ((provider === 'custom' || !provider) && isOllamaBaseUrl(baseUrl))) return 'ollama';
  if (provider === 'custom' || (!provider && !!baseUrl)) return 'custom';
  if (provider === 'codex-openai' || provider === 'openai-codex' || provider === 'openai' || provider === 'codex') return 'codex-openai';
  if (provider === 'nous' || provider === 'nous-research' || provider === 'nousresearch') return 'nous';
  return 'profile-default';
}

export function getRuntimeProviderLabel(config: { model?: { provider?: string; base_url?: string } } | null): string {
  const key = getRuntimeProviderKey(config);
  const provider = normalizeRuntimeValue(config?.model?.provider);
  const baseUrl = String(config?.model?.base_url || '').trim();
  if (key === 'ollama') return 'Ollama';
  if (key === 'custom') return isLlamaCppBaseUrl(baseUrl) ? 'llama.cpp' : 'Custom API';
  if (key === 'codex-openai') return 'OpenAI / Codex';
  if (key === 'profile-default') return provider || 'Profile default';
  return 'Nous Research';
}
