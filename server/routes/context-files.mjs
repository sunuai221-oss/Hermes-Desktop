const STARTUP_CONTEXT_FILES = ['.hermes.md', 'HERMES.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const NESTED_CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules'];
const MAX_CONTEXT_PREVIEW = 8000;
const CONTEXT_SCAN_MAX_DEPTH = Math.max(1, Number(process.env.HERMES_CONTEXT_SCAN_MAX_DEPTH || 5));
const CONTEXT_FILES_CACHE_TTL_MS = Math.max(0, Number(process.env.HERMES_CONTEXT_FILES_CACHE_TTL_MS || 30000));
const CONTEXT_SCAN_EXCLUDED_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.pnpm-store',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'release',
  'site-packages',
  'venv',
]);

export function registerContextFileRoutes({ app, fs, path, workspaceRoot }) {
  const contextFilesCache = new Map();

  function getContextFilesCacheKey(hermes) {
    return `${hermes?.profile || 'default'}:${workspaceRoot}`;
  }

  function readContextFilesCache(cacheKey) {
    if (CONTEXT_FILES_CACHE_TTL_MS <= 0) return null;
    const cached = contextFilesCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      contextFilesCache.delete(cacheKey);
      return null;
    }
    return cached.value;
  }

  function writeContextFilesCache(cacheKey, value) {
    if (CONTEXT_FILES_CACHE_TTL_MS <= 0) return;
    contextFilesCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + CONTEXT_FILES_CACHE_TTL_MS,
    });
  }

  function clearContextFilesCache(cacheKey) {
    if (cacheKey) {
      contextFilesCache.delete(cacheKey);
      return;
    }
    contextFilesCache.clear();
  }

  async function scanContextFile(filePath, kind, extra = {}) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const truncated = content.length > MAX_CONTEXT_PREVIEW;
      return {
        path: filePath,
        kind,
        name: path.basename(filePath),
        content: truncated
          ? `${content.slice(0, 5600)}\n\n[...preview truncated...]\n\n${content.slice(-1600)}`
          : content,
        charCount: content.length,
        truncated,
        ...extra,
      };
    } catch {
      return null;
    }
  }

  async function listContextFiles(hermes, options = {}) {
    const force = options?.force === true;
    const cacheKey = getContextFilesCacheKey(hermes);
    if (!force) {
      const cached = readContextFilesCache(cacheKey);
      if (cached) return cached;
    }

    const startupCandidates = [];
    let startupWinner = null;

    for (let i = 0; i < STARTUP_CONTEXT_FILES.length; i++) {
      const name = STARTUP_CONTEXT_FILES[i];
      const candidate = await scanContextFile(
        path.join(workspaceRoot, name),
        'startup',
        { priority: i + 1 }
      );
      if (candidate) {
        if (!startupWinner) {
          startupWinner = candidate.path;
          candidate.selectedAtStartup = true;
        } else {
          candidate.selectedAtStartup = false;
        }
        startupCandidates.push(candidate);
      }
    }

    const soul = await scanContextFile(hermes.paths.soul, 'soul');
    const nestedCandidates = [];
    const cursorModules = [];

    async function walk(dir, depth = 0) {
      if (depth > CONTEXT_SCAN_MAX_DEPTH) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const entryName = String(entry.name || '');
        const lowerName = entryName.toLowerCase();
        if (entry.isDirectory() && CONTEXT_SCAN_EXCLUDED_DIRS.has(lowerName)) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entryName === '.cursor') {
            const rulesDir = path.join(fullPath, 'rules');
            const rulesEntries = await fs.readdir(rulesDir, { withFileTypes: true }).catch(() => []);
            for (const rule of rulesEntries) {
              if (!rule.isFile() || !rule.name.endsWith('.mdc')) continue;
              const file = await scanContextFile(path.join(rulesDir, rule.name), 'cursor-module');
              if (file) cursorModules.push(file);
            }
          }
          await walk(fullPath, depth + 1);
          continue;
        }

        if (!entry.isFile()) continue;
        if (!NESTED_CONTEXT_FILES.includes(entry.name)) continue;
        if (dir === workspaceRoot && STARTUP_CONTEXT_FILES.includes(entry.name)) continue;

        const file = await scanContextFile(fullPath, 'nested', { discoveredProgressively: true });
        if (file) nestedCandidates.push(file);
      }
    }

    await walk(workspaceRoot);

    const inventory = {
      workspaceRoot,
      startupWinner,
      startupCandidates,
      nestedCandidates,
      cursorModules,
      soul,
    };
    writeContextFilesCache(cacheKey, inventory);
    return inventory;
  }

  app.get('/api/context-files', async (req, res) => {
    try {
      const force = String(req.query?.refresh || '') === '1';
      res.json(await listContextFiles(req.hermes, { force }));
    } catch (error) {
      res.status(500).json({ error: 'Could not scan context files', details: error.message });
    }
  });

  app.post('/api/context-files', async (req, res) => {
    try {
      const targetPath = String(req.body?.path || '');
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const inventory = await listContextFiles(req.hermes, { force: true });
      const allowed = new Set([
        ...inventory.startupCandidates.map(item => item.path),
        ...inventory.nestedCandidates.map(item => item.path),
        ...inventory.cursorModules.map(item => item.path),
        inventory.soul?.path,
      ].filter(Boolean));

      if (!allowed.has(targetPath)) {
        return res.status(400).json({ error: 'Path is not a discovered editable context file' });
      }

      await fs.writeFile(targetPath, content, 'utf-8');
      clearContextFilesCache(getContextFilesCacheKey(req.hermes));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Could not write context file', details: error.message });
    }
  });
}
