const DEFAULT_TIMEOUT_MS = 240000;
const DEFAULT_STATUS_TIMEOUT_MS = 5000;
const DEFAULT_MAX_DATASET_BYTES = 35 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OPTIONS_BYTES = 1 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_QUESTION_CHARS = 20000;
const DEFAULT_MEMORY_LIMIT_MB = 2048;
const DEFAULT_MAX_LOG_ENTRIES = 400;
const DEFAULT_MAX_RUNS_PER_PROFILE = 80;
const DEFAULT_CLI_MODULE = 'core.headless.cli';
const DEFAULT_MODE = 'cli';
const DEFAULT_DOCUMENT_CONTEXT_MAX_CHARS = 16000;
const RUN_LOG_PREVIEW_CHARS = 2000;
const OPEN_PANDAS_LOG_FILENAME = 'open-pandas-ai.log';
const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.git-credentials',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'authorized_keys',
  'known_hosts',
  'credentials',
  'config',
]);
const SENSITIVE_PATH_PARTS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  '.azure',
  '.config/gcloud',
  '.docker',
  '.secrets',
  'secret',
  'secrets',
  'token',
  'tokens',
];
const SECRET_REDACTION_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(ghp_[A-Za-z0-9]{20,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(ASIA[0-9A-Z]{16})\b/g,
  /\b(AIza[0-9A-Za-z-_]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._=-]{16,})\b/gi,
];

