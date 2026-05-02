import axios from 'axios';
import type {
  AgentProfile,
  CronJob,
  HermesConfig,
  ImageAttachment,
  Message,
  ModelThinkMode,
  OllamaModel,
  VoiceChatResponse,
  VoiceSynthesisResponse,
} from './types';

type ChatRequestBody = {
  model: string;
  provider?: 'codex-openai' | 'custom' | 'ollama' | 'nous';
  think?: ModelThinkMode;
  messages: Array<{
    role: Message['role'];
    content: string | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;
  }>;
  stream?: boolean;
  session_id?: string;
  source?: string;
  user_id?: string;
  session_title?: string;
};

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const DIRECT_GATEWAY_BASE = (
  import.meta.env.VITE_DIRECT_GATEWAY_URL
  || (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname || '127.0.0.1'}:8642`
    : 'http://127.0.0.1:8642')
).replace(/\/$/, '');
const http = axios.create({ baseURL: BASE, timeout: 5000 });
const voiceHttp = axios.create({ baseURL: BASE, timeout: 180000 });
const scanHttp = axios.create({ baseURL: BASE, timeout: 60000 });

function attachProfileHeaderInterceptor(client: ReturnType<typeof axios.create>) {
  client.interceptors.request.use((config) => {
    const profile = localStorage.getItem('hermes_profile') || 'default';
    config.headers['X-Hermes-Profile'] = profile;
    return config;
  });
}

function withProfileHeader(profileName?: string) {
  if (!profileName) return undefined;
  return {
    headers: {
      'X-Hermes-Profile': profileName,
    },
  };
}

async function probeDirectGateway(baseUrl = DIRECT_GATEWAY_BASE) {
  const normalizedBaseUrl = String(baseUrl || DIRECT_GATEWAY_BASE).replace(/\/$/, '') || DIRECT_GATEWAY_BASE;
  const endpoints = [`${normalizedBaseUrl}/health`, `${normalizedBaseUrl}/v1/health`];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: 'GET' });
      if (!response.ok) continue;
      const data = await response.json().catch(() => null);
      return { status: 'online' as const, endpoint, baseUrl: normalizedBaseUrl, data };
    } catch {
      // Keep probing fallback endpoints.
    }
  }

  return { status: 'offline' as const, endpoint: endpoints[0], baseUrl: normalizedBaseUrl, data: null };
}

// Inject X-Hermes-Profile header from localStorage
attachProfileHeaderInterceptor(http);
attachProfileHeaderInterceptor(voiceHttp);
attachProfileHeaderInterceptor(scanHttp);

export const profiles = {
  list: () => http.get<Array<{ name: string; isDefault: boolean; model: string; port?: number; status: 'online' | 'offline'; managed?: boolean; status_source?: 'managed-profile' | 'shared-global' | 'offline'; home?: string }>>('/api/profiles/metadata'),
  metadata: () => http.get<Array<{ name: string; isDefault: boolean; model: string; port?: number; status: 'online' | 'offline'; managed?: boolean; status_source?: 'managed-profile' | 'shared-global' | 'offline'; home?: string }>>('/api/profiles/metadata'),
  create: (name: string) => http.post('/api/profiles', { name }),
  delete: (name: string) => http.delete(`/api/profiles/${encodeURIComponent(name)}`),
};

export const gateway = {
  directBaseUrl: DIRECT_GATEWAY_BASE,
  directHealth: (baseUrl?: string) => probeDirectGateway(baseUrl),
  backendHealth: () => http.get('/api/desktop/health'),
  health: () => http.get('/api/gateway/health'),
  detailedHealth: () => http.get<{ endpoint: string; data: unknown }>('/api/gateway/health/detailed'),
  state: () => http.get('/api/gateway/state'),
  processStatus: () => http.get<{ status: 'online' | 'offline'; port?: number | null; pid?: number; gateway_state?: 'starting' | 'running' | 'stopped'; managed?: boolean; status_source?: 'managed-profile' | 'shared-global' | 'offline'; gateway_url?: string; home?: string; workspace_root?: string }>('/api/gateway/process-status'),
  diagnostics: () => http.get('/api/gateway/diagnostics'),
  diagnosticsLogs: (lines = 400) => http.get('/api/gateway/diagnostics/logs', { params: { lines } }),
  diagnosticsDoctor: (timeoutMs?: number) => http.post('/api/gateway/diagnostics/doctor', timeoutMs ? { timeoutMs } : {}),
  diagnosticsDump: (timeoutMs?: number) => http.post('/api/gateway/diagnostics/dump', timeoutMs ? { timeoutMs } : {}),
  diagnosticsBackup: (timeoutMs?: number) => http.post('/api/gateway/diagnostics/backup', timeoutMs ? { timeoutMs } : {}),
  start: (port?: number, profileName?: string) => http.post('/api/gateway/start', { port }, withProfileHeader(profileName)),
  stop: (profileName?: string) => http.post('/api/gateway/stop', {}, withProfileHeader(profileName)),
  chat: (body: ChatRequestBody) => http.post('/api/gateway/chat', body),
  streamChat: (body: ChatRequestBody) => {
    const profile = localStorage.getItem('hermes_profile') || 'default';
    return fetch(`${BASE}/api/gateway/chat/stream`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Hermes-Profile': profile
      },
      body: JSON.stringify(body),
    });
  },
};

export const soul = {
  get: () => http.get('/api/soul'),
  save: (content: string) => http.post('/api/soul', { content }),
};

export const agents = {
  list: () => http.get('/api/agents'),
  save: (profiles: AgentProfile[]) => http.post('/api/agents', { profiles }),
  apply: (id: string) => http.post(`/api/agents/${encodeURIComponent(id)}/apply`),
};

export const memory = {
  get: () => http.get('/api/memory'),
  save: (target: 'memory' | 'user', content: string) => http.post('/api/memory', { target, content }),
  search: (query: string) => http.get('/api/memory/search', { params: { q: query } }),
};

export const contextFiles = {
  get: () => scanHttp.get('/api/context-files'),
  save: (filePath: string, content: string) => http.post('/api/context-files', { path: filePath, content }),
};

export const contextReferences = {
  resolve: (refs: string[]) => http.post('/api/context-references/resolve', { refs }),
};

export const plugins = {
  list: () => http.get('/api/plugins'),
};

export const cronjobs = {
  list: () => http.get('/api/cronjobs'),
  create: (data: Partial<CronJob>) => http.post('/api/cronjobs', data),
  update: (id: string, data: Partial<CronJob>) => http.patch(`/api/cronjobs/${encodeURIComponent(id)}`, data),
  action: (id: string, action: 'pause' | 'resume' | 'run' | 'remove') =>
    http.post(`/api/cronjobs/${encodeURIComponent(id)}/${action}`),
  outputs: (id?: string) => http.get('/api/cronjobs/outputs', { params: id ? { jobId: id } : {} }),
};

export const config = {
  get: () => http.get('/api/config'),
  save: (data: HermesConfig) => http.post('/api/config', data),
};

export const sessions = {
  list: () => http.get('/api/sessions'),
  create: (payload?: { id?: string; source?: string; user_id?: string; title?: string; model?: string }) =>
    http.post('/api/sessions', payload || {}),
  resume: (payload: { mode: 'continue' | 'resume'; value?: string; source?: string }) =>
    http.post('/api/sessions/resume', payload),
  delete: (id: string) => http.delete(`/api/sessions/${encodeURIComponent(id)}`),
  rename: (id: string, title: string) =>
    http.post(`/api/sessions/${encodeURIComponent(id)}/rename`, { title }),
  getTitle: (id: string) => http.get(`/api/sessions/${encodeURIComponent(id)}/title`),
  setTitle: (id: string, title: string | null) =>
    http.post(`/api/sessions/${encodeURIComponent(id)}/title`, { title }),
  continue: (id: string, payload?: { source?: string; user_id?: string; model?: string; title?: string }) =>
    http.post(`/api/sessions/${encodeURIComponent(id)}/continue`, payload || {}),
  appendMessages: (id: string, payload: {
    messages: Array<{
      role: string;
      content: string;
      timestamp?: number;
      token_count?: number;
      tool_calls?: unknown;
      tool_name?: string;
      tool_results?: unknown;
    }>;
    model?: string;
    source?: string;
    user_id?: string;
  }) => http.post(`/api/sessions/${encodeURIComponent(id)}/messages`, payload),
  transcript: (id: string) => http.get(`/api/sessions/${encodeURIComponent(id)}/transcript`),
  stats: () => http.get('/api/sessions/stats'),
  prune: (payload?: { older_than_days?: number; source?: string }) => http.post('/api/sessions/prune', payload || {}),
  export: (payload?: { source?: string; session_id?: string; output_path?: string }) => http.post('/api/sessions/export', payload || {}),
};

export const models = {
  list: () => http.get<{ models: OllamaModel[] }>('/api/models'),
};

export const skills = {
  list: () => scanHttp.get('/api/skills'),
  create: (payload: { name: string; description?: string; category?: string }) => http.post('/api/skills', payload),
  getContent: (filePath: string) => http.get('/api/skills/content', { params: { path: filePath } }),
  save: (filePath: string, content: string) => http.put('/api/skills', { path: filePath, content }),
  delete: (filePath: string) => http.delete('/api/skills', { data: { path: filePath } }),
};

export const hooks = {
  list: () => http.get('/api/hooks'),
};

export const images = {
  upload: (fileName: string, dataUrl: string) =>
    http.post<ImageAttachment>('/api/images', { fileName, dataUrl }),
};

export const voice = {
  respond: (body: {
    model: string;
    think?: ModelThinkMode;
    messages: ChatRequestBody['messages'];
    audioDataUrl: string;
    contextText?: string;
    images?: ImageAttachment[];
  }) => voiceHttp.post<VoiceChatResponse>('/api/voice/respond', body),
  synthesize: (text: string) =>
    voiceHttp.post<VoiceSynthesisResponse>('/api/voice/synthesize', { text }),
  streamSynthesize: (text: string, options?: { signal?: AbortSignal }) => {
    const profile = localStorage.getItem('hermes_profile') || 'default';
    return fetch(`${BASE}/api/voice/synthesize/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hermes-Profile': profile,
      },
      signal: options?.signal,
      body: JSON.stringify({ text }),
    });
  },
  deleteAudio: (fileName: string) =>
    voiceHttp.delete(`/api/voice/audio/${encodeURIComponent(fileName)}`),
};
