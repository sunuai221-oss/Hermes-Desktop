function respondWithRouteError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  return res.status(500).json({
    error: fallbackMessage,
    details: error?.message || String(error),
  });
}

export function registerOpenPandasAiRoutes({ app, openPandasAiService }) {
  app.get('/api/open-pandas-ai/status', async (req, res) => {
    try {
      res.json(await openPandasAiService.getStatus(req.hermes));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read Open_Pandas_AI connector status');
    }
  });

  app.post('/api/open-pandas-ai/analyze', async (req, res) => {
    try {
      const result = await openPandasAiService.startAnalysis(req.hermes, req.body || {});
      res.status(202).json(result);
    } catch (error) {
      respondWithRouteError(res, error, 'Could not start Open_Pandas_AI analysis');
    }
  });

  app.get('/api/open-pandas-ai/runs/:runId', async (req, res) => {
    try {
      res.json(await openPandasAiService.getRun(req.hermes, req.params.runId));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not fetch Open_Pandas_AI run');
    }
  });

  app.get('/api/open-pandas-ai/logs', async (req, res) => {
    try {
      const lines = Number(req.query?.lines || 200);
      res.json(await openPandasAiService.getLogs(req.hermes, lines));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read Open_Pandas_AI logs');
    }
  });
}
