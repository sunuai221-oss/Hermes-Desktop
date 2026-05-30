export type { NavItem } from './hooks/useNavigation';
export type ConnectionStatus = 'online' | 'offline' | 'connecting' | 'direct' | 'degraded';

export interface PlatformState {
  state: 'connected' | 'disconnected' | 'fatal';
  error_code: string | null;
  error_message: string | null;
  updated_at: string;
}

export interface GatewayState {
  pid: number;
  kind: string;
  gateway_state: 'starting' | 'running' | 'stopped';
  exit_reason: string | null;
  platforms: Record<string, PlatformState>;
  start_time?: string;
  updated_at: string;
}

export interface GatewayProcessStatus {
  status: 'online' | 'degraded' | 'offline';
  port?: number | null;
  pid?: number;
  gateway_state?: 'starting' | 'running' | 'stopped';
  managed?: boolean;
  status_source?: 'managed-profile' | 'shared-global' | 'offline';
  gateway_url?: string;
  home?: string;
  workspace_root?: string;
}

export interface ProfileMetadata {
  name: string;
  isDefault: boolean;
  model: string;
  port?: number;
  status: 'online' | 'offline';
  managed?: boolean;
  status_source?: 'managed-profile' | 'shared-global' | 'offline';
  home?: string;
}

export interface GatewayHook {
  builderStatus: ConnectionStatus;
  runtimeStatus: ConnectionStatus;
  gatewayHealth: ConnectionStatus;
  gatewayProcessStatus: GatewayProcessStatus | null;
  lastCheckedAt: string | null;
  refreshRuntime: () => Promise<void>;
  startGateway: (profileName?: string, port?: number) => Promise<void>;
  stopGateway: (profileName?: string) => Promise<void>;
  state: GatewayState | null;
  health: ConnectionStatus;
  directGatewayHealth: ConnectionStatus;
  directGatewayUrl: string;
  processStatus: GatewayProcessStatus | null;
  ollamaStatus: ConnectionStatus;
  models: OllamaModel[];
  config: HermesConfig | null;
  sessions: Record<string, SessionEntry>;
  skills: SkillInfo[];
  hooks: HookInfo[];
  isLoadingMeta: boolean;
}

export interface MemoryStore {
  target: 'memory' | 'user';
  path: string;
  content: string;
  charLimit: number;
  charCount: number;
  usagePercent: number;
}

export interface MemorySearchResult {
  sessionId: string;
  path: string;
  platform: string;
  role: string;
  snippet: string;
  timestamp?: number | string;
}

export interface ContextFileInfo {
  path: string;
  kind: 'soul' | 'startup' | 'nested' | 'cursor-module';
  name: string;
  priority?: number;
  selectedAtStartup?: boolean;
  content: string;
  charCount: number;
  truncated: boolean;
  discoveredProgressively?: boolean;
}

export interface ContextFilesResponse {
  workspaceRoot: string;
  startupWinner: string | null;
  startupCandidates: ContextFileInfo[];
  nestedCandidates: ContextFileInfo[];
  cursorModules: ContextFileInfo[];
  soul: ContextFileInfo | null;
}

export interface ContextReferenceAttachment {
  id: string;
  kind: 'file' | 'folder' | 'diff' | 'staged' | 'git' | 'url' | 'document';
  value: string;
}

export interface ResolvedContextReference {
  ref: string;
  kind: ContextReferenceAttachment['kind'];
  label: string;
  content: string;
  warning?: string;
  charCount: number;
  meta?: Record<string, unknown>;
  cached?: boolean;
}

export interface PluginInfo {
  name: string;
  version?: string;
  description?: string;
  path: string;
  source: 'user' | 'project';
  enabled: boolean;
  requiresEnv?: string[];
  hasInitPy: boolean;
  hasSchemasPy: boolean;
  hasToolsPy: boolean;
}

export interface PawrtalCompanion {
  id: string;
  displayName: string;
  description?: string;
  packDir?: string;
}

export interface PawrtalStatusState {
  target?: string;
  session?: string;
  activePetId?: string;
  displayName?: string;
  packDir?: string;
  manifestPath?: string;
  spritesheetPath?: string;
  [key: string]: unknown;
}

export interface PawrtalDesktopState {
  target?: string;
  session?: string;
  activePetId?: string;
  pid?: number;
  startedAt?: string;
  running?: boolean;
  [key: string]: unknown;
}

export interface PawrtalStatusResponse {
  ok: boolean;
  session?: string;
  active?: PawrtalStatusState | null;
  desktop?: PawrtalDesktopState | null;
  relay?: Record<string, unknown> | null;
  activity?: Record<string, unknown> | null;
  stateDir?: string;
  errorCode?: string;
  httpStatus?: number;
  error?: string;
  details?: string;
}

