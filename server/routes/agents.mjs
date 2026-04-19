function respondWithRouteError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  res.status(500).json({ error: fallbackMessage, details: error.message });
}

export function registerAgentRoutes({ app, agentsService }) {
  app.get('/api/agents', async (req, res) => {
    try {
      res.json(await agentsService.readAgentProfiles(req.hermes));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read agent profiles');
    }
  });

  app.post('/api/agents', async (req, res) => {
    try {
      const profiles = Array.isArray(req.body?.profiles) ? req.body.profiles : [];
      await agentsService.writeAgentProfiles(req.hermes, profiles);
      res.json({ success: true, count: profiles.length });
    } catch (error) {
      respondWithRouteError(res, error, 'Could not write agent profiles');
    }
  });

  app.post('/api/agents/:id/apply', async (req, res) => {
    try {
      res.json(await agentsService.applyAgentProfile(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not apply agent profile');
    }
  });
}
