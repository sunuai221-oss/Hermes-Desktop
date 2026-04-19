const DEFAULT_MAX_REFERENCE_CHARS = 12000;
const DEFAULT_MAX_FOLDER_ENTRIES = 200;
const DEFAULT_TEXT_EXTENSIONS = new Set(['.py', '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml', '.sh', '.ps1', '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp']);

export function createContextReferenceService({
  fs,
  path,
  axios,
  dns,
  net,
  execFileAsync,
  workspaceRoot,
  maxReferenceChars = DEFAULT_MAX_REFERENCE_CHARS,
  maxFolderEntries = DEFAULT_MAX_FOLDER_ENTRIES,
  textExtensions = DEFAULT_TEXT_EXTENSIONS,
}) {
  function stripTrailingPunctuation(value) {
    return String(value || '').replace(/[.,;!?]+$/, '');
  }

  function isInsideWorkspace(resolvedPath) {
    const rel = path.relative(workspaceRoot, resolvedPath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  function isSensitivePath(hermes, resolvedPath) {
    const blockedExact = new Set([
      path.resolve(hermes.home, '.env'),
    ]);
    const blockedParts = ['.ssh', '.aws', '.gnupg', '.kube', path.join('skills', '.hub')];

    if (blockedExact.has(resolvedPath)) return true;
    const lower = resolvedPath.toLowerCase();
    return blockedParts.some(part => lower.includes(part.toLowerCase()));
  }

  function parseFileReference(input) {
    const trimmed = stripTrailingPunctuation(input);
    const match = trimmed.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
    if (!match) return { filePath: trimmed, start: null, end: null };
    const filePath = match[1];
    const start = match[2] ? parseInt(match[2], 10) : null;
    const end = match[3] ? parseInt(match[3], 10) : start;
    return { filePath, start, end };
  }

  async function ensureTextFile(resolvedPath) {
    const buffer = await fs.readFile(resolvedPath);
    if (buffer.includes(0) && !textExtensions.has(path.extname(resolvedPath).toLowerCase())) {
      throw new Error('binary files are not supported');
    }
    return buffer.toString('utf-8');
  }

  function clampContent(content) {
    if (content.length <= maxReferenceChars) return { content, warning: undefined };
    const head = Math.floor(maxReferenceChars * 0.7);
    const tail = Math.floor(maxReferenceChars * 0.2);
    return {
      content: `${content.slice(0, head)}\n\n[...reference preview truncated...]\n\n${content.slice(-tail)}`,
      warning: `reference truncated at ${maxReferenceChars} chars`,
    };
  }

  async function resolveFileReference(hermes, rawValue) {
    const { filePath, start, end } = parseFileReference(rawValue);
    const resolvedPath = path.resolve(workspaceRoot, filePath);
    if (!isInsideWorkspace(resolvedPath)) throw new Error('path is outside the allowed workspace');
    if (isSensitivePath(hermes, resolvedPath)) throw new Error('path is a sensitive credential file');
    const content = await ensureTextFile(resolvedPath);
    const ranged = start && end
      ? content.split(/\r?\n/).slice(start - 1, end).join('\n')
      : content;
    const preview = clampContent(ranged);
    return {
      ref: `@file:${rawValue}`,
      kind: 'file',
      label: path.relative(workspaceRoot, resolvedPath) || path.basename(resolvedPath),
      content: preview.content,
      warning: preview.warning,
      charCount: ranged.length,
    };
  }

  async function resolveFolderReference(hermes, rawValue) {
    const resolvedPath = path.resolve(workspaceRoot, stripTrailingPunctuation(rawValue));
    if (!isInsideWorkspace(resolvedPath)) throw new Error('path is outside the allowed workspace');
    if (isSensitivePath(hermes, resolvedPath)) throw new Error('path is a sensitive credential file');
    const stat = await fs.stat(resolvedPath).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new Error('folder not found');

    const lines = [];
    let count = 0;
    async function walk(dir, depth = 0) {
      if (count >= maxFolderEntries || depth > 4) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (count >= maxFolderEntries) break;
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(resolvedPath, fullPath) || entry.name;
        const info = await fs.stat(fullPath).catch(() => null);
        lines.push(`${'  '.repeat(depth)}- ${rel}${entry.isDirectory() ? '/' : ''}${info ? ` (${info.size} bytes)` : ''}`);
        count += 1;
        if (entry.isDirectory()) await walk(fullPath, depth + 1);
      }
    }
    await walk(resolvedPath);
    if (count >= maxFolderEntries) lines.push('- ...');
    const content = lines.join('\n');
    return {
      ref: `@folder:${rawValue}`,
      kind: 'folder',
      label: path.relative(workspaceRoot, resolvedPath) || path.basename(resolvedPath),
      content,
      charCount: content.length,
    };
  }

  async function resolveGitReference(kind, rawValue = '') {
    if (kind === 'diff') {
      const { stdout, stderr } = await execFileAsync('git', ['diff'], { cwd: workspaceRoot });
      if (stderr && !stdout) throw new Error(stderr.trim());
      return { ref: '@diff', kind: 'diff', label: 'git diff', content: stdout || 'No unstaged changes.', charCount: (stdout || '').length };
    }
    if (kind === 'staged') {
      const { stdout, stderr } = await execFileAsync('git', ['diff', '--staged'], { cwd: workspaceRoot });
      if (stderr && !stdout) throw new Error(stderr.trim());
      return { ref: '@staged', kind: 'staged', label: 'git diff --staged', content: stdout || 'No staged changes.', charCount: (stdout || '').length };
    }
    const count = Math.min(10, Math.max(1, parseInt(rawValue, 10) || 1));
    const { stdout, stderr } = await execFileAsync('git', ['log', `-${count}`, '--patch', '--stat'], { cwd: workspaceRoot });
    if (stderr && !stdout) throw new Error(stderr.trim());
    const preview = clampContent(stdout || '');
    return {
      ref: `@git:${count}`,
      kind: 'git',
      label: `last ${count} commits`,
      content: preview.content || 'No git history available.',
      warning: preview.warning,
      charCount: (stdout || '').length,
    };
  }

  function htmlToText(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isPrivateAddress(address) {
    if (net.isIPv4(address)) {
      const parts = address.split('.').map(part => parseInt(part, 10));
      const [a, b] = parts;
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a >= 224) return true;
      return false;
    }

    if (net.isIPv6(address)) {
      const normalized = address.toLowerCase();
      return normalized === '::1'
        || normalized === '::'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80')
        || normalized.startsWith('ff');
    }

    return true;
  }

  async function assertSafeRemoteHost(hostname) {
    const normalized = String(hostname || '').trim().toLowerCase();
    if (!normalized) throw new Error('hostname is required');
    if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
      throw new Error('local network hosts are not allowed');
    }

    const addresses = net.isIP(normalized)
      ? [{ address: normalized }]
      : await dns.lookup(normalized, { all: true, verbatim: true }).catch(() => {
          throw new Error('could not resolve remote host');
        });

    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error('could not resolve remote host');
    }

    for (const entry of addresses) {
      if (isPrivateAddress(entry.address)) {
        throw new Error('private or loopback network hosts are not allowed');
      }
    }
  }

  async function resolveUrlReference(rawValue) {
    const url = stripTrailingPunctuation(rawValue);
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('only http and https URLs are allowed');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('URLs with embedded credentials are not allowed');
    }

    await assertSafeRemoteHost(parsedUrl.hostname);

    const response = await axios.get(parsedUrl.toString(), {
      timeout: 10000,
      responseType: 'text',
      maxRedirects: 0,
    });
    const text = htmlToText(String(response.data || ''));
    if (!text) throw new Error('no content extracted');
    const preview = clampContent(text);
    return {
      ref: `@url:${url}`,
      kind: 'url',
      label: url,
      content: preview.content,
      warning: preview.warning,
      charCount: text.length,
    };
  }

  function inferReferenceKind(ref) {
    const value = String(ref || '');
    if (value === '@diff') return 'diff';
    if (value === '@staged') return 'staged';
    if (value.startsWith('@git:')) return 'git';
    if (value.startsWith('@folder:')) return 'folder';
    if (value.startsWith('@url:')) return 'url';
    return 'file';
  }

  async function resolveContextReference(hermes, ref) {
    const value = String(ref || '').trim();
    if (value === '@diff') return resolveGitReference('diff');
    if (value === '@staged') return resolveGitReference('staged');
    if (value.startsWith('@git:')) return resolveGitReference('git', value.slice(5));
    if (value.startsWith('@file:')) return resolveFileReference(hermes, value.slice(6));
    if (value.startsWith('@folder:')) return resolveFolderReference(hermes, value.slice(8));
    if (value.startsWith('@url:')) return resolveUrlReference(value.slice(5));
    throw new Error('unsupported reference');
  }

  return {
    inferReferenceKind,
    resolveContextReference,
  };
}
