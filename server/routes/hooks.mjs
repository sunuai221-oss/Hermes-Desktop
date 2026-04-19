export function registerHookRoutes({ app, skillsService }) {
  app.get('/api/hooks', async (req, res) => {
    try {
      res.json(await skillsService.listGatewayHooks(req.hermes));
    } catch (error) {
      res.status(500).json({ error: 'Could not list hooks', details: error.message });
    }
  });
}