export interface PawrtalCommandResult {
  ok: boolean;
  command?: string;
  stdout?: string;
  stderr?: string;
  code?: number | null;
  errorCode?: string;
  httpStatus?: number;
  error?: string;
  details?: string;
  session?: string;
  petId?: string | null;
  [key: string]: unknown;
}

export interface CronJob {
  id: string;
  name?: string;
  prompt: string;
  schedule: string;
  repeat?: number | null;
  delivery?: string;
  skills?: string[];
  paused?: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  created_at?: string;
  updated_at?: string;
  force_run?: boolean;
}

export interface CronOutputEntry {
  jobId: string;
  path: string;
  fileName: string;
  modifiedAt: string;
  contentPreview: string;
}

export type KanbanStatus = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done' | 'archived';

export interface KanbanBoard {
  slug: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  created_at?: number | null;
  archived?: boolean;
  db_path?: string;
  is_current?: boolean;
  counts?: Partial<Record<KanbanStatus, number>>;
  total?: number;
}

export interface KanbanTask {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: KanbanStatus;
  priority?: number;
  tenant?: string | null;
  workspace_kind?: string;
  workspace_path?: string | null;
  created_by?: string | null;
  created_at?: number | null;
  started_at?: number | null;
  completed_at?: number | null;
  result?: string | null;
  skills?: string[];
  max_retries?: number | null;
}

export interface KanbanComment {
  author: string;
  body: string;
  created_at: number;
}

export interface KanbanEvent {
  kind: string;
  payload?: unknown;
  created_at: number;
  run_id?: number | null;
}

export interface KanbanRun {
  id: number;
  profile?: string | null;
  step_key?: string | null;
  status?: string | null;
  outcome?: string | null;
  summary?: string | null;
  error?: string | null;
  metadata?: unknown;
  worker_pid?: number | null;
  started_at?: number | null;
  ended_at?: number | null;
}

export interface KanbanTaskDetail {
  task: KanbanTask;
  latest_summary?: string | null;
  parents: string[];
  children: string[];
  comments: KanbanComment[];
  events: KanbanEvent[];
  runs: KanbanRun[];
}

export interface KanbanStats {
  by_status: Partial<Record<KanbanStatus, number>>;
  by_assignee: Record<string, number | Partial<Record<KanbanStatus, number>>>;
  oldest_ready_age_seconds?: number | null;
  now?: number;
}

export interface KanbanAssignee {
  name: string;
  on_disk?: boolean;
  counts?: Partial<Record<KanbanStatus, number>>;
}

export type ModelThinkMode = boolean | 'low' | 'medium' | 'high';

export type OpenPandasAiConnectorMode = 'cli' | 'api';

export interface OpenPandasAiConnectorConfig {
  enabled?: boolean;
  mode?: OpenPandasAiConnectorMode;
  project_path?: string;
  venv_path?: string;
  python_executable?: string;
  cli_module?: string;
  api_base_url?: string;
  request_timeout_ms?: number;
}

export interface OpenPandasAiStatusCheck {
  key: string;
  ok: boolean;
  message: string;
  required?: boolean;
}

export interface OpenPandasAiStatusResponse {
  status: 'ready' | 'disabled' | 'misconfigured';
  mode: OpenPandasAiConnectorMode;
  checks: OpenPandasAiStatusCheck[];
  config: OpenPandasAiConnectorConfig;
  log_path?: string | null;
}

export interface OpenPandasAiRunLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | string;
  message: string;
}

export interface OpenPandasAiRunResponse {
  runId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked';
  engineStatus: string;
  mode: OpenPandasAiConnectorMode;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  question: string;
  dataset: {
    fileName: string;
    extension: string;
    bytes: number;
  };
  logPath?: string | null;
  document?: {
    fileName: string;
    extension: string;
    bytes: number;
    pageCount?: number;
    charCount?: number;
    warning?: string | null;
  } | null;
  logs: OpenPandasAiRunLogEntry[];
  result?: Record<string, unknown> | null;
  error?: {
    message?: string;
    statusCode?: number;
  } | null;
}

export interface OpenPandasAiLogsResponse {
  path: string;
  updatedAt?: string | null;
  sizeBytes?: number;
  truncated?: boolean;
  lineCount?: number;
  totalLines?: number;
  content?: string;
  note?: string | null;
}

export interface OpenPandasAiRunStartResponse {
  runId: string;
  status: 'queued' | 'running';
  createdAt: string;
}