const SUPPORTED_DATASET_EXTENSIONS = new Set([
  '.csv',
  '.tsv',
  '.txt',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.json',
  '.parquet',
]);

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.txt',
  '.md',
  '.markdown',
  '.jpg',
  '.jpeg',
  '.png',
  '.tif',
  '.tiff',
  '.bmp',
  '.webp',
]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMode(value) {
  return String(value || DEFAULT_MODE).trim().toLowerCase() === 'api'
    ? 'api'
    : 'cli';
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const quoted = text.match(/^(['"])(.*)\1$/);
  if (quoted) {
    const unwrapped = String(quoted[2] || '').trim();
    return unwrapped || null;
  }
  return text || null;
}

function expandPathTokens(input) {
  let expanded = String(input || '');
  const home = process.env.USERPROFILE || process.env.HOME || '';
  expanded = expanded.replace(/^~(?=$|[\\/])/, home || '~');
  expanded = expanded.replace(/%([^%]+)%/g, (_full, name) => process.env[name] || `%${name}%`);
  return expanded;
}

function normalizePathLike(path, value) {
  const raw = normalizeOptionalString(value);
  if (!raw) return null;
  return path.resolve(expandPathTokens(raw));
}

function isPathLikeExecutable(value) {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
}

function sanitizeFileName(input, fallbackBaseName = 'dataset') {
  const raw = String(input || '').trim();
  const safe = raw.replace(/[^\w.-]+/g, '_').replace(/^_+/, '').replace(/\.+$/, '');
  if (!safe) return `${fallbackBaseName}.csv`;
  if (safe.length > 120) return safe.slice(0, 120);
  return safe;
}

function parseDataUrl(dataUrl, fieldLabel = 'dataset.dataUrl') {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw createHttpError(400, `${fieldLabel} must be a valid base64 data URL`);
  }
  return {
    mimeType: (match[1] || '').toLowerCase(),
    base64: match[2].replace(/\s+/g, ''),
  };
}

function normalizeBase64Payload(value, invalidMessage) {
  const raw = normalizeOptionalString(value);
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw createHttpError(400, invalidMessage);
  }
  return compact;
}

function decodeBase64Buffer(base64, invalidMessage) {
  const normalized = normalizeBase64Payload(base64, invalidMessage);
  if (!normalized) return null;
  return Buffer.from(normalized, 'base64');
}

function normalizeForPathCompare(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

function isSystemPathCandidate(path) {
  const normalized = normalizeForPathCompare(path);
  if (!normalized) return false;

  const windowsSystemRoot = normalizeForPathCompare(process.env.SystemRoot || process.env.windir || 'C:/Windows');
  const windowsProgramFiles = normalizeForPathCompare(process.env.ProgramFiles || 'C:/Program Files');
  const windowsProgramFilesX86 = normalizeForPathCompare(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)');
  const windowsProgramData = normalizeForPathCompare(process.env.ProgramData || 'C:/ProgramData');
  const windowsPrefixes = [
    windowsSystemRoot,
    `${windowsSystemRoot}/system32`,
    `${windowsSystemRoot}/syswow64`,
    windowsProgramFiles,
    windowsProgramFilesX86,
    windowsProgramData,
  ].filter(Boolean);
  if (windowsPrefixes.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return true;
  }

  const unixPrefixes = ['/etc', '/bin', '/sbin', '/usr', '/var', '/root', '/boot', '/proc', '/sys'];
  if (unixPrefixes.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return true;
  }

  return false;
}

function isSensitivePathCandidate(path) {
  const normalized = normalizeForPathCompare(path);
  if (!normalized) return false;

  const fileName = normalized.split('/').pop() || '';
  if (SENSITIVE_FILE_NAMES.has(fileName)) return true;
  if (SENSITIVE_PATH_PARTS.some(part => normalized.includes(part.toLowerCase()))) return true;
  if (isSystemPathCandidate(normalized)) return true;
  return false;
}

function isLikelyPathLikeString(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  if (/^(?:~|\/|\\\\)/.test(trimmed)) return true;
  if (trimmed.includes('/') || trimmed.includes('\\')) return true;
  if (/^\.[\\/]/.test(trimmed)) return true;
  return false;
}

function redactSensitiveText(message) {
  let result = String(message || '');
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  result = result.replace(
    /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY))\s*=\s*([^\s'"]{4,})/gi,
    (_full, key) => `${key}=[REDACTED]`,
  );
  return result;
}

function scanValueForSensitivePaths(value, context = 'options') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanValueForSensitivePaths(entry, `${context}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      scanValueForSensitivePaths(nested, `${context}.${key}`);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (!isLikelyPathLikeString(value)) return;

  const resolved = normalizeForPathCompare(expandPathTokens(value));
  if (!resolved) return;
  if (isSensitivePathCandidate(resolved)) {
    throw createHttpError(400, `${context} contains a sensitive/system path and is not allowed`);
  }
}

function normalizeDatasetPayload(payload = {}, maxDatasetBytes = DEFAULT_MAX_DATASET_BYTES) {
  const dataset = isPlainObject(payload.dataset) ? payload.dataset : {};
  const rawFileName = dataset.fileName ?? payload.fileName ?? '';
  const fileName = sanitizeFileName(rawFileName || 'dataset.csv');
  const extension = fileName.includes('.')
    ? `.${fileName.split('.').pop().toLowerCase()}`
    : '';
  if (!SUPPORTED_DATASET_EXTENSIONS.has(extension)) {
    const supported = [...SUPPORTED_DATASET_EXTENSIONS].sort().join(', ');
    throw createHttpError(400, `Unsupported dataset extension "${extension || 'none'}". Supported: ${supported}`);
  }

  let base64 = normalizeBase64Payload(dataset.base64, 'dataset base64 content is invalid');
  let mimeType = normalizeOptionalString(dataset.mimeType);
  if (!base64 && dataset.dataUrl) {
    const parsed = parseDataUrl(dataset.dataUrl, 'dataset.dataUrl');
    base64 = normalizeBase64Payload(parsed.base64, 'dataset base64 content is invalid');
    mimeType = mimeType || parsed.mimeType;
  }
  if (!base64) {
    throw createHttpError(400, 'dataset content is required (dataset.base64 or dataset.dataUrl)');
  }

  const buffer = decodeBase64Buffer(base64, 'dataset base64 content is invalid');
  if (!buffer.length) throw createHttpError(400, 'dataset is empty');
  if (buffer.length > maxDatasetBytes) {
    throw createHttpError(413, `dataset exceeds ${maxDatasetBytes} bytes`);
  }

  return {
    fileName,
    extension,
    mimeType: mimeType || 'application/octet-stream',
    bytes: buffer,
  };
}

function normalizeDocumentPayload(payload = {}, maxDocumentBytes = DEFAULT_MAX_DOCUMENT_BYTES) {
  const document = isPlainObject(payload.document) ? payload.document : null;
  if (!document) return null;

  const rawFileName = document.fileName ?? payload.documentFileName ?? '';
  const fileName = sanitizeFileName(rawFileName || 'document.pdf', 'document');
  const extension = fileName.includes('.')
    ? `.${fileName.split('.').pop().toLowerCase()}`
    : '';
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension)) {
    const supported = [...SUPPORTED_DOCUMENT_EXTENSIONS].sort().join(', ');
    throw createHttpError(400, `Unsupported document extension "${extension || 'none'}". Supported: ${supported}`);
  }

  let base64 = normalizeBase64Payload(document.base64, 'document base64 content is invalid');
  let mimeType = normalizeOptionalString(document.mimeType);
  if (!base64 && document.dataUrl) {
    const parsed = parseDataUrl(document.dataUrl, 'document.dataUrl');
    base64 = normalizeBase64Payload(parsed.base64, 'document base64 content is invalid');
    mimeType = mimeType || parsed.mimeType;
  }
  if (!base64) {
    throw createHttpError(400, 'document content is required (document.base64 or document.dataUrl)');
  }

  const buffer = decodeBase64Buffer(base64, 'document base64 content is invalid');
  if (!buffer.length) throw createHttpError(400, 'document is empty');
  if (buffer.length > maxDocumentBytes) {
    throw createHttpError(413, `document exceeds ${maxDocumentBytes} bytes`);
  }

  return {
    fileName,
    extension,
    mimeType: mimeType || 'application/octet-stream',
    bytes: buffer,
  };
}

function resolvePythonExecutable(path, connectorConfig) {
  const explicit = normalizeOptionalString(connectorConfig.pythonExecutable);
  if (explicit) {
    return isPathLikeExecutable(explicit) ? path.resolve(explicit) : explicit;
  }

  const venvPath = normalizeOptionalString(connectorConfig.venvPath);
  if (!venvPath) return 'python';

  const resolvedVenvPath = path.resolve(venvPath);
  if (/python(\.exe)?$/i.test(path.basename(resolvedVenvPath))) return resolvedVenvPath;
  return process.platform === 'win32'
    ? path.join(resolvedVenvPath, 'Scripts', 'python.exe')
    : path.join(resolvedVenvPath, 'bin', 'python');
}

function normalizeOpenPandasConfig(path, config = {}) {
  const mode = normalizeMode(config.mode ?? process.env.HERMES_OPEN_PANDAS_AI_MODE ?? DEFAULT_MODE);
  const timeoutMs = clampNumber(
    config.request_timeout_ms
      ?? process.env.HERMES_OPEN_PANDAS_AI_TIMEOUT_MS
      ?? DEFAULT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    { min: 10000, max: 900000 },
  );
  const maxDatasetBytes = clampNumber(
    config.max_dataset_bytes ?? process.env.HERMES_OPEN_PANDAS_AI_MAX_DATASET_BYTES ?? DEFAULT_MAX_DATASET_BYTES,
    DEFAULT_MAX_DATASET_BYTES,
    { min: 1024, max: 1024 * 1024 * 1024 },
  );
  const maxDocumentBytes = clampNumber(
    config.max_document_bytes ?? process.env.HERMES_OPEN_PANDAS_AI_MAX_DOCUMENT_BYTES ?? DEFAULT_MAX_DOCUMENT_BYTES,
    DEFAULT_MAX_DOCUMENT_BYTES,
    { min: 1024, max: 1024 * 1024 * 1024 },
  );
  const maxOptionsBytes = clampNumber(
    config.max_options_bytes ?? process.env.HERMES_OPEN_PANDAS_AI_MAX_OPTIONS_BYTES ?? DEFAULT_MAX_OPTIONS_BYTES,
    DEFAULT_MAX_OPTIONS_BYTES,
    { min: 1024, max: 32 * 1024 * 1024 },
  );
  const maxOutputBytes = clampNumber(
    config.max_output_bytes ?? process.env.HERMES_OPEN_PANDAS_AI_MAX_OUTPUT_BYTES ?? DEFAULT_MAX_OUTPUT_BYTES,
    DEFAULT_MAX_OUTPUT_BYTES,
    { min: 1024, max: 1024 * 1024 * 1024 },
  );
  const maxQuestionChars = clampNumber(
    config.max_question_chars ?? process.env.HERMES_OPEN_PANDAS_AI_MAX_QUESTION_CHARS ?? DEFAULT_MAX_QUESTION_CHARS,
    DEFAULT_MAX_QUESTION_CHARS,
    { min: 128, max: 1_000_000 },
  );
  const stdioMaxBufferBytes = clampNumber(
    config.stdio_max_buffer_bytes ?? process.env.HERMES_OPEN_PANDAS_AI_STDIO_MAX_BUFFER_BYTES ?? (30 * 1024 * 1024),
    30 * 1024 * 1024,
    { min: 256 * 1024, max: 1024 * 1024 * 1024 },
  );
  const memoryLimitMb = clampNumber(
    config.memory_limit_mb ?? process.env.HERMES_OPEN_PANDAS_AI_MEMORY_LIMIT_MB ?? DEFAULT_MEMORY_LIMIT_MB,
    DEFAULT_MEMORY_LIMIT_MB,
    { min: 128, max: 65536 },
  );

  return {
    enabled: Boolean(config.enabled ?? false),
    mode,
    projectPath: normalizePathLike(path, config.project_path ?? process.env.HERMES_OPEN_PANDAS_AI_PROJECT_PATH),
    venvPath: normalizePathLike(path, config.venv_path ?? process.env.HERMES_OPEN_PANDAS_AI_VENV_PATH),
    pythonExecutable: normalizeOptionalString(config.python_executable ?? process.env.HERMES_OPEN_PANDAS_AI_PYTHON),
    cliModule: normalizeOptionalString(config.cli_module) || DEFAULT_CLI_MODULE,
    apiBaseUrl: normalizeOptionalString(config.api_base_url ?? process.env.HERMES_OPEN_PANDAS_AI_API_BASE_URL),
    requestTimeoutMs: timeoutMs,
    maxDatasetBytes,
    maxDocumentBytes,
    maxOptionsBytes,
    maxOutputBytes,
    maxQuestionChars,
    stdioMaxBufferBytes,
    memoryLimitMb,
    sandboxEnabled: parseBoolean(config.sandbox_enabled ?? process.env.HERMES_OPEN_PANDAS_AI_SANDBOX_ENABLED, true),
    cleanupRunArtifacts: parseBoolean(config.cleanup_run_artifacts ?? process.env.HERMES_OPEN_PANDAS_AI_CLEANUP_RUN_ARTIFACTS, true),
    strictPathGuard: parseBoolean(config.strict_path_guard ?? process.env.HERMES_OPEN_PANDAS_AI_STRICT_PATH_GUARD, true),
    sanitizeLogs: parseBoolean(config.sanitize_logs ?? process.env.HERMES_OPEN_PANDAS_AI_SANITIZE_LOGS, true),
  };
}

function buildPublicConfig(connectorConfig) {
  return {
    enabled: connectorConfig.enabled,
    mode: connectorConfig.mode,
    project_path: connectorConfig.projectPath,
    venv_path: connectorConfig.venvPath,
    python_executable: connectorConfig.pythonExecutable,
    cli_module: connectorConfig.cliModule,
    api_base_url: connectorConfig.apiBaseUrl,
    request_timeout_ms: connectorConfig.requestTimeoutMs,
    max_dataset_bytes: connectorConfig.maxDatasetBytes,
    max_document_bytes: connectorConfig.maxDocumentBytes,
    max_options_bytes: connectorConfig.maxOptionsBytes,
    max_output_bytes: connectorConfig.maxOutputBytes,
    max_question_chars: connectorConfig.maxQuestionChars,
    stdio_max_buffer_bytes: connectorConfig.stdioMaxBufferBytes,
    memory_limit_mb: connectorConfig.memoryLimitMb,
    sandbox_enabled: connectorConfig.sandboxEnabled,
    cleanup_run_artifacts: connectorConfig.cleanupRunArtifacts,
    strict_path_guard: connectorConfig.strictPathGuard,
    sanitize_logs: connectorConfig.sanitizeLogs,
  };
}

function appendRunLog(runState, level, message) {
  runState.logs.push({
    timestamp: nowIso(),
    level,
    message,
  });
  if (runState.logs.length > DEFAULT_MAX_LOG_ENTRIES) {
    runState.logs = runState.logs.slice(-DEFAULT_MAX_LOG_ENTRIES);
  }
  runState.updatedAt = nowIso();
}

function isAllowedApiHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1';
}

function normalizeApiBaseUrlOrThrow(rawValue) {
  const trimmed = normalizeOptionalString(rawValue);
  if (!trimmed) throw createHttpError(400, 'open_pandas_ai.api_base_url is required in API mode');
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw createHttpError(400, 'open_pandas_ai.api_base_url is not a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw createHttpError(400, 'open_pandas_ai.api_base_url must use http or https');
  }
  if (!isAllowedApiHost(url.hostname)) {
    throw createHttpError(400, 'open_pandas_ai.api_base_url must target localhost/127.0.0.1/::1');
  }
  return url.toString().replace(/\/$/, '');
}

async function fileExists(fs, targetPath) {
  if (!targetPath) return false;
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function cleanupRuns(store) {
  if (store.size <= DEFAULT_MAX_RUNS_PER_PROFILE) return;
  const entries = [...store.entries()].sort((a, b) => {
    const aTs = Date.parse(a[1].createdAt || 0);
    const bTs = Date.parse(b[1].createdAt || 0);
    return aTs - bTs;
  });
  while (entries.length > DEFAULT_MAX_RUNS_PER_PROFILE) {
    const [oldestId] = entries.shift();
    store.delete(oldestId);
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function createOpenPandasAiService({
  fs,
  path,
  axios,
  execFileAsync,
  runtimeFilesService,
  documentParserService = null,
}) {
  const runsByProfile = new Map();
  const serviceLogQueueByProfile = new Map();

  function getProfileKey(hermes) {
    return hermes?.paths?.appState || hermes?.home || 'default';
  }

  function getRunStore(hermes) {
    const profileKey = getProfileKey(hermes);
    if (!runsByProfile.has(profileKey)) {
      runsByProfile.set(profileKey, new Map());
    }
    return runsByProfile.get(profileKey);
  }

  function getServiceLogPath(hermes) {
    return path.join(hermes.paths.appState, 'logs', OPEN_PANDAS_LOG_FILENAME);
  }

  function isRootPath(targetPath) {
    const resolved = path.resolve(targetPath);
    const parsed = path.parse(resolved);
    return path.resolve(parsed.root) === resolved;
  }

  function getPathGuardMessage(targetPath) {
    if (!targetPath) return 'path is missing';
    if (isRootPath(targetPath)) return 'path cannot point to a filesystem root';
    if (isSensitivePathCandidate(targetPath)) return 'path points to a sensitive or system location';
    return null;
  }

  async function assertPathSafeOrThrow(label, targetPath, { mustExist = false, mustBeDirectory = false } = {}) {
    const guardMessage = getPathGuardMessage(targetPath);
    if (guardMessage) {
      throw createHttpError(400, `${label} is not allowed: ${guardMessage}`);
    }

    if (!mustExist) return;
    let stat;
    try {
      stat = await fs.stat(targetPath);
    } catch {
      throw createHttpError(400, `${label} does not exist: ${targetPath}`);
    }
    if (mustBeDirectory && !stat.isDirectory()) {
      throw createHttpError(400, `${label} must be a directory: ${targetPath}`);
    }
  }

  function buildSandboxPaths(runRoot) {
    const sandboxRoot = path.join(runRoot, 'sandbox');
    return {
      root: sandboxRoot,
      home: path.join(sandboxRoot, 'home'),
      tmp: path.join(sandboxRoot, 'tmp'),
    };
  }

  function buildSandboxEnvironment(connectorConfig, sandboxPaths, runRoot) {
    const env = { ...process.env };
    if (connectorConfig.sandboxEnabled) {
      env.HOME = sandboxPaths.home;
      env.USERPROFILE = sandboxPaths.home;
      env.HOMEDRIVE = path.parse(sandboxPaths.home).root.replace(/[\\/]+$/, '');
      env.HOMEPATH = sandboxPaths.home.slice(env.HOMEDRIVE.length) || '\\';
      env.TMPDIR = sandboxPaths.tmp;
      env.TMP = sandboxPaths.tmp;
      env.TEMP = sandboxPaths.tmp;
      env.HERMES_OPEN_PANDAS_SANDBOX = '1';
      env.HERMES_OPEN_PANDAS_SANDBOX_ROOT = sandboxPaths.root;
      env.HERMES_OPEN_PANDAS_ALLOWED_ROOT = runRoot;
      env.HERMES_OPEN_PANDAS_MEMORY_LIMIT_MB = String(connectorConfig.memoryLimitMb);
    }
    env.PYTHONDONTWRITEBYTECODE = '1';
    env.PYTHONNOUSERSITE = '1';
    env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
    env.PIP_NO_CACHE_DIR = '1';
    return env;
  }

  function appendServiceLog(hermes, event) {
    const profileKey = getProfileKey(hermes);
    const targetPath = getServiceLogPath(hermes);
    const sanitizedEvent = { ...event };
    if (typeof sanitizedEvent.message === 'string') {
      sanitizedEvent.message = redactSensitiveText(sanitizedEvent.message);
    }
    const line = `${JSON.stringify({
      timestamp: nowIso(),
      ...sanitizedEvent,
    })}\n`;

    const pending = serviceLogQueueByProfile.get(profileKey) || Promise.resolve();
    const next = pending
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.appendFile(targetPath, line, 'utf-8');
      })
      .catch(() => undefined);

    serviceLogQueueByProfile.set(profileKey, next);
  }

  function appendRunEvent(hermes, runState, level, message) {
    const safeMessage = runState?.sanitizeLogs === false
      ? String(message || '')
      : redactSensitiveText(message);
    appendRunLog(runState, level, safeMessage);
    appendServiceLog(hermes, {
      service: 'open_pandas_ai',
      runId: runState.runId,
      level,
      message: safeMessage,
    });
  }

  async function readConnectorConfig(hermes) {
    let config = {};
    try {
      config = await runtimeFilesService.readYamlConfig(hermes);
    } catch {
      config = {};
    }
    return normalizeOpenPandasConfig(path, config?.open_pandas_ai || {});
  }

  function assertQuestionConstraints(question, connectorConfig) {
    if (question.length > connectorConfig.maxQuestionChars) {
      throw createHttpError(413, `question exceeds ${connectorConfig.maxQuestionChars} characters`);
    }
  }

  function assertOptionsPayloadSize(options, connectorConfig) {
    let encoded = '';
    try {
      encoded = JSON.stringify(options);
    } catch {
      throw createHttpError(400, 'options payload is not serializable');
    }
    if (!encoded) return;
    const sizeBytes = Buffer.byteLength(encoded, 'utf-8');
    if (sizeBytes > connectorConfig.maxOptionsBytes) {
      throw createHttpError(413, `options exceeds ${connectorConfig.maxOptionsBytes} bytes`);
    }
  }

  function normalizeOptionsPayload(options, connectorConfig, { enforcePathGuard = true } = {}) {
    const runOptions = isPlainObject(options) ? { ...options } : {};
    if (enforcePathGuard && connectorConfig.strictPathGuard) {
      scanValueForSensitivePaths(runOptions, 'options');
    }
    assertOptionsPayloadSize(runOptions, connectorConfig);
    return runOptions;
  }

  async function readOutputPayload(outputPath, connectorConfig) {
    let stat = null;
    try {
      stat = await fs.stat(outputPath);
    } catch (error) {
      throw createHttpError(500, `Invalid Open_Pandas_AI output payload: ${error.message}`);
    }
    if (Number(stat?.size || 0) > connectorConfig.maxOutputBytes) {
      throw createHttpError(413, `Open_Pandas_AI output exceeds ${connectorConfig.maxOutputBytes} bytes`);
    }
    try {
      const raw = await fs.readFile(outputPath, 'utf-8');
      const payload = JSON.parse(raw);
      if (!isPlainObject(payload)) {
        throw createHttpError(500, 'Open_Pandas_AI output payload must be an object');
      }
      return payload;
    } catch (error) {
      if (error?.statusCode) throw error;
      throw createHttpError(500, `Invalid Open_Pandas_AI output payload: ${error.message}`);
    }
  }

  async function runCliAnalysis({
    hermes,
    connectorConfig,
    question,
    runRoot,
    sandboxPaths,
    datasetPath,
    optionsPath,
    outputPath,
    runState,
  }) {
    if (!connectorConfig.projectPath) {
      throw createHttpError(400, 'open_pandas_ai.project_path is required in CLI mode');
    }

    await assertPathSafeOrThrow(
      'open_pandas_ai.project_path',
      connectorConfig.projectPath,
      { mustExist: true, mustBeDirectory: true },
    );
    if (connectorConfig.venvPath) {
      await assertPathSafeOrThrow(
        'open_pandas_ai.venv_path',
        connectorConfig.venvPath,
        { mustExist: true, mustBeDirectory: true },
      );
    }

    const pythonExecutable = resolvePythonExecutable(path, connectorConfig);
    if (isPathLikeExecutable(pythonExecutable)) {
      await assertPathSafeOrThrow(
        'open_pandas_ai.python_executable',
        path.resolve(pythonExecutable),
        { mustExist: true, mustBeDirectory: false },
      );
    }
    const cliArgs = [
      '-m',
      connectorConfig.cliModule,
      question,
      datasetPath,
      '--options-file',
      optionsPath,
      '--output',
      outputPath,
    ];

    appendRunEvent(hermes, runState, 'info', `Starting CLI run with ${pythonExecutable}`);
    try {
      const env = buildSandboxEnvironment(connectorConfig, sandboxPaths, runRoot);
      const result = await execFileAsync(
        pythonExecutable,
        cliArgs,
        {
          cwd: connectorConfig.projectPath,
          windowsHide: true,
          timeout: connectorConfig.requestTimeoutMs,
          maxBuffer: connectorConfig.stdioMaxBufferBytes,
          env,
        },
      );
      if (result?.stderr) {
        appendRunEvent(hermes, runState, 'warn', String(result.stderr).slice(0, RUN_LOG_PREVIEW_CHARS));
      }
      if (result?.stdout) {
        appendRunEvent(hermes, runState, 'info', String(result.stdout).slice(0, RUN_LOG_PREVIEW_CHARS));
      }
    } catch (error) {
      if (error?.stdout) appendRunEvent(hermes, runState, 'warn', String(error.stdout).slice(0, RUN_LOG_PREVIEW_CHARS));
      if (error?.stderr) appendRunEvent(hermes, runState, 'error', String(error.stderr).slice(0, RUN_LOG_PREVIEW_CHARS));
      try {
        const fallbackPayload = await readOutputPayload(outputPath, connectorConfig);
        if (isPlainObject(fallbackPayload)) {
          appendRunEvent(hermes, runState, 'warn', 'Open_Pandas_AI CLI exited with error code, using output payload fallback.');
          return fallbackPayload;
        }
      } catch {
        // No output payload generated; surface command failure instead.
      }
      if (error?.code === 'ENOENT') {
        throw createHttpError(500, `Python executable not found: ${pythonExecutable}`);
      }
      if (error?.killed || error?.signal === 'SIGTERM') {
        throw createHttpError(504, `Open_Pandas_AI timed out after ${connectorConfig.requestTimeoutMs} ms`);
      }
      throw createHttpError(500, `Open_Pandas_AI CLI failed: ${error.message}`);
    }

    return readOutputPayload(outputPath, connectorConfig);
  }

  async function runApiAnalysis({
    hermes,
    connectorConfig,
    question,
    datasetPayload,
    options,
    runState,
  }) {
    const apiBaseUrl = normalizeApiBaseUrlOrThrow(connectorConfig.apiBaseUrl);
    const requestPayload = {
      question,
      dataset: {
        fileName: datasetPayload.fileName,
        base64: datasetPayload.bytes.toString('base64'),
        mimeType: datasetPayload.mimeType,
      },
      options,
    };

    appendRunEvent(hermes, runState, 'info', `Calling Open_Pandas_AI API at ${apiBaseUrl}`);
    let response;
    try {
      response = await axios.post(
        `${apiBaseUrl}/analyze`,
        requestPayload,
        {
          timeout: connectorConfig.requestTimeoutMs,
          validateStatus: () => true,
        },
      );
    } catch (error) {
      throw createHttpError(502, `Open_Pandas_AI API request failed: ${error.message}`);
    }

    if (response.status >= 400) {
      const message = typeof response.data?.error === 'string'
        ? response.data.error
        : `Open_Pandas_AI API returned status ${response.status}`;
      throw createHttpError(502, message);
    }

    if (!isPlainObject(response.data)) {
      throw createHttpError(500, 'Open_Pandas_AI API returned an invalid payload');
    }
    try {
      const size = Buffer.byteLength(JSON.stringify(response.data), 'utf-8');
      if (size > connectorConfig.maxOutputBytes) {
        throw createHttpError(413, `Open_Pandas_AI API output exceeds ${connectorConfig.maxOutputBytes} bytes`);
      }
    } catch (error) {
      if (error?.statusCode) throw error;
      throw createHttpError(500, `Could not validate Open_Pandas_AI API output: ${error.message}`);
    }

    return response.data;
  }

  async function executeRun({
    hermes,
    runState,
    connectorConfig,
    question,
    runRoot,
    sandboxPaths,
    datasetPayload,
    datasetPath,
    options,
    optionsPath,
    outputPath,
  }) {
    runState.status = 'running';
    runState.startedAt = nowIso();
    runState.updatedAt = nowIso();
    appendRunEvent(hermes, runState, 'info', 'Run started');

    try {
      const payload = connectorConfig.mode === 'api'
        ? await runApiAnalysis({
            hermes,
            connectorConfig,
            question,
            datasetPayload,
            options,
            runState,
          })
        : await runCliAnalysis({
            hermes,
            connectorConfig,
            question,
            runRoot,
            sandboxPaths,
            datasetPath,
            optionsPath,
            outputPath,
            runState,
          });

      runState.result = payload;
      runState.engineStatus = String(payload?.status || 'unknown');
      if (runState.engineStatus === 'success') runState.status = 'succeeded';
      else if (runState.engineStatus === 'blocked') runState.status = 'blocked';
      else runState.status = 'failed';
      runState.completedAt = nowIso();
      runState.updatedAt = nowIso();
      appendRunEvent(hermes, runState, 'info', `Run completed with engine status: ${runState.engineStatus}`);
    } catch (error) {
      runState.status = 'failed';
      runState.completedAt = nowIso();
      runState.updatedAt = nowIso();
      runState.error = {
        message: redactSensitiveText(error.message),
        statusCode: error.statusCode || 500,
      };
      appendRunEvent(hermes, runState, 'error', runState.error.message);
    } finally {
      if (connectorConfig.cleanupRunArtifacts) {
        try {
          await fs.rm(runRoot, { recursive: true, force: true });
        } catch {
          // best effort
        }
      } else {
        try {
          await fs.unlink(optionsPath);
        } catch {
          // best effort
        }
        if (connectorConfig.mode !== 'cli') {
          try {
            await fs.unlink(outputPath);
          } catch {
            // best effort
          }
        }
      }

      // Keep per-run assets for troubleshooting inside Hermes app-state.
      const runStore = getRunStore(hermes);
      runStore.set(runState.runId, { ...runState, logs: [...runState.logs] });
      cleanupRuns(runStore);
    }
  }

  async function getStatus(hermes) {
    const connectorConfig = await readConnectorConfig(hermes);
    const checks = [];
    const logPath = getServiceLogPath(hermes);

    if (!connectorConfig.enabled) {
      return {
        status: 'disabled',
        mode: connectorConfig.mode,
        checks,
        config: buildPublicConfig(connectorConfig),
        log_path: logPath,
      };
    }

    if (connectorConfig.mode === 'cli') {
      checks.push({
        key: 'project_path',
        ok: Boolean(connectorConfig.projectPath) && await fileExists(fs, connectorConfig.projectPath),
        message: connectorConfig.projectPath
          ? `project_path resolved to ${connectorConfig.projectPath}`
          : 'project_path is missing',
      });

      if (connectorConfig.venvPath) {
        const venvExists = await fileExists(fs, connectorConfig.venvPath);
        checks.push({
          key: 'venv_path',
          ok: venvExists,
          message: venvExists
            ? `venv_path resolved to ${connectorConfig.venvPath}`
            : `venv_path not found: ${connectorConfig.venvPath}`,
        });
      }

      const pythonExecutable = resolvePythonExecutable(path, connectorConfig);
      const pythonExists = isPathLikeExecutable(pythonExecutable)
        ? await fileExists(fs, pythonExecutable)
        : true;
      checks.push({
        key: 'python_executable',
        ok: pythonExists,
        message: pythonExists
          ? `python executable resolved to ${pythonExecutable}`
          : `python executable not found: ${pythonExecutable}`,
      });
    } else {
      let apiBaseUrl = null;
      let apiBaseUrlError = null;
      try {
        apiBaseUrl = normalizeApiBaseUrlOrThrow(connectorConfig.apiBaseUrl);
      } catch (error) {
        apiBaseUrlError = error.message;
      }

      checks.push({
        key: 'api_base_url',
        ok: Boolean(apiBaseUrl) && !apiBaseUrlError,
        message: apiBaseUrlError || `api_base_url resolved to ${apiBaseUrl}`,
      });

      if (apiBaseUrl) {
        try {
          const response = await axios.get(`${apiBaseUrl}/health`, {
            timeout: DEFAULT_STATUS_TIMEOUT_MS,
            validateStatus: () => true,
          });
          checks.push({
            key: 'api_health',
            ok: response.status < 500,
            message: `/health returned HTTP ${response.status}`,
          });
        } catch (error) {
          checks.push({
            key: 'api_health',
            ok: false,
            message: `Could not reach ${apiBaseUrl}/health (${error.message})`,
          });
        }
      }
    }

    if (documentParserService?.getHealth) {
      try {
        const parserHealth = await documentParserService.getHealth(hermes);
        checks.push({
          key: 'liteparse',
          ok: Boolean(parserHealth?.ready),
          required: false,
          message: parserHealth?.ready
            ? 'LiteParse parser is available for document context.'
            : parserHealth?.checks?.find(check => !check.ok)?.message || 'LiteParse parser is unavailable.',
        });
      } catch (error) {
        checks.push({
          key: 'liteparse',
          ok: false,
          required: false,
          message: `LiteParse health check failed (${error.message})`,
        });
      }
    } else if (!documentParserService?.parseDocument) {
      checks.push({
        key: 'liteparse',
        ok: false,
        required: false,
        message: 'LiteParse service is not configured. PDF context is disabled.',
      });
    }

    checks.push({
      key: 'open_pandas_log',
      ok: true,
      required: false,
      message: `run logs are written to ${logPath}`,
    });

    const requiredChecks = checks.filter(check => check.required !== false);
    const allRequiredChecksOk = requiredChecks.every(check => check.ok);
    return {
      status: allRequiredChecksOk ? 'ready' : 'misconfigured',
      mode: connectorConfig.mode,
      checks,
      config: buildPublicConfig(connectorConfig),
      log_path: logPath,
    };
  }

  async function startAnalysis(hermes, payload = {}) {
    const connectorConfig = await readConnectorConfig(hermes);
    if (!connectorConfig.enabled) {
      appendServiceLog(hermes, {
        service: 'open_pandas_ai',
        level: 'warn',
        message: 'Analysis request rejected: connector disabled.',
      });
      throw createHttpError(409, 'Open_Pandas_AI connector is disabled in config.yaml (open_pandas_ai.enabled)');
    }

    const question = String(payload?.question || '').trim();
    if (!question) throw createHttpError(400, 'question is required');
    assertQuestionConstraints(question, connectorConfig);

    const options = payload?.options;
    if (options !== undefined && !isPlainObject(options)) {
      throw createHttpError(400, 'options must be an object when provided');
    }
    const runOptions = normalizeOptionsPayload(options, connectorConfig);

    const datasetPayload = normalizeDatasetPayload(payload, connectorConfig.maxDatasetBytes);
    const documentPayload = normalizeDocumentPayload(payload, connectorConfig.maxDocumentBytes);
    const runId = `opa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const runRoot = path.join(hermes.paths.appState, 'open-pandas-ai', 'runs', runId);
    const inputDir = path.join(runRoot, 'input');
    const sandboxPaths = buildSandboxPaths(runRoot);
    const documentInputDir = path.join(inputDir, 'document');
    const outputPath = path.join(runRoot, 'output.json');
    const optionsPath = path.join(runRoot, 'options.json');
    const datasetPath = path.join(inputDir, datasetPayload.fileName);
    const documentPath = documentPayload
      ? path.join(documentInputDir, documentPayload.fileName)
      : null;

    await fs.mkdir(inputDir, { recursive: true });
    if (connectorConfig.sandboxEnabled) {
      await fs.mkdir(sandboxPaths.home, { recursive: true });
      await fs.mkdir(sandboxPaths.tmp, { recursive: true });
    }
    await fs.writeFile(datasetPath, datasetPayload.bytes);

    let runQuestion = question;
    const requireDocumentContext = parseBoolean(
      payload?.require_document_context ?? runOptions.require_document_context,
      false,
    );
    delete runOptions.require_document_context;
    appendServiceLog(hermes, {
      service: 'open_pandas_ai',
      runId,
      level: 'info',
      message: `Analysis request accepted: mode=${connectorConfig.mode}, dataset=${datasetPayload.fileName}, document=${documentPayload?.fileName || 'none'}, strictDocument=${requireDocumentContext}`,
    });
    let parsedDocumentMeta = null;
    let documentContextFailure = null;

    if (documentPayload) {
      await fs.mkdir(documentInputDir, { recursive: true });
      await fs.writeFile(documentPath, documentPayload.bytes);

      parsedDocumentMeta = {
        fileName: documentPayload.fileName,
        extension: documentPayload.extension,
        bytes: documentPayload.bytes.length,
        pageCount: 0,
        charCount: 0,
        warning: null,
      };

      if (!documentParserService?.parseDocument) {
        const message = 'Document parsing is unavailable. Configure LiteParse service first.';
        if (requireDocumentContext) {
          throw createHttpError(503, message);
        }
        parsedDocumentMeta.warning = `document context skipped: ${message}`;
        documentContextFailure = message;
      } else {
        try {
          const parsedDocument = await documentParserService.parseDocument(hermes, {
            referenceValue: documentPayload.fileName,
            resolvedPath: documentPath,
            maxChars: DEFAULT_DOCUMENT_CONTEXT_MAX_CHARS,
          });
          const contextText = String(parsedDocument?.content || '').trim();
          if (!contextText) {
            throw createHttpError(422, `No text could be extracted from ${documentPayload.fileName}`);
          }

          parsedDocumentMeta.pageCount = Number(parsedDocument?.meta?.pageCount || 0);
          parsedDocumentMeta.charCount = Number(parsedDocument?.charCount || contextText.length);
          parsedDocumentMeta.warning = normalizeOptionalString(parsedDocument?.warning);
          runOptions.document_context = {
            source: documentPayload.fileName,
            text: contextText,
            page_count: parsedDocumentMeta.pageCount,
            char_count: parsedDocumentMeta.charCount,
            warning: parsedDocumentMeta.warning,
          };

          runQuestion = `${question}\n\nDocument context (${documentPayload.fileName}):\n${contextText}`;
        } catch (error) {
          const statusCode = Number(error?.statusCode) || 422;
          const message = error?.message || `Could not parse ${documentPayload.fileName}`;
          if (requireDocumentContext) {
            throw createHttpError(statusCode, message);
          }
          parsedDocumentMeta.warning = `document context skipped: ${message}`;
          documentContextFailure = message;
        }
      }
    }

    assertOptionsPayloadSize(runOptions, connectorConfig);
    await fs.writeFile(optionsPath, JSON.stringify(runOptions, null, 2), 'utf-8');

    const runState = {
      runId,
      status: 'queued',
      engineStatus: 'pending',
      mode: connectorConfig.mode,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      completedAt: null,
      question: runQuestion,
      dataset: {
        fileName: datasetPayload.fileName,
        extension: datasetPayload.extension,
        bytes: datasetPayload.bytes.length,
      },
      document: parsedDocumentMeta,
      logPath: getServiceLogPath(hermes),
      sanitizeLogs: connectorConfig.sanitizeLogs,
      logs: [],
      result: null,
      error: null,
    };

    if (parsedDocumentMeta && !documentContextFailure) {
      appendRunEvent(
        hermes,
        runState,
        'info',
        `Document context loaded from ${parsedDocumentMeta.fileName} (${parsedDocumentMeta.charCount} chars).`,
      );
    }
    if (documentContextFailure) {
      appendRunEvent(
        hermes,
        runState,
        'warn',
        `Document context fallback activated: ${documentContextFailure}`,
      );
    }

    const runStore = getRunStore(hermes);
    runStore.set(runId, runState);
    cleanupRuns(runStore);
    appendServiceLog(hermes, {
      service: 'open_pandas_ai',
      runId,
      level: 'info',
      message: `Run queued (${connectorConfig.mode}) dataset=${datasetPayload.fileName}`,
    });

    void executeRun({
      hermes,
      runState,
      connectorConfig,
      question: runQuestion,
      runRoot,
      sandboxPaths,
      datasetPayload,
      datasetPath,
      options: runOptions,
      optionsPath,
      outputPath,
    });

    return {
      runId,
      status: runState.status,
      createdAt: runState.createdAt,
    };
  }

  async function getRun(hermes, runId) {
    const runStore = getRunStore(hermes);
    const runState = runStore.get(String(runId || '').trim());
    if (!runState) throw createHttpError(404, 'Run not found');
    return structuredClone(runState);
  }

  async function getLogs(hermes, lines = 200) {
    const maxLines = clampNumber(lines, 200, { min: 20, max: 2000 });
    const targetPath = getServiceLogPath(hermes);
    let stat = null;
    try {
      stat = await fs.stat(targetPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return {
          path: targetPath,
          updatedAt: null,
          sizeBytes: 0,
          truncated: false,
          lineCount: 0,
          totalLines: 0,
          content: '',
          note: 'No Open_Pandas_AI logs available yet.',
        };
      }
      throw createHttpError(500, `Could not read Open_Pandas_AI logs: ${error.message}`);
    }

    let raw = '';
    try {
      raw = await fs.readFile(targetPath, 'utf-8');
    } catch (error) {
      throw createHttpError(500, `Could not read Open_Pandas_AI logs: ${error.message}`);
    }
    const allLines = raw.split(/\r?\n/).filter(Boolean);
    const selectedLines = allLines.slice(-maxLines);
    return {
      path: targetPath,
      updatedAt: stat?.mtime ? new Date(stat.mtime).toISOString() : null,
      sizeBytes: Number(stat?.size || 0),
      truncated: selectedLines.length < allLines.length,
      lineCount: selectedLines.length,
      totalLines: allLines.length,
      content: selectedLines.join('\n'),
      note: selectedLines.length ? null : 'Open_Pandas_AI log file is currently empty.',
    };
  }

  return {
    getStatus,
    startAnalysis,
    getRun,
    getLogs,
  };
}
