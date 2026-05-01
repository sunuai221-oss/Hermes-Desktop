function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createPathExists(fs) {
  return async function pathExists(targetPath) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  };
}

function expandPath(hermes, inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return inputPath;
  let next = inputPath.replace(/^~(?=$|[\\/])/, hermes.home.replace(/[\\/]?\.hermes$/, ''));
  next = next.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
  return next;
}

function parseSkillFrontmatter(yaml, content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: content, frontmatter: {} };
  try {
    return {
      body: content.slice(match[0].length),
      frontmatter: yaml.parse(match[1]) || {},
    };
  } catch {
    return { body: content, frontmatter: {} };
  }
}

function sanitizeSkillSegment(value, fallback = 'skill') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function ensurePathInsideRoot(path, rootDir, candidatePath) {
  const relative = path.relative(rootDir, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function buildSkillTemplate(yaml, { name, description }) {
  const frontmatter = yaml.stringify({
    name,
    description: description || undefined,
    version: '1.0.0',
  }).trim();

  return `---
${frontmatter}
---

# ${name}

## Purpose

Describe what this skill does and the outcome it should help Hermes produce.

## Use When

- Add the concrete situations where this skill should be used.

## Workflow

1. Inspect the local context before acting.
2. Use the smallest set of tools needed.
3. Return a concise result with the next useful action.
`;
}

function resolveLocalSkillTarget(path, hermes, inputPath) {
  const skillsRoot = path.resolve(hermes.paths.skills);
  if (!inputPath || typeof inputPath !== 'string') return null;

  const resolvedInput = path.resolve(String(inputPath));
  const skillDir = path.basename(resolvedInput).toLowerCase() === 'skill.md'
    ? path.dirname(resolvedInput)
    : resolvedInput;
  const skillFile = path.join(skillDir, 'SKILL.md');

  if (!ensurePathInsideRoot(path, skillsRoot, skillDir) || !ensurePathInsideRoot(path, skillsRoot, skillFile)) {
    return null;
  }

  return { skillsRoot, skillDir, skillFile };
}

const SKILLS_CACHE_TTL_MS = Math.max(0, Number(process.env.HERMES_SKILLS_CACHE_TTL_MS || 30000));

function getSkillsCacheKey(hermes) {
  return String(hermes?.home || 'default');
}

export function createSkillsService({ fs, path, yaml }) {
  const pathExists = createPathExists(fs);
  const listSkillsCache = new Map();

  function readSkillsCache(cacheKey) {
    if (SKILLS_CACHE_TTL_MS <= 0) return null;
    const cached = listSkillsCache.get(cacheKey);
    if (!cached) return null;
    if (Date.now() > cached.expiresAt) {
      listSkillsCache.delete(cacheKey);
      return null;
    }
    return cached.value;
  }

  function writeSkillsCache(cacheKey, value) {
    if (SKILLS_CACHE_TTL_MS <= 0) return;
    listSkillsCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + SKILLS_CACHE_TTL_MS,
    });
  }

  function invalidateSkillsCache(hermes) {
    listSkillsCache.delete(getSkillsCacheKey(hermes));
  }

  async function readConfigForSkills(hermes) {
    try {
      const data = await fs.readFile(hermes.paths.config, 'utf-8');
      return yaml.parse(data) || {};
    } catch {
      return {};
    }
  }

  async function collectSkillsRecursive(rootDir, currentDir, source, seenNames, results) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const hasSkill = entries.some(entry => entry.isFile() && entry.name === 'SKILL.md');

    if (hasSkill) {
      const skillPath = path.join(currentDir, 'SKILL.md');
      const content = await fs.readFile(skillPath, 'utf-8');
      const { frontmatter } = parseSkillFrontmatter(yaml, content);
      const name = frontmatter.name || path.basename(currentDir);

      if (!seenNames.has(name)) {
        seenNames.add(name);
        const relDir = path.relative(rootDir, currentDir);
        const parts = relDir.split(path.sep).filter(Boolean);
        const category = parts.length > 1 ? parts[0] : undefined;

        results.push({
          name,
          description: frontmatter.description,
          version: frontmatter.version,
          path: currentDir,
          source,
          rootDir,
          category,
          platforms: frontmatter.platforms || [],
          tags: frontmatter.metadata?.hermes?.tags || [],
          fallbackForToolsets: frontmatter.metadata?.hermes?.fallback_for_toolsets || [],
          requiresToolsets: frontmatter.metadata?.hermes?.requires_toolsets || [],
          fallbackForTools: frontmatter.metadata?.hermes?.fallback_for_tools || [],
          requiresTools: frontmatter.metadata?.hermes?.requires_tools || [],
          requiredEnvironmentVariables: frontmatter.required_environment_variables || [],
        });
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      await collectSkillsRecursive(rootDir, path.join(currentDir, entry.name), source, seenNames, results);
    }
  }

  async function listSkills(hermes) {
    const cacheKey = getSkillsCacheKey(hermes);
    const cached = readSkillsCache(cacheKey);
    if (cached) return cached;

    const config = await readConfigForSkills(hermes);
    const externalDirs = (config.skills?.external_dirs || [])
      .map(entry => expandPath(hermes, entry))
      .filter(Boolean);

    const roots = [{ dir: hermes.paths.skills, source: 'local' }, ...externalDirs.map(dir => ({ dir, source: 'external' }))];
    const results = [];
    const seenNames = new Set();

    for (const root of roots) {
      if (!(await pathExists(root.dir))) continue;
      await collectSkillsRecursive(root.dir, root.dir, root.source, seenNames, results);
    }

    const sortedResults = results.sort((a, b) => a.name.localeCompare(b.name));
    writeSkillsCache(cacheKey, sortedResults);
    return sortedResults;
  }

  async function createLocalSkill(hermes, input = {}) {
    const name = String(input.name || '').trim();
    const description = String(input.description || '').trim();
    const categoryInput = String(input.category || '').trim();

    if (!name) {
      throw createHttpError(400, 'Skill name is required');
    }

    const skillsRoot = path.resolve(hermes.paths.skills);
    const category = categoryInput ? sanitizeSkillSegment(categoryInput, '') : '';
    const slug = sanitizeSkillSegment(name, 'skill');
    const targetDir = category
      ? path.resolve(skillsRoot, category, slug)
      : path.resolve(skillsRoot, slug);

    if (!ensurePathInsideRoot(path, skillsRoot, targetDir)) {
      throw createHttpError(400, 'Invalid skill target path');
    }

    const skillFile = path.join(targetDir, 'SKILL.md');
    if (await pathExists(skillFile)) {
      throw createHttpError(409, 'A local skill with that name already exists in this profile');
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(skillFile, buildSkillTemplate(yaml, { name, description }), 'utf-8');
    invalidateSkillsCache(hermes);

    return {
      name,
      description: description || undefined,
      category: category || undefined,
      path: targetDir,
      skillFile,
    };
  }

  async function readLocalSkill(hermes, inputPath) {
    const target = resolveLocalSkillTarget(path, hermes, inputPath);
    if (!target) {
      throw createHttpError(400, 'Invalid local skill path');
    }
    if (!(await pathExists(target.skillFile))) {
      throw createHttpError(404, 'Local skill not found');
    }

    const content = await fs.readFile(target.skillFile, 'utf-8');
    return {
      path: target.skillDir,
      skillFile: target.skillFile,
      content,
    };
  }

  async function updateLocalSkill(hermes, inputPath, content) {
    const target = resolveLocalSkillTarget(path, hermes, inputPath);
    if (!target) {
      throw createHttpError(400, 'Invalid local skill path');
    }
    if (!(await pathExists(target.skillFile))) {
      throw createHttpError(404, 'Local skill not found');
    }

    await fs.writeFile(target.skillFile, String(content || ''), 'utf-8');
    invalidateSkillsCache(hermes);
    return { path: target.skillDir, skillFile: target.skillFile };
  }

  async function deleteLocalSkill(hermes, inputPath) {
    const target = resolveLocalSkillTarget(path, hermes, inputPath);
    if (!target) {
      throw createHttpError(400, 'Invalid local skill path');
    }
    if (target.skillDir === target.skillsRoot) {
      throw createHttpError(400, 'Refusing to remove the skills root');
    }
    if (!(await pathExists(target.skillFile))) {
      throw createHttpError(404, 'Local skill not found');
    }

    await fs.rm(target.skillDir, { recursive: true, force: true });
    invalidateSkillsCache(hermes);
    return { path: target.skillDir };
  }

  async function listGatewayHooks(hermes) {
    try {
      const hooksPath = hermes.paths.hooks;
      const entries = await fs.readdir(hooksPath, { withFileTypes: true });
      const results = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const hookDir = path.join(hooksPath, entry.name);
        const hookYamlPath = path.join(hookDir, 'HOOK.yaml');
        if (!(await pathExists(hookYamlPath))) continue;
        const hookYaml = await fs.readFile(hookYamlPath, 'utf-8').catch(() => '');
        const parsed = hookYaml ? (yaml.parse(hookYaml) || {}) : {};
        results.push({
          name: parsed.name || entry.name,
          description: parsed.description,
          events: parsed.events || [],
          path: hookDir,
          source: 'gateway',
          hasHandler: await pathExists(path.join(hookDir, 'handler.py')),
        });
      }
      return results.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  return {
    readConfigForSkills,
    listSkills,
    createLocalSkill,
    readLocalSkill,
    updateLocalSkill,
    deleteLocalSkill,
    listGatewayHooks,
  };
}
