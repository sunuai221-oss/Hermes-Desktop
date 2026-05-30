const DEFAULT_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx', '.docm', '.dot', '.dotm', '.dotx', '.odt', '.ott', '.rtf', '.pages',
  '.ppt', '.pptx', '.pptm', '.pot', '.potm', '.potx', '.odp', '.otp', '.key',
  '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.ots', '.csv', '.tsv', '.numbers',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.svg',
  '.txt', '.md', '.markdown', '.log',
]);

const CACHE_VERSION = 1;
const DEFAULT_CACHE_DIRNAME = 'document-cache';
const DEFAULT_MAX_TEXT_ITEMS_PER_PAGE = 350;
const DEFAULT_MAX_PAGE_TEXT_CHARS = 4000;
const DEFAULT_MAX_TEXT_PREVIEW_CHARS = 12000;
const LITEPARSE_PACKAGE_NAME = '@llamaindex/liteparse';
const LITEPARSE_PLATFORM_PACKAGES = new Map([
  ['darwin-arm64', '@llamaindex/liteparse-darwin-arm64'],
  ['linux-arm64', '@llamaindex/liteparse-linux-arm64-gnu'],
  ['linux-x64', '@llamaindex/liteparse-linux-x64-gnu'],
  ['win32-x64', '@llamaindex/liteparse-win32-x64-msvc'],
]);

