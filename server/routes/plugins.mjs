export function registerPluginRoutes({ app, pluginsService }) {
  app.get('/api/plugins', async (req, res) => {
    try {
      res.json(await pluginsService.listPlugins(req.hermes));
    } catch (error) {
      res.status(500).json({ error: 'Could not list plugins', details: error.message });
    }
  });
}
