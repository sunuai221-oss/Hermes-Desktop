import axios from 'axios';
import type {
  AgentDefinition,
  AgentWorkspace,
  AgentWorkspaceExecutionResult,
  CronJob,
  HermesConfig,
  ImageAttachment,
  KanbanAssignee,
  KanbanBoard,
  KanbanStats,
  KanbanStatus,
  KanbanTask,
  KanbanTaskDetail,
  Message,
  ModelThinkMode,
  OllamaModel,
  PawrtalCommandResult,
  PawrtalCompanion,
  PawrtalStatusResponse,
  VoiceChatResponse,
  VoiceSynthesisResponse,
  WorkspaceAutoConfigPreviewResult,
} from './types';
import { getActiveProfileName } from './features/chat/chatStorage';

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

type AgencyImportPayload = {
  bundled?: boolean;
  rootPath?: string;
  repoUrl?: string;
  branch?: string;
};

type AgencyImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  agents: AgentDefinition[];
};

type PreferredSkillsUpdate = {
  id: string;
  preferredSkills: string[];
};

type WorkspaceChatPayload = {
  task: string;
  mode?: AgentWorkspace['defaultMode'];
  model?: string;
};

type WorkspaceAutoConfigPayload = {
  pipelineBrief: string;
  model?: string;
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
const diagnosticsHttp = axios.create({ baseURL: BASE, timeout: 240000 });
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 180000;

function attachProfileHeaderInterceptor(client: ReturnType<typeof axios.create>) {
  client.interceptors.request.use((config) => {
    const profile = getActiveProfileName();
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
attachProfileHeaderInterceptor(diagnosticsHttp);

function diagnosticsCommand(path: string, timeoutMs = DEFAULT_DIAGNOSTICS_TIMEOUT_MS) {
  const commandTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.trunc(timeoutMs)
    : DEFAULT_DIAGNOSTICS_TIMEOUT_MS;

  return diagnosticsHttp.post(
    path,
    { timeoutMs: commandTimeoutMs },
    {
      timeout: Math.max(commandTimeoutMs + 15000, 60000),
      validateStatus: () => true,
    },
  );
}

export const profiles = {
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
  diagnosticsDoctor: (timeoutMs?: number) => diagnosticsCommand('/api/gateway/diagnostics/doctor', timeoutMs),
  diagnosticsDump: (timeoutMs?: number) => diagnosticsCommand('/api/gateway/diagnostics/dump', timeoutMs),
  diagnosticsBackup: (timeoutMs?: number) => diagnosticsCommand('/api/gateway/diagnostics/backup', timeoutMs),
  start: (port?: number, profileName?: string) => http.post('/api/gateway/start', { port }, withProfileHeader(profileName)),
  stop: (profileName?: string) => http.post('/api/gateway/stop', {}, withProfileHeader(profileName)),
  chat: (body: ChatRequestBody) => http.post('/api/gateway/chat', body),
  streamChat: (body: ChatRequestBody) => {
    const profile = getActiveProfileName();
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

export const agentStudio = {
  library: () => http.get<{ schemaVersion: number; agents: AgentDefinition[] }>('/api/agent-studio/library'),
  importAgency: (payload: AgencyImportPayload) =>
    http.post<AgencyImportResult>('/api/agent-studio/library/import-agency', payload),
  createAgent: (agent: Partial<AgentDefinition>) =>
    http.post<{ success: true; agent: AgentDefinition }>('/api/agent-studio/library', agent),
  updateAgent: (id: string, patch: Partial<AgentDefinition>) =>
    http.patch<{ success: true; agent: AgentDefinition }>(`/api/agent-studio/library/${encodeURIComponent(id)}`, patch),
  updatePreferredSkills: (updates: PreferredSkillsUpdate[]) =>
    http.post<{ success: true; updated: number; skipped: number; agents: AgentDefinition[] }>(
      '/api/agent-studio/library/preferred-skills',
      { updates },
    ),
  deleteAgent: (id: string) =>
    http.delete<{ success: true }>(`/api/agent-studio/library/${encodeURIComponent(id)}`),
  applyAgent: (id: string) =>
    http.post<{
      success: true;
      applied: { id: string; name: string; wroteSoul: boolean; updatedConfig: boolean; profile?: string };
    }>(`/api/agent-studio/library/${encodeURIComponent(id)}/apply`),

  workspaces: () => http.get<{ schemaVersion: number; workspaces: AgentWorkspace[] }>('/api/agent-studio/workspaces'),
  createWorkspace: (workspace: Partial<AgentWorkspace>) =>
    http.post<{ success: true; workspace: AgentWorkspace }>('/api/agent-studio/workspaces', workspace),
  updateWorkspace: (id: string, patch: Partial<AgentWorkspace>) =>
    http.patch<{ success: true; workspace: AgentWorkspace }>(`/api/agent-studio/workspaces/${encodeURIComponent(id)}`, patch),
  deleteWorkspace: (id: string) =>
    http.delete<{ success: true }>(`/api/agent-studio/workspaces/${encodeURIComponent(id)}`),
  generatePrompt: (id: string) =>
    http.post<{ prompt: string }>(`/api/agent-studio/workspaces/${encodeURIComponent(id)}/generate-prompt`),
  executeWorkspace: (id: string, mode?: AgentWorkspace['defaultMode']) =>
    scanHttp.post<AgentWorkspaceExecutionResult>(`/api/agent-studio/workspaces/${encodeURIComponent(id)}/execute`, mode ? { mode } : {}),
  chatWorkspace: (id: string, payload: WorkspaceChatPayload) =>
    scanHttp.post<AgentWorkspaceExecutionResult>(`/api/agent-studio/workspaces/${encodeURIComponent(id)}/chat`, payload),
  autoConfigWorkspace: (id: string, payload: WorkspaceAutoConfigPayload) =>
    scanHttp.post<WorkspaceAutoConfigPreviewResult>(`/api/agent-studio/workspaces/${encodeURIComponent(id)}/auto-config`, payload),
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

export const pawrtal = {
  list: () => http.get<PawrtalCommandResult & { companions: PawrtalCompanion[] }>('/api/pawrtal/list'),
  status: (session = 'current') => http.get<PawrtalStatusResponse>('/api/pawrtal/status', { params: { session } }),
  use: (payload: { petId: string; session?: string }) => http.post<PawrtalCommandResult>('/api/pawrtal/use', payload),
  spawn: (payload: { petId?: string | null; session?: string }) => http.post<PawrtalCommandResult>('/api/pawrtal/spawn', payload),
  vanish: (payload: { petId?: string | null; session?: string }) => http.post<PawrtalCommandResult>('/api/pawrtal/vanish', payload),
  switch: (payload: { petId: string; session?: string }) => http.post<PawrtalCommandResult>('/api/pawrtal/switch', payload),
  reset: (payload: { petId?: string | null; session?: string }) => http.post<PawrtalCommandResult>('/api/pawrtal/reset', payload),
  autostart: (payload: { petId?: string | null; session?: string; resetBeforeSpawn?: boolean }) =>
    http.post<PawrtalCommandResult>('/api/pawrtal/autostart', payload),
};

export const live2d = {
  listModels: () => http.get<{ userModels: Array<{ id: string; label: string; description: string; modelUrl: string; modelVersion: string; isUserModel: boolean }> }>('/api/live2d/models'),
};

export const cronjobs = {
  list: () => http.get('/api/cronjobs'),
  create: (data: Partial<CronJob>) => http.post('/api/cronjobs', data),
  update: (id: string, data: Partial<CronJob>) => http.patch(`/api/cronjobs/${encodeURIComponent(id)}`, data),
  action: (id: string, action: 'pause' | 'resume' | 'run' | 'remove') =>
    http.post(`/api/cronjobs/${encodeURIComponent(id)}/${action}`),
  outputs: (id?: string) => http.get('/api/cronjobs/outputs', { params: id ? { jobId: id } : {} }),
};

export const kanban = {
  boards: () => scanHttp.get<KanbanBoard[]>('/api/kanban/boards'),
  createBoard: (payload: { slug: string; name?: string; description?: string; icon?: string; color?: string; switch?: boolean }) =>
    http.post<KanbanBoard[]>('/api/kanban/boards', payload),
  switchBoard: (slug: string) => http.post<KanbanBoard[]>(`/api/kanban/boards/${encodeURIComponent(slug)}/switch`),
  tasks: (params?: { board?: string; status?: string; assignee?: string; tenant?: string; archived?: boolean }) =>
    scanHttp.get<KanbanTask[]>('/api/kanban/tasks', { params }),
  task: (id: string, board?: string) =>
    http.get<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}`, { params: board ? { board } : {} }),
  createTask: (payload: {
    board?: string;
    title: string;
    body?: string;
    assignee?: string;
    tenant?: string;
    priority?: number | string;
    workspace?: string;
    triage?: boolean;
    parents?: string[];
    skills?: string[];
    maxRuntime?: string;
    maxRetries?: number | string;
  }) => http.post<KanbanTask>('/api/kanban/tasks', payload),
  assign: (id: string, payload: { board?: string; assignee?: string }) =>
    http.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/assign`, payload),
  setStatus: (id: string, payload: { board?: string; status: KanbanStatus; reason?: string; result?: string; summary?: string; metadata?: Record<string, unknown> }) =>
    scanHttp.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/status`, payload),
  comment: (id: string, payload: { board?: string; text: string; author?: string }) =>
    http.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/comment`, payload),
  complete: (id: string, payload: { board?: string; result?: string; summary?: string; metadata?: Record<string, unknown> }) =>
    http.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/complete`, payload),
  block: (id: string, payload: { board?: string; reason?: string }) =>
    http.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/block`, payload),
  unblock: (id: string, payload: { board?: string }) =>
    http.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/unblock`, payload),
  archive: (id: string, payload: { board?: string }) =>
    http.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/archive`, payload),
  reclaim: (id: string, payload: { board?: string; reason?: string }) =>
    http.post<KanbanTaskDetail>(`/api/kanban/tasks/${encodeURIComponent(id)}/reclaim`, payload),
  stats: (board?: string) => scanHttp.get<KanbanStats>('/api/kanban/stats', { params: board ? { board } : {} }),
  assignees: (board?: string) => scanHttp.get<KanbanAssignee[]>('/api/kanban/assignees', { params: board ? { board } : {} }),
  log: (id: string, board?: string, tail = 12000) =>
    scanHttp.get<{ taskId: string; content: string }>(`/api/kanban/tasks/${encodeURIComponent(id)}/log`, { params: { board, tail } }),
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
  setEnabled: (filePath: string, enabled: boolean) => http.patch('/api/skills/enabled', { path: filePath, enabled }),
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
    const profile = getActiveProfileName();
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
