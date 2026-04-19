const MODEL_CATALOG_TIMEOUT_MS = 3000;

export function normalizeChatProvider(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return 'profile-default';
  if (value === 'codex-openai' || value === 'openai-codex' || value === 'codex' || value === 'openai') return 'codex-openai';
  if (value === 'custom') return 'custom';
  if (value === 'ollama') return 'ollama';
  if (value === 'nous' || value === 'nous-research' || value === 'nousresearch') return 'nous';
  return 'profile-default';
}

export function createProviderCatalogService({
  axios,
  ollamaBaseUrl,
  timeoutMs = MODEL_CATALOG_TIMEOUT_MS,
}) {
  async function fetchProviderModels(input) {
    normalizeChatProvider(input);
    const response = await axios.get(`${ollamaBaseUrl}/api/tags`, { timeout: timeoutMs });
    return response.data;
  }

  return {
    fetchProviderModels,
  };
}
