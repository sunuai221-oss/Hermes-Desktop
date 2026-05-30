import assert from 'node:assert/strict';
import { test } from 'node:test';

import { registerAgentStudioRoutes } from '../routes/agent-studio.mjs';

function createRouteRecorder() {
  const routes = new Map();
  const register = (method) => (route, handler) => {
    routes.set(`${method} ${route}`, handler);
  };

  return {
    routes,
    app: {
      get: register('GET'),
      post: register('POST'),
      patch: register('PATCH'),
      delete: register('DELETE'),
    },
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('agent studio routes keep gateway execution non-persistent while wiring aggregate run persistence separately', async () => {
  const { app, routes } = createRouteRecorder();
  const callbackCalls = [];
  const sessionLifecycleCalls = [];
  const nonPersistentGateway = async () => ({ mode: 'non-persistent' });
  const persistedGateway = async () => ({ mode: 'persisted' });
  const startWorkspaceRunSession = async () => {
    sessionLifecycleCalls.push('start');
    return 'workspace-session';
  };
  const finishWorkspaceRunSession = async () => {
    sessionLifecycleCalls.push('finish');
  };

  const agentStudioService = {
    previewWorkspaceAutoConfig: async (_hermes, _workspaceId, _payload, runners) => {
      callbackCalls.push({
        route: 'auto-config',
        callback: runners.postGatewayChatCompletion,
        hasStartSession: typeof runners.startWorkspaceRunSession === 'function',
        hasFinishSession: typeof runners.finishWorkspaceRunSession === 'function',
      });
      return { success: true };
    },
    executeWorkspace: async (_hermes, _workspaceId, _payload, runners) => {
      callbackCalls.push({
        route: 'execute',
        callback: runners.postGatewayChatCompletion,
        hasStartSession: typeof runners.startWorkspaceRunSession === 'function',
        hasFinishSession: typeof runners.finishWorkspaceRunSession === 'function',
        hasDocumentParserService: Boolean(runners.documentParserService),
        hasOpenPandasAiService: Boolean(runners.openPandasAiService),
      });
      return { success: true };
    },
    runWorkspaceTask: async (_hermes, _workspaceId, _payload, runners) => {
      callbackCalls.push({
        route: 'run',
        callback: runners.postGatewayChatCompletion,
        hasStartSession: typeof runners.startWorkspaceRunSession === 'function',
        hasFinishSession: typeof runners.finishWorkspaceRunSession === 'function',
        hasDocumentParserService: Boolean(runners.documentParserService),
        hasOpenPandasAiService: Boolean(runners.openPandasAiService),
      });
      return { success: true };
    },
  };

  registerAgentStudioRoutes({
    app,
    agentStudioService,
    getHermesContext: async () => ({ profile: 'default' }),
    postGatewayChatCompletion: nonPersistentGateway,
    postPersistedGatewayChatCompletion: persistedGateway,
    documentParserService: { parseDocument: async () => ({ content: 'ok' }) },
    openPandasAiService: { startAnalysis: async () => ({ runId: 'run-1' }), getRun: async () => ({ status: 'succeeded' }) },
    startWorkspaceRunSession,
    finishWorkspaceRunSession,
  });

  const req = { hermes: { profile: 'default' }, params: { id: 'workspace-1' }, body: {} };

  await routes.get('POST /api/agent-studio/workspaces/:id/run')(req, createResponseRecorder());
  await routes.get('POST /api/agent-studio/workspaces/:id/chat')(req, createResponseRecorder());
  await routes.get('POST /api/agent-studio/workspaces/:id/execute')(req, createResponseRecorder());
  await routes.get('POST /api/agent-studio/workspaces/:id/auto-config')(req, createResponseRecorder());

  assert.deepEqual(
    callbackCalls.map(entry => ({
      route: entry.route,
      isNonPersistent: entry.callback === nonPersistentGateway,
      isPersisted: entry.callback === persistedGateway,
      hasStartSession: entry.hasStartSession,
      hasFinishSession: entry.hasFinishSession,
      hasDocumentParserService: entry.hasDocumentParserService ?? false,
      hasOpenPandasAiService: entry.hasOpenPandasAiService ?? false,
    })),
    [
      { route: 'run', isNonPersistent: true, isPersisted: false, hasStartSession: true, hasFinishSession: true, hasDocumentParserService: true, hasOpenPandasAiService: true },
      { route: 'run', isNonPersistent: true, isPersisted: false, hasStartSession: true, hasFinishSession: true, hasDocumentParserService: true, hasOpenPandasAiService: true },
      { route: 'execute', isNonPersistent: true, isPersisted: false, hasStartSession: true, hasFinishSession: true, hasDocumentParserService: true, hasOpenPandasAiService: true },
      { route: 'auto-config', isNonPersistent: false, isPersisted: true, hasStartSession: false, hasFinishSession: false, hasDocumentParserService: false, hasOpenPandasAiService: false },
    ],
  );
  assert.deepEqual(sessionLifecycleCalls, []);
});