export interface HermesConfig {
  model?: {
    default?: string;
    provider?: string;
    base_url?: string;
    api_mode?: string;
    think?: ModelThinkMode;
    context_window?: number | string;
  };
  custom_providers?: Array<{ name: string; base_url: string; api_key: string }>;
  skills?: { external_dirs?: string[] };
  memory?: {
    provider?: string;
    memory_enabled?: boolean;
    user_profile_enabled?: boolean;
    memory_char_limit?: number;
    user_char_limit?: number;
  };
  cron?: {
    wrap_response?: boolean;
  };
  delegation?: {
    max_iterations?: number;
    default_toolsets?: string[];
    model?: string;
    provider?: string;
    base_url?: string;
    api_key?: string;
  };
  session_reset?: { mode?: string; at_hour?: number; idle_minutes?: number };
  group_sessions_per_user?: boolean;
  unauthorized_dm_behavior?: string;
  streaming?: { enabled?: boolean; transport?: string; edit_interval?: number; buffer_threshold?: number; cursor?: string };
  display?: { tool_progress?: string; background_process_notifications?: string; live2d_enabled?: boolean };
  stt?: { enabled?: boolean };
  tts?: {
    provider?: string;
    neutts_server?: {
      base_url?: string;
      timeout_ms?: number;
    };
    neuttsServer?: {
      baseUrl?: string;
      timeoutMs?: number;
    };
  };
  terminal?: {
    backend?: string;
    cwd?: string;
    timeout?: number;
    docker_image?: string;
    singularity_image?: string;
    container_cpu?: number;
    container_memory?: number;
    container_disk?: number;
    container_persistent?: boolean;
    docker_forward_env?: string[];
  };
  reset_triggers?: string[];
  quick_commands?: Record<string, string>;
  platforms?: Record<string, unknown>;
  pawrtal?: {
    auto_start?: boolean;
    default_pet_id?: string;
    default_session?: string;
    reset_before_spawn?: boolean;
  };
  open_pandas_ai?: OpenPandasAiConnectorConfig;
  [key: string]: unknown;
}

export interface SessionEntry {
  id?: string;
  source?: string;
  user_id?: string;
  model?: string;
  workspace_id?: string | null;
  workspace_name?: string | null;
  parent_session_id?: string | null;
  last_accessed?: number;
  created_at?: number;
  title?: string;
  [key: string]: unknown;
}

export interface SessionStats {
  total_sessions: number;
  total_messages: number;
  database_size_bytes: number;
  by_source?: Array<{
    source?: string | null;
    count: number;
  }>;
  by_workspace?: Array<{
    workspace_id?: string | null;
    workspace_name?: string | null;
    count: number;
  }>;
}

export interface SessionResumeRecapExchange {
  user: string;
  assistant: string;
  tool_calls: string[];
  timestamp?: number | null;
}

export interface SessionResumeRecap {
  mode: 'full';
  hidden_exchanges_count: number;
  exchanges: SessionResumeRecapExchange[];
}

export interface ChatToolCall {
  id?: string;
  type?: string;
  name?: string;
  arguments?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  [key: string]: unknown;
}

export interface ChatUsage {
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  cost?: number | null;
  rateLimitRemaining?: number | null;
  rateLimitReset?: number | string | null;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  audioUrl?: string;
  isVoice?: boolean;
  tokenCount?: number;
  toolCalls?: ChatToolCall[];
  toolCallsBeforeContent?: boolean;
  toolName?: string;
  toolResults?: unknown;
}

export interface ImageAttachment {
  id: string;
  fileName: string;
  mimeType: 'image/png';
  dataUrl: string;
  path: string;
  width?: number;
  height?: number;
}

export interface VoiceSynthesisResponse {
  audioUrl: string;
  fileName: string;
  voice: string;
  text: string;
}

