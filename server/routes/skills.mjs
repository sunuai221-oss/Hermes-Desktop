function respondWithRouteError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  res.status(500).json({ error: fallbackMessage, details: error.message });
}

export function registerSkillRoutes({ app, skillsService }) {
  app.get('/api/skills', async (req, res) => {
    try {
      res.json(await skillsService.listSkills(req.hermes));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not list skills');
    }
  });

  app.post('/api/skills', async (req, res) => {
    try {
      const skill = await skillsService.createLocalSkill(req.hermes, req.body || {});
      res.json({ success: true, skill });
    } catch (error) {
      respondWithRouteError(res, error, 'Could not create local skill');
    }
  });

  app.get('/api/skills/content', async (req, res) => {
    try {
      res.json(await skillsService.readLocalSkill(req.hermes, String(req.query?.path || '')));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read local skill');
    }
  });

  app.put('/api/skills', async (req, res) => {
    try {
      const updated = await skillsService.updateLocalSkill(
        req.hermes,
        String(req.body?.path || ''),
        req.body?.content
      );
      res.json({ success: true, ...updated });
    } catch (error) {
      respondWithRouteError(res, error, 'Could not save local skill');
    }
  });

  app.delete('/api/skills', async (req, res) => {
    try {
      const removed = await skillsService.deleteLocalSkill(
        req.hermes,
        String(req.body?.path || req.query?.path || '')
      );
      res.json({ success: true, ...removed });
    } catch (error) {
      respondWithRouteError(res, error, 'Could not delete local skill');
    }
  });
}
