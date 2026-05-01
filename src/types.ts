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
  status: 'online' | 'offline';
  port?: number | null;
  pid?: number;
  gateway_state?: 'starting' | 'running' | 'stopped';
  managed?: boolean;
  status_source?: 'managed-profile' | 'shared-global' | 'offline';
  gateway_url?: string;
  home?: string;
  workspace_root?: string;
}

export interface GatewayHook {
  builderStatus: ConnectionStatus;
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
  kind: 'file' | 'folder' | 'diff' | 'staged' | 'git' | 'url';
  value: string;
}

export interface ResolvedContextReference {
  ref: string;
  kind: ContextReferenceAttachment['kind'];
  label: string;
  content: string;
  warning?: string;
  charCount: number;
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

export type ModelThinkMode = boolean | 'low' | 'medium' | 'high';

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
  display?: { tool_progress?: string; background_process_notifications?: string };
  stt?: { enabled?: boolean };
  tts?: {
    mode?: 'kokoro' | string;
    provider?: 'kokoro' | string;
    kokoro?: {
      runtime?: {
        base_url?: string;
        model?: string;
        speed?: number;
        response_format?: 'wav' | 'mp3' | 'opus' | 'flac' | 'pcm' | string;
        lang_code?: string;
        normalize?: boolean;
        volume_multiplier?: number;
      };
      preprocess?: {
        enabled?: boolean;
        mode?: string;
        normalize_whitespace?: boolean;
        restore_basic_punctuation?: boolean;
        split_flat_long_sentences?: boolean;
        preserve_meaning?: boolean;
      };
      routing?: {
        enabled?: boolean;
        strategy?: string;
        detect_language?: string;
        voice_fr?: string;
        voice_en?: string;
        fallback_voice?: string;
        uncertain_language_policy?: string;
      };
      concatenation?: {
        enabled?: boolean;
        gap_ms?: number;
        trim_segment_edges?: boolean;
        skip_concat_when_single_segment?: boolean;
      };
      // Legacy aliases still read by the backend.
      base_url?: string;
      model?: string;
      voice?: string;
      speed?: number;
      response_format?: 'wav' | 'mp3' | 'opus' | 'flac' | 'pcm' | string;
      auto_language?: boolean;
      lang_code?: string;
      voice_en?: string;
      voice_fr?: string;
      voice_multilingual?: string;
      normalize?: boolean;
      volume_multiplier?: number;
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
  [key: string]: unknown;
}

export interface SessionEntry {
  id?: string;
  source?: string;
  user_id?: string;
  model?: string;
  last_accessed?: number;
  created_at?: number;
  title?: string;
  [key: string]: unknown;
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
