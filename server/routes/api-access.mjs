export function registerApiAccessRoutes({
  app,
  express,
  apiAuthMiddleware,
  hermesContextMiddleware,
  sendDesktopHealth,
}) {
  app.get('/api/desktop/health', sendDesktopHealth);
  app.get('/api/builder/health', sendDesktopHealth);

  app.use('/api/voice/audio', apiAuthMiddleware, hermesContextMiddleware, (req, res, next) => {
    express.static(req.hermes.paths.voice)(req, res, next);
  });

  app.use('/api', apiAuthMiddleware);
  app.use('/api', hermesContextMiddleware);
}
