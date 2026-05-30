import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

import express from 'express';

import { registerOpenPandasAiRoutes } from '../routes/open-pandas-ai.mjs';
import { createOpenPandasAiService } from '../services/open-pandas-ai.mjs';

async function withTempDir(prefix, run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(tempDir);
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code) || attempt === 4) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  }
}

function makeHermes(tempDir) {
  const appState = path.join(tempDir, '.hermes-builder');
  return {
    home: path.join(tempDir, '.hermes'),
    paths: {
      appState,
      config: path.join(tempDir, '.hermes', 'config.yaml'),
    },
  };
}

async function waitForRunDone(service, hermes, runId, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await service.getRun(hermes, runId);
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} did not finish within ${timeoutMs}ms`);
}

async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

test('open-pandas-ai service returns disabled status when connector is off', async () => {
  await withTempDir('hermes-opa-status-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      runtimeFilesService: {
        async readYamlConfig() {
          return { open_pandas_ai: { enabled: false } };
        },
      },
    });

    const status = await service.getStatus(hermes);
    assert.equal(status.status, 'disabled');
    assert.equal(status.mode, 'cli');
  });
});

test('open-pandas-ai service runs CLI analyses and stores run output', async () => {
  await withTempDir('hermes-opa-cli-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (command, args, options) => {
        assert.equal(command, 'python');
        assert.equal(args[0], '-m');
        assert.equal(args[1], 'core.headless.cli');
        assert.equal(options.cwd, projectPath);
        assert.equal(options.windowsHide, true);

        const datasetPath = args[3];
        const outputPath = args[args.indexOf('--output') + 1];
        const optionsPath = args[args.indexOf('--options-file') + 1];

        const datasetRaw = await fs.readFile(datasetPath, 'utf-8');
        assert.match(datasetRaw, /region,sales/);
        const parsedOptions = JSON.parse(await fs.readFile(optionsPath, 'utf-8'));
        assert.equal(parsedOptions.language, 'fr');

        const payload = {
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: {
            text: 'Top region is North',
            interpretation: '',
            quality_score: 88,
            key_metrics: [],
          },
          generated_code: 'result = df.groupby("region")["sales"].sum()',
          dataframe_preview: {
            type: 'dataframe',
            shape: [2, 2],
            columns: ['region', 'sales'],
            head: [
              { region: 'North', sales: 1200 },
              { region: 'South', sales: 900 },
            ],
            summary: {},
          },
          charts: [],
          errors: null,
          warnings: [],
          metrics: {},
          dataset: {
            path: datasetPath,
            name: 'sales',
            rows: 2,
            columns: ['region', 'sales'],
            shape: [2, 2],
            active_sheet: null,
            workbook_meta: {},
          },
          run: {
            run_id: 'run_123',
            question: args[2],
            error_stage: null,
            provider: null,
            model: null,
          },
        };
        await fs.writeFile(outputPath, JSON.stringify(payload), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
            },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Top sales by region',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\nSouth,900\n', 'utf-8').toString('base64'),
      },
      options: {
        language: 'fr',
      },
    });

    assert.match(started.runId, /^opa_/);
    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'succeeded');
    assert.equal(run.engineStatus, 'success');
    assert.equal(run.result?.summary?.text, 'Top region is North');
    assert.equal(Array.isArray(run.logs), true);
    assert.equal(run.logs.length > 0, true);
  });
});

test('open-pandas-ai service accepts optional PDF context and injects parsed text into run options', async () => {
  await withTempDir('hermes-opa-document-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    let parseCalled = false;
    let parsedPath = '';
    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (_command, args, options) => {
        assert.equal(options.cwd, projectPath);
        const cliQuestion = args[2];
        const outputPath = args[args.indexOf('--output') + 1];
        const optionsPath = args[args.indexOf('--options-file') + 1];
        const parsedOptions = JSON.parse(await fs.readFile(optionsPath, 'utf-8'));

        assert.match(cliQuestion, /Document context \(briefing\.pdf\):/);
        assert.equal(parsedOptions.document_context.source, 'briefing.pdf');
        assert.equal(typeof parsedOptions.document_context.text, 'string');
        assert.equal(parsedOptions.document_context.page_count, 2);

        const payload = {
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: { text: 'ok' },
          dataframe_preview: { type: 'dataframe', columns: [], head: [] },
          charts: [],
          errors: null,
          warnings: [],
        };
        await fs.writeFile(outputPath, JSON.stringify(payload), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
            },
          };
        },
      },
      documentParserService: {
        async parseDocument(_targetHermes, payload) {
          parseCalled = true;
          parsedPath = payload.resolvedPath;
          return {
            content: 'Executive briefing extracted text',
            charCount: 31,
            meta: { pageCount: 2 },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze sales trends',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\nSouth,900\n', 'utf-8').toString('base64'),
      },
      document: {
        fileName: 'briefing.pdf',
        base64: Buffer.from('%PDF-1.7 fake').toString('base64'),
      },
      options: {
        language: 'fr',
      },
    });

    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'succeeded');
    assert.equal(parseCalled, true);
    assert.match(parsedPath, /briefing\.pdf$/);
    assert.equal(run.document?.fileName, 'briefing.pdf');
    assert.equal(run.document?.pageCount, 2);
  });
});

test('open-pandas-ai service falls back to dataset-only mode when optional document parsing fails', async () => {
  await withTempDir('hermes-opa-document-fallback-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (_command, args, options) => {
        assert.equal(options.cwd, projectPath);
        const cliQuestion = args[2];
        const outputPath = args[args.indexOf('--output') + 1];
        const optionsPath = args[args.indexOf('--options-file') + 1];
        const parsedOptions = JSON.parse(await fs.readFile(optionsPath, 'utf-8'));

        assert.equal(cliQuestion, 'Analyze sales trends');
        assert.equal(parsedOptions.document_context, undefined);

        const payload = {
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: { text: 'ok' },
          dataframe_preview: { type: 'dataframe', columns: [], head: [] },
          charts: [],
          errors: null,
          warnings: [],
        };
        await fs.writeFile(outputPath, JSON.stringify(payload), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
            },
          };
        },
      },
      documentParserService: {
        async parseDocument() {
          throw new Error('OCR engine offline');
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze sales trends',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\nSouth,900\n', 'utf-8').toString('base64'),
      },
      document: {
        fileName: 'briefing.pdf',
        base64: Buffer.from('%PDF-1.7 fake').toString('base64'),
      },
    });

    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'succeeded');
    assert.match(String(run.document?.warning || ''), /document context skipped/i);
    assert.equal(run.error, null);
  });
});

test('open-pandas-ai service can require document parsing when strict mode is enabled', async () => {
  await withTempDir('hermes-opa-document-strict-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
            },
          };
        },
      },
      documentParserService: {
        async parseDocument() {
          throw new Error('OCR engine offline');
        },
      },
    });

    await assert.rejects(
      () => service.startAnalysis(hermes, {
        question: 'Analyze sales trends',
        require_document_context: true,
        dataset: {
          fileName: 'sales.csv',
          base64: Buffer.from('region,sales\nNorth,1200\nSouth,900\n', 'utf-8').toString('base64'),
        },
        document: {
          fileName: 'briefing.pdf',
          base64: Buffer.from('%PDF-1.7 fake').toString('base64'),
        },
      }),
      error => error?.statusCode === 422 && /OCR engine offline/i.test(error.message),
    );
  });
});

test('open-pandas-ai service status keeps connector ready when LiteParse is unavailable', async () => {
  await withTempDir('hermes-opa-status-liteparse-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
            },
          };
        },
      },
      documentParserService: null,
    });

    const status = await service.getStatus(hermes);
    assert.equal(status.status, 'ready');
    assert.equal(typeof status.log_path, 'string');
    const liteparseCheck = status.checks.find(check => check.key === 'liteparse');
    assert.equal(Boolean(liteparseCheck), true);
    assert.equal(liteparseCheck?.required, false);
    assert.equal(liteparseCheck?.ok, false);
  });
});

test('open-pandas-ai service persists dedicated connector logs', async () => {
  await withTempDir('hermes-opa-logs-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (_command, args) => {
        const outputPath = args[args.indexOf('--output') + 1];
        await fs.writeFile(outputPath, JSON.stringify({
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: { text: 'ok' },
          dataframe_preview: { type: 'dataframe', columns: [], head: [] },
          charts: [],
          errors: null,
          warnings: [],
        }), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
            },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze sales trends',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\nSouth,900\n', 'utf-8').toString('base64'),
      },
    });
    await waitForRunDone(service, hermes, started.runId);

    const logs = await service.getLogs(hermes, 120);
    assert.match(logs.path, /open-pandas-ai\.log$/);
    assert.equal(logs.lineCount > 0, true);
    assert.match(logs.content, /Run completed with engine status: success/);
  });
});

test('open-pandas-ai service rejects unsupported dataset extensions', async () => {
  await withTempDir('hermes-opa-invalid-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: tempDir,
              python_executable: 'python',
            },
          };
        },
      },
    });

    await assert.rejects(
      () => service.startAnalysis(hermes, {
        question: 'Analyze',
        dataset: {
          fileName: 'secret.exe',
          base64: Buffer.from('abc').toString('base64'),
        },
      }),
      error => error?.statusCode === 400 && /Unsupported dataset extension/.test(error.message),
    );
  });
});

test('open-pandas-ai service rejects oversized questions', async () => {
  await withTempDir('hermes-opa-question-limit-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
              max_question_chars: 128,
            },
          };
        },
      },
    });

    await assert.rejects(
      () => service.startAnalysis(hermes, {
        question: 'Q'.repeat(129),
        dataset: {
          fileName: 'sales.csv',
          base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
        },
      }),
      error => error?.statusCode === 413 && /question exceeds 128/.test(error.message),
    );
  });
});

test('open-pandas-ai service blocks sensitive paths in options', async () => {
  await withTempDir('hermes-opa-path-guard-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
              strict_path_guard: true,
            },
          };
        },
      },
    });

    await assert.rejects(
      () => service.startAnalysis(hermes, {
        question: 'Analyze',
        dataset: {
          fileName: 'sales.csv',
          base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
        },
        options: {
          source_path: '/etc/passwd',
        },
      }),
      error => error?.statusCode === 400 && /sensitive\/system path/.test(error.message),
    );
  });
});

test('open-pandas-ai service enforces output size limits', async () => {
  await withTempDir('hermes-opa-output-limit-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (_command, args) => {
        const outputPath = args[args.indexOf('--output') + 1];
        const payload = {
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: { text: 'x'.repeat(1000) },
          dataframe_preview: { type: 'dataframe', columns: [], head: [] },
          charts: [],
          errors: null,
          warnings: [],
        };
        await fs.writeFile(outputPath, JSON.stringify(payload), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
              max_output_bytes: 256,
            },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
      },
    });

    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'failed');
    assert.equal(run.error?.statusCode, 413);
    assert.match(String(run.error?.message || ''), /output exceeds/i);
  });
});

test('open-pandas-ai service applies sandbox environment variables for CLI runs', async () => {
  await withTempDir('hermes-opa-sandbox-env-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    let capturedEnv = null;
    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (_command, args, options) => {
        capturedEnv = options.env;
        const outputPath = args[args.indexOf('--output') + 1];
        await fs.writeFile(outputPath, JSON.stringify({
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: { text: 'ok' },
          dataframe_preview: { type: 'dataframe', columns: [], head: [] },
          charts: [],
          errors: null,
          warnings: [],
        }), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
              sandbox_enabled: true,
              memory_limit_mb: 768,
            },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
      },
    });

    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'succeeded');
    assert.equal(capturedEnv.HERMES_OPEN_PANDAS_SANDBOX, '1');
    assert.equal(capturedEnv.HERMES_OPEN_PANDAS_MEMORY_LIMIT_MB, '768');
    const expectedRunRoot = path.join(hermes.paths.appState, 'open-pandas-ai', 'runs', started.runId);
    assert.equal(
      path.normalize(capturedEnv.HERMES_OPEN_PANDAS_SANDBOX_ROOT),
      path.normalize(path.join(expectedRunRoot, 'sandbox')),
    );
    assert.equal(
      path.normalize(capturedEnv.HERMES_OPEN_PANDAS_ALLOWED_ROOT),
      path.normalize(expectedRunRoot),
    );
  });
});

test('open-pandas-ai service cleans run artifacts when cleanup is enabled', async () => {
  await withTempDir('hermes-opa-cleanup-on-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (_command, args) => {
        const outputPath = args[args.indexOf('--output') + 1];
        await fs.writeFile(outputPath, JSON.stringify({
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: { text: 'ok' },
          dataframe_preview: { type: 'dataframe', columns: [], head: [] },
          charts: [],
          errors: null,
          warnings: [],
        }), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
              cleanup_run_artifacts: true,
            },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
      },
    });

    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'succeeded');
    const runRoot = path.join(hermes.paths.appState, 'open-pandas-ai', 'runs', started.runId);
    assert.equal(await pathExists(runRoot), false);
  });
});

test('open-pandas-ai service can preserve run artifacts when cleanup is disabled', async () => {
  await withTempDir('hermes-opa-cleanup-off-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async (_command, args) => {
        const outputPath = args[args.indexOf('--output') + 1];
        await fs.writeFile(outputPath, JSON.stringify({
          contract_version: 'open_pandas_ai.headless.v1',
          status: 'success',
          summary: { text: 'ok' },
          dataframe_preview: { type: 'dataframe', columns: [], head: [] },
          charts: [],
          errors: null,
          warnings: [],
        }), 'utf-8');
        return { stdout: '', stderr: '' };
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
              cleanup_run_artifacts: false,
            },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
      },
    });

    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'succeeded');

    const runRoot = path.join(hermes.paths.appState, 'open-pandas-ai', 'runs', started.runId);
    assert.equal(await pathExists(runRoot), true);
    assert.equal(await pathExists(path.join(runRoot, 'input', 'sales.csv')), true);
    assert.equal(await pathExists(path.join(runRoot, 'output.json')), true);
    assert.equal(await pathExists(path.join(runRoot, 'options.json')), false);
  });
});

test('open-pandas-ai service redacts secrets from run logs and service logs', async () => {
  await withTempDir('hermes-opa-redact-', async tempDir => {
    const hermes = makeHermes(tempDir);
    const projectPath = path.join(tempDir, 'open-pandas-ai');
    await fs.mkdir(projectPath, { recursive: true });

    const secret = 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
    const bearerSecret = 'Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const service = createOpenPandasAiService({
      fs,
      path,
      axios: {},
      execFileAsync: async () => {
        const error = new Error(`Execution failed with token ${secret}`);
        error.stderr = `OPENAI_API_KEY=${secret}\nAuthorization: ${bearerSecret}`;
        throw error;
      },
      runtimeFilesService: {
        async readYamlConfig() {
          return {
            open_pandas_ai: {
              enabled: true,
              mode: 'cli',
              project_path: projectPath,
              python_executable: 'python',
              sanitize_logs: true,
            },
          };
        },
      },
    });

    const started = await service.startAnalysis(hermes, {
      question: 'Analyze',
      dataset: {
        fileName: 'sales.csv',
        base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
      },
    });
    const run = await waitForRunDone(service, hermes, started.runId);
    assert.equal(run.status, 'failed');
    const runLogText = run.logs.map(entry => entry.message).join('\n');
    assert.equal(runLogText.includes(secret), false);
    assert.equal(runLogText.includes(bearerSecret), false);
    assert.equal(runLogText.includes('[REDACTED]'), true);

    const logs = await service.getLogs(hermes, 200);
    assert.equal(logs.content.includes(secret), false);
    assert.equal(logs.content.includes(bearerSecret), false);
    assert.equal(logs.content.includes('[REDACTED]'), true);
  });
});

test('open-pandas-ai routes expose status, start, and run endpoints', async () => {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use((req, _res, next) => {
    req.hermes = makeHermes(process.cwd());
    next();
  });

  registerOpenPandasAiRoutes({
    app,
    openPandasAiService: {
      async getStatus() {
        return { status: 'ready', mode: 'cli', checks: [], config: { enabled: true } };
      },
      async startAnalysis(_hermes, payload) {
        assert.equal(payload.question, 'What is total revenue?');
        return { runId: 'opa_test_1', status: 'queued', createdAt: new Date().toISOString() };
      },
      async getRun(_hermes, runId) {
        assert.equal(runId, 'opa_test_1');
        return { runId, status: 'succeeded', engineStatus: 'success', logs: [] };
      },
      async getLogs(_hermes, lines) {
        assert.equal(lines, 200);
        return {
          path: 'C:\\logs\\open-pandas-ai.log',
          lineCount: 1,
          totalLines: 1,
          content: '{"level":"info","message":"ok"}',
        };
      },
    },
  });

  const server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const statusResponse = await fetch(`${baseUrl}/api/open-pandas-ai/status`);
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).status, 'ready');

    const startResponse = await fetch(`${baseUrl}/api/open-pandas-ai/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'What is total revenue?',
        dataset: {
          fileName: 'sales.csv',
          base64: Buffer.from('region,sales\nNorth,1200\n', 'utf-8').toString('base64'),
        },
      }),
    });
    assert.equal(startResponse.status, 202);
    assert.equal((await startResponse.json()).runId, 'opa_test_1');

    const runResponse = await fetch(`${baseUrl}/api/open-pandas-ai/runs/opa_test_1`);
    assert.equal(runResponse.status, 200);
    assert.equal((await runResponse.json()).status, 'succeeded');

    const logsResponse = await fetch(`${baseUrl}/api/open-pandas-ai/logs`);
    assert.equal(logsResponse.status, 200);
    assert.equal((await logsResponse.json()).lineCount, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
