function respondWithRouteError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  res.status(500).json({ error: fallbackMessage, details: error.message });
}

export function registerAgentStudioRoutes({ app, agentStudioService, getHermesContext, postGatewayChatCompletion }) {
  app.get('/api/agent-studio/library', async (req, res) => {
    try {
      res.json(await agentStudioService.readLibrary(req.hermes));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read agent studio library');
    }
  });

  app.post('/api/agent-studio/library/import-agency', async (req, res) => {
    try {
      res.json(await agentStudioService.importAgencyAgents(req.hermes, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not import agency agents');
    }
  });

  app.post('/api/agent-studio/library', async (req, res) => {
    try {
      res.json(await agentStudioService.createAgent(req.hermes, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not create agent definition');
    }
  });

  app.patch('/api/agent-studio/library/:id', async (req, res) => {
    try {
      res.json(await agentStudioService.updateAgent(req.hermes, req.params.id, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not update agent definition');
    }
  });

  app.post('/api/agent-studio/library/preferred-skills', async (req, res) => {
    try {
      res.json(await agentStudioService.updatePreferredSkills(req.hermes, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not update preferred skills');
    }
  });

  app.delete('/api/agent-studio/library/:id', async (req, res) => {
    try {
      res.json(await agentStudioService.deleteAgent(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not delete agent definition');
    }
  });

  app.post('/api/agent-studio/library/:id/apply', async (req, res) => {
    try {
      res.json(await agentStudioService.applyAgent(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not apply agent definition');
    }
  });

  app.get('/api/agent-studio/workspaces', async (req, res) => {
    try {
      res.json(await agentStudioService.readWorkspaces(req.hermes));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read agent studio workspaces');
    }
  });

  app.post('/api/agent-studio/workspaces', async (req, res) => {
    try {
      res.json(await agentStudioService.createWorkspace(req.hermes, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not create workspace');
    }
  });

  app.patch('/api/agent-studio/workspaces/:id', async (req, res) => {
    try {
      res.json(await agentStudioService.updateWorkspace(req.hermes, req.params.id, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not update workspace');
    }
  });

  app.delete('/api/agent-studio/workspaces/:id', async (req, res) => {
    try {
      res.json(await agentStudioService.deleteWorkspace(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not delete workspace');
    }
  });

  app.post('/api/agent-studio/workspaces/:id/generate-prompt', async (req, res) => {
    try {
      res.json(await agentStudioService.generateWorkspacePrompt(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not generate workspace prompt');
    }
  });

  app.post('/api/agent-studio/workspaces/:id/auto-config', async (req, res) => {
    try {
      res.json(await agentStudioService.previewWorkspaceAutoConfig(req.hermes, req.params.id, req.body || {}, {
        postGatewayChatCompletion,
      }));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not auto-configure workspace');
    }
  });

  app.post('/api/agent-studio/workspaces/:id/execute', async (req, res) => {
    try {
      res.json(await agentStudioService.executeWorkspace(req.hermes, req.params.id, req.body || {}, {
        getHermesContext,
        postGatewayChatCompletion,
      }));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not execute workspace');
    }
  });

  app.post('/api/agent-studio/workspaces/:id/chat', async (req, res) => {
    try {
      res.json(await agentStudioService.chatWorkspace(req.hermes, req.params.id, req.body || {}, {
        getHermesContext,
        postGatewayChatCompletion,
      }));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not run workspace chat');
    }
  });
}
