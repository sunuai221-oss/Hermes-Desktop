import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createDocumentParserService } from '../services/document-parser.mjs';

async function withTempWorkspace(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-document-parser-'));
  const workspaceRoot = path.join(tempDir, 'workspace');
  const appStateDir = path.join(tempDir, 'app-state');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(appStateDir, { recursive: true });
  const hermes = { paths: { appState: appStateDir } };
  try {
    await run({ tempDir, workspaceRoot, hermes, appStateDir });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test('document parser service parses inline @document options', () => {
  const service = createDocumentParserService({
    fs,
    path,
    createHash,
    workspaceRoot: process.cwd(),
    createLiteParseInstance: () => ({ parse: async () => ({ pages: [], text: '' }) }),
  });

  const parsed = service.parseDocumentReference('docs/report.pdf?ocr=false&ocrLanguage=fra&maxPages=5&targetPages=1-2&dpi=300');
  assert.equal(parsed.pathValue, 'docs/report.pdf');
  assert.equal(parsed.options.ocrEnabled, false);
  assert.equal(parsed.options.ocrLanguage, 'fra');
  assert.equal(parsed.options.maxPages, '5');
  assert.equal(parsed.options.targetPages, '1-2');
  assert.equal(parsed.options.dpi, '300');
});

test('document parser service recognizes supported document extensions', () => {
  const service = createDocumentParserService({
    fs,
    path,
    createHash,
    workspaceRoot: process.cwd(),
    createLiteParseInstance: () => ({ parse: async () => ({ pages: [], text: '' }) }),
  });

  assert.equal(service.isSupportedDocumentPath('/tmp/a.pdf'), true);
  assert.equal(service.isSupportedDocumentPath('/tmp/a.png'), true);
  assert.equal(service.isSupportedDocumentPath('/tmp/a.docx'), true);
  assert.equal(service.isSupportedDocumentPath('/tmp/a.exe'), false);
});

test('document parser service caches parse output by file fingerprint and options', async () => {
  await withTempWorkspace(async ({ workspaceRoot, hermes, appStateDir }) => {
    const documentPath = path.join(workspaceRoot, 'report.pdf');
    await fs.writeFile(documentPath, 'fake pdf bytes', 'utf-8');

    let parseCalls = 0;
    let receivedConfig = null;
    const service = createDocumentParserService({
      fs,
      path,
      createHash,
      workspaceRoot,
      createLiteParseInstance: (config) => {
        receivedConfig = config;
        return {
          async parse() {
            parseCalls += 1;
            return {
              text: 'Revenue grew by 12%',
              pages: [{
                pageNum: 1,
                width: 1000,
                height: 1400,
                text: 'Revenue grew by 12%',
                textItems: [
                  { text: 'Revenue', x: 10, y: 10, width: 30, height: 10 },
                  { text: '12%', x: 50, y: 10, width: 15, height: 10 },
                ],
              }],
            };
          },
        };
      },
    });

    const first = await service.parseDocument(hermes, {
      referenceValue: 'report.pdf?ocr=true&ocrLanguage=eng&dpi=200',
      resolvedPath: documentPath,
      maxChars: 5000,
    });
    const second = await service.parseDocument(hermes, {
      referenceValue: 'report.pdf?ocr=true&ocrLanguage=eng&dpi=200',
      resolvedPath: documentPath,
      maxChars: 5000,
    });

    assert.equal(parseCalls, 1);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(first.meta.pageCount, 1);
    assert.equal(first.meta.pages[0].textItems.length, 2);
    assert.equal(receivedConfig.ocrEnabled, true);
    assert.equal(receivedConfig.ocrLanguage, 'eng');
    assert.equal(receivedConfig.dpi, 200);

    const cacheRoot = path.join(appStateDir, 'document-cache');
    const cacheFiles = await fs.readdir(cacheRoot);
    assert.equal(cacheFiles.length > 0, true);
  });
});

test('document parser service exposes health metadata for LiteParse runtime', async () => {
  await withTempWorkspace(async ({ workspaceRoot, hermes }) => {
    const service = createDocumentParserService({
      fs,
      path,
      createHash,
      workspaceRoot,
      createLiteParseInstance: () => ({ parse: async () => ({ pages: [], text: '' }) }),
    });

    const health = await service.getHealth(hermes);
    assert.equal(health.parser, 'liteparse');
    assert.equal(health.ready, true);
    assert.equal(health.status, 'ready');
    assert.equal(Array.isArray(health.checks), true);
    assert.equal(health.checks.some(check => check.key === 'liteparse_provider' && check.ok), true);
  });
});