export interface VoiceChatResponse extends VoiceSynthesisResponse {
  transcript: string;
  assistantText: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export interface ProviderModelOption {
  name: string;
  id?: string;
  object?: string;
  owned_by?: string;
}

export interface SkillInfo {
  id?: string;
  name: string;
  description?: string;
  path: string;
  source?: 'local' | 'external';
  rootDir?: string;
  category?: string;
  version?: string;
  platforms?: string[];
  tags?: string[];
  fallbackForToolsets?: string[];
  requiresToolsets?: string[];
  fallbackForTools?: string[];
  requiresTools?: string[];
  enabled?: boolean;
  disabledReason?: string;
  requiredEnvironmentVariables?: Array<{
    name: string;
    prompt?: string;
    help?: string;
    required_for?: string;
  }>;
}
export interface HookInfo {
  name: string;
  description?: string;
  events?: string[];
  path: string;
  source?: 'gateway';
  hasHandler?: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  soul: string;
  personalityOverlay?: string;
  defaultModel?: string;
  preferredSkills?: string[];
  preferredPlatforms?: string[];
  toolPolicy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt?: string;
}

export interface AgentDefinition {
  id: string;
  source: string;
  sourcePath?: string;
  name: string;
  slug: string;
  description?: string;
  division?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
  soul: string;
  workflow?: string;
  deliverables?: string;
  successMetrics?: string;
  preferredSkills?: string[];
  preferredToolsets?: string[];
  defaultModel?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceAgentRole = 'orchestrator' | 'worker' | 'reviewer' | 'qa' | 'observer';
export type WorkspaceEdgeKind = 'handoff' | 'review' | 'qa' | 'broadcast' | 'escalation';

export interface AgentWorkspace {
  id: string;
  name: string;
  description?: string;
  pipelineBrief?: string;
  sharedContext: string;
  commonRules: string;
  defaultMode: 'prompt' | 'delegate' | 'profiles';
  nodes: WorkspaceAgentNode[];
  edges: WorkspaceAgentEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceAgentNode {
  id: string;
  agentId: string;
  role: WorkspaceAgentRole;
  label?: string;
  profileName?: string;
  modelOverride?: string;
  toolsets?: string[];
  skills?: string[];
  position: { x: number; y: number };
}

export interface WorkspaceAgentEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: WorkspaceEdgeKind;
  template?: string;
}

export interface AgentWorkspaceExecutionRun {
  nodeId: string;
  agentId: string;
  label: string;
  role: WorkspaceAgentRole;
  profileName?: string;
  status?: 'completed' | 'failed' | 'blocked';
  prompt?: string;
  inputs?: Partial<Record<WorkspaceEdgeKind, Array<{
    nodeId: string;
    label: string;
    role: WorkspaceAgentRole;
    profileName?: string;
    status?: 'completed' | 'failed' | 'blocked';
    output?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    template?: string;
  }>>>;
  output?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  toolsetOutputs?: Array<{
    toolset: string;
    status: 'completed' | 'failed' | 'skipped';
    summary?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    data?: Record<string, unknown> | null;
  }>;
  response?: unknown;
}

export interface AgentWorkspaceExecutionResult {
  success: boolean;
  mode: AgentWorkspace['defaultMode'];
  status: 'ready' | 'completed' | 'failed' | 'blocked';
  session_id?: string;
  prompt: string;
  output?: string;
  runs?: AgentWorkspaceExecutionRun[];
  workflow?: {
    status: 'completed' | 'failed' | 'blocked';
    startedAt: string;
    finishedAt: string;
    counts: {
      total: number;
      completed: number;
      failed: number;
      blocked: number;
    };
    qaGate: {
      required: boolean;
      status: 'passed' | 'failed' | 'not-applicable';
    };
  };
  response?: unknown;
}

export interface WorkspaceAutoConfigNodePatch {
  nodeId: string;
  role?: WorkspaceAgentRole;
  label?: string;
  profileName?: string;
  modelOverride?: string;
  skills?: string[];
  toolsets?: string[];
}

export interface WorkspaceAutoConfigEdge {
  fromNodeId: string;
  toNodeId: string;
  kind: WorkspaceEdgeKind;
  template?: string;
}

export interface WorkspaceAutoConfigSuggestion {
  summary?: string;
  workspacePatch: Partial<Pick<AgentWorkspace, 'description' | 'pipelineBrief' | 'sharedContext' | 'commonRules' | 'defaultMode'>>;
  nodes: WorkspaceAutoConfigNodePatch[];
  edges: WorkspaceAutoConfigEdge[];
}

export interface WorkspaceAutoConfigPreviewResult {
  success: true;
  workspaceId: string;
  pipelineBrief: string;
  prompt: string;
  suggestion: WorkspaceAutoConfigSuggestion;
  raw: string;
}

export type WorkspaceAutoConfigDiffCategory = 'workspace' | 'mode' | 'node' | 'edge';

export interface WorkspaceAutoConfigDiffItem {
  id: string;
  category: WorkspaceAutoConfigDiffCategory;
  title: string;
  before?: string;
  after?: string;
  detail?: string;
}

export interface WorkspaceAutoConfigPlan {
  patch: Partial<AgentWorkspace> & Pick<AgentWorkspace, 'nodes' | 'edges'>;
  nextWorkspace: AgentWorkspace;
  items: WorkspaceAutoConfigDiffItem[];
  hasChanges: boolean;
}
