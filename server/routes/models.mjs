export function registerModelRoutes({ app, fetchProviderModels }) {
  app.get('/api/models', async (req, res) => {
    try {
      res.json(await fetchProviderModels(req.query?.provider));
    } catch {
      res.status(503).json({ models: [] });
    }
  });
}