function getLiteParsePlatformPackage() {
  const key = `${process.platform}-${process.arch}`;
  return LITEPARSE_PLATFORM_PACKAGES.get(key) || null;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function stripTrailingPunctuation(value) {
  return String(value || '').replace(/[.,;!?]+$/, '');
}

function clampContent(content, maxChars) {
  if (content.length <= maxChars) return { content, warning: undefined };
  const head = Math.floor(maxChars * 0.75);
  const tail = Math.floor(maxChars * 0.15);
  return {
    content: `${content.slice(0, head)}\n\n[...document preview truncated...]\n\n${content.slice(-tail)}`,
    warning: `document preview truncated at ${maxChars} chars`,
  };
}

function parseDocumentReference(rawValue) {
  const cleaned = stripTrailingPunctuation(rawValue);
  const [pathValue, rawQuery = ''] = cleaned.split('?');
  const query = new URLSearchParams(rawQuery);
  return {
    pathValue,
    options: {
      ocrEnabled: query.has('ocr')
        ? parseBoolean(query.get('ocr'), true)
        : undefined,
      ocrLanguage: query.get('ocrLanguage') || query.get('lang') || undefined,
      ocrServerUrl: query.get('ocrServerUrl') || undefined,
      maxPages: query.get('maxPages') || undefined,
      targetPages: query.get('targetPages') || query.get('pages') || undefined,
      dpi: query.get('dpi') || undefined,
      password: query.get('password') || undefined,
    },
  };
}

export function createDocumentParserService({
  fs,
  path,
  createHash,
  workspaceRoot,
  createLiteParseInstance = null,
  cacheDirname = DEFAULT_CACHE_DIRNAME,
  documentExtensions = DEFAULT_DOCUMENT_EXTENSIONS,
  maxTextItemsPerPage = DEFAULT_MAX_TEXT_ITEMS_PER_PAGE,
  maxPageTextChars = DEFAULT_MAX_PAGE_TEXT_CHARS,
}) {
  let parserModulePromise = null;

  function getCacheDirectory(hermes) {
    const base = hermes?.paths?.appState
      || path.join(workspaceRoot, '.hermes-builder');
    return path.join(base, cacheDirname);
  }

  async function loadLiteParseCtor() {
    if (!parserModulePromise) {
      parserModulePromise = import(LITEPARSE_PACKAGE_NAME)
        .then(module => module?.LiteParse || module?.default?.LiteParse || module?.default)
        .catch(error => {
          parserModulePromise = null;
          const detail = error?.message || String(error);
          const platformPackage = getLiteParsePlatformPackage();
          const installHint = platformPackage
            ? `Verify ${LITEPARSE_PACKAGE_NAME} and ${platformPackage} are installed.`
            : `Verify ${LITEPARSE_PACKAGE_NAME} is installed for ${process.platform}/${process.arch}.`;
          throw new Error(`LiteParse is unavailable. ${installHint} (${detail})`);
        });
    }
    return parserModulePromise;
  }

  function buildParserConfig(inlineOptions = {}) {
    return {
      ocrEnabled: inlineOptions.ocrEnabled ?? parseBoolean(process.env.HERMES_LITEPARSE_OCR_ENABLED, true),
      ocrLanguage: inlineOptions.ocrLanguage || process.env.HERMES_LITEPARSE_OCR_LANGUAGE || 'eng',
      ocrServerUrl: inlineOptions.ocrServerUrl || process.env.HERMES_LITEPARSE_OCR_SERVER_URL || undefined,
      maxPages: parseNumber(inlineOptions.maxPages ?? process.env.HERMES_LITEPARSE_MAX_PAGES, 1000, { min: 1, max: 20000 }),
      targetPages: inlineOptions.targetPages || process.env.HERMES_LITEPARSE_TARGET_PAGES || undefined,
      dpi: parseNumber(inlineOptions.dpi ?? process.env.HERMES_LITEPARSE_DPI, 150, { min: 72, max: 600 }),
      preserveVerySmallText: parseBoolean(process.env.HERMES_LITEPARSE_PRESERVE_SMALL_TEXT, false),
      outputFormat: 'json',
      quiet: true,
      password: inlineOptions.password || undefined,
      numWorkers: parseNumber(process.env.HERMES_LITEPARSE_NUM_WORKERS, 1, { min: 1, max: 16 }),
    };
  }

  function isSupportedDocumentPath(filePath) {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    return documentExtensions.has(extension);
  }

  async function readCache(cachePath) {
    try {
      const raw = await fs.readFile(cachePath, 'utf-8');
      const payload = JSON.parse(raw);
      if (payload?.cacheVersion !== CACHE_VERSION) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async function writeCache(cachePath, payload) {
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(payload), 'utf-8');
    } catch {
      // Best-effort cache.
    }
  }

  function buildCacheKey({ resolvedPath, stat, parserConfig, referenceMaxChars }) {
    return createHash('sha256')
      .update(JSON.stringify({
        cacheVersion: CACHE_VERSION,
        path: resolvedPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        parserConfig,
        referenceMaxChars,
      }))
      .digest('hex');
  }

  function normalizePage(page) {
    const items = Array.isArray(page?.textItems) ? page.textItems : [];
    return {
      pageNum: Number(page?.pageNum || 0),
      width: Number(page?.width || 0),
      height: Number(page?.height || 0),
      text: String(page?.text || '').slice(0, maxPageTextChars),
      textItems: items.slice(0, maxTextItemsPerPage).map(item => ({
        text: String(item?.text || ''),
        x: Number(item?.x || 0),
        y: Number(item?.y || 0),
        width: Number(item?.width || 0),
        height: Number(item?.height || 0),
        fontName: item?.fontName ? String(item.fontName) : undefined,
        fontSize: Number.isFinite(Number(item?.fontSize)) ? Number(item.fontSize) : undefined,
        confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : undefined,
      })),
      textItemCount: items.length,
    };
  }

  function buildContextContent(pages, fullText, maxChars) {
    const pageBlocks = pages.map(page => `### Page ${page.pageNum}\n${page.text}`.trim()).join('\n\n');
    const combined = pageBlocks || String(fullText || '');
    return clampContent(combined, maxChars);
  }

  async function parseDocument(hermes, { referenceValue, resolvedPath, maxChars = DEFAULT_MAX_TEXT_PREVIEW_CHARS }) {
    const { options: inlineOptions } = parseDocumentReference(referenceValue);
    const parserConfig = buildParserConfig(inlineOptions);
    const stat = await fs.stat(resolvedPath);
    const cacheDir = getCacheDirectory(hermes);
    const cacheKey = buildCacheKey({
      resolvedPath,
      stat,
      parserConfig,
      referenceMaxChars: maxChars,
    });
    const cachePath = path.join(cacheDir, `${cacheKey}.json`);
    const cached = await readCache(cachePath);
    if (cached) {
      return {
        ...cached,
        cached: true,
      };
    }

    const parser = typeof createLiteParseInstance === 'function'
      ? createLiteParseInstance(parserConfig)
      : new (await loadLiteParseCtor())(parserConfig);
    const parsed = await parser.parse(resolvedPath);
    const normalizedPages = (Array.isArray(parsed?.pages) ? parsed.pages : []).map(normalizePage);
    const { content, warning } = buildContextContent(normalizedPages, parsed?.text || '', maxChars);
    const payload = {
      cacheVersion: CACHE_VERSION,
      cached: false,
      content,
      warning,
      charCount: content.length,
      meta: {
        parser: 'liteparse',
        source: resolvedPath,
        cacheKey,
        pageCount: normalizedPages.length,
        ocrEnabled: Boolean(parserConfig.ocrEnabled),
        ocrServerUrl: parserConfig.ocrServerUrl || null,
        pages: normalizedPages,
      },
    };
    await writeCache(cachePath, payload);
    return payload;
  }

  async function getHealth(hermes) {
    const checks = [];
    const cacheDir = getCacheDirectory(hermes);
    checks.push({
      key: 'cache_dir',
      ok: Boolean(cacheDir),
      message: `cache directory resolved to ${cacheDir}`,
    });

    if (typeof createLiteParseInstance === 'function') {
      checks.push({
        key: 'liteparse_provider',
        ok: true,
        message: 'LiteParse provider injected by createLiteParseInstance',
      });
      return {
        parser: 'liteparse',
        ready: true,
        status: 'ready',
        checks,
        cacheDir,
      };
    }

    const platformPackage = getLiteParsePlatformPackage();
    checks.push({
      key: 'native_package',
      ok: Boolean(platformPackage),
      message: platformPackage
        ? `expected native package: ${platformPackage}`
        : `no known LiteParse native package for ${process.platform}/${process.arch}`,
    });

    try {
      const ctor = await loadLiteParseCtor();
      checks.push({
        key: 'liteparse_module',
        ok: typeof ctor === 'function',
        message: typeof ctor === 'function'
          ? `${LITEPARSE_PACKAGE_NAME} module loaded`
          : `${LITEPARSE_PACKAGE_NAME} module did not expose a parser constructor`,
      });
    } catch (error) {
      checks.push({
        key: 'liteparse_module',
        ok: false,
        message: error?.message || 'LiteParse module failed to load',
      });
    }

    const ready = checks.every(check => check.ok);
    return {
      parser: 'liteparse',
      ready,
      status: ready ? 'ready' : 'unavailable',
      checks,
      cacheDir,
    };
  }

  return {
    parseDocumentReference,
    isSupportedDocumentPath,
    parseDocument,
    getHealth,
  };
}
