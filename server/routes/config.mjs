export function registerConfigRoutes({ app, runtimeFilesService }) {
  app.get('/api/config', async (req, res) => {
    try {
      res.json(await runtimeFilesService.readYamlConfig(req.hermes));
    } catch {
      res.status(500).json({ error: 'Could not read config.yaml' });
    }
  });

  app.post('/api/config', async (req, res) => {
    try {
      await runtimeFilesService.writeYamlConfig(req.hermes, req.body);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Could not write config.yaml' });
    }
  });
}
