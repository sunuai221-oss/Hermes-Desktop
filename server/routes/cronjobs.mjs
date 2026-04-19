function respondWithRouteError(res, error, fallbackMessage) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  res.status(500).json({ error: fallbackMessage, details: error.message });
}

export function registerCronJobRoutes({ app, cronJobsService }) {
  app.get('/api/cronjobs', async (req, res) => {
    try {
      res.json(await cronJobsService.listCronJobs(req.hermes));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read cron jobs');
    }
  });

  app.post('/api/cronjobs', async (req, res) => {
    try {
      res.json(await cronJobsService.createCronJob(req.hermes, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not create cron job');
    }
  });

  app.patch('/api/cronjobs/:id', async (req, res) => {
    try {
      res.json(await cronJobsService.updateCronJob(req.hermes, req.params.id, req.body || {}));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not update cron job');
    }
  });

  app.post('/api/cronjobs/:id/pause', async (req, res) => {
    try {
      res.json(await cronJobsService.pauseCronJob(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not pause cron job');
    }
  });

  app.post('/api/cronjobs/:id/resume', async (req, res) => {
    try {
      res.json(await cronJobsService.resumeCronJob(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not resume cron job');
    }
  });

  app.post('/api/cronjobs/:id/run', async (req, res) => {
    try {
      res.json(await cronJobsService.runCronJob(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not mark cron job for run');
    }
  });

  app.post('/api/cronjobs/:id/remove', async (req, res) => {
    try {
      res.json(await cronJobsService.removeCronJob(req.hermes, req.params.id));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not remove cron job');
    }
  });

  app.get('/api/cronjobs/outputs', async (req, res) => {
    try {
      const jobId = req.query?.jobId ? String(req.query.jobId) : null;
      res.json(await cronJobsService.listCronOutputs(req.hermes, jobId));
    } catch (error) {
      respondWithRouteError(res, error, 'Could not read cron outputs');
    }
  });
}
