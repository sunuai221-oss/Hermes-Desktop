function toStringOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function sendPawrtalResult(res, result) {
  const status = result?.ok === false && Number.isInteger(result?.httpStatus)
    ? result.httpStatus
    : 200;
  res.status(status).json(result);
}

function sendPawrtalRouteError(res, error, fallback) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  res.status(status).json({
    ok: false,
    errorCode: error?.code || 'pawrtal_route_error',
    error: fallback,
    details: error?.message || String(error || fallback),
  });
}

export function registerPawrtalRoutes({ app, pawrtalService }) {
  app.get('/api/pawrtal/list', async (req, res) => {
    try {
      sendPawrtalResult(res, await pawrtalService.listCompanions(req.hermes));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not list Pawrtal companions.');
    }
  });

  app.get('/api/pawrtal/status', async (req, res) => {
    try {
      const session = toStringOrNull(req.query?.session) || 'current';
      sendPawrtalResult(res, await pawrtalService.readStatus(req.hermes, session));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not read Pawrtal status.');
    }
  });

  app.post('/api/pawrtal/use', async (req, res) => {
    try {
      const petId = toStringOrNull(req.body?.petId);
      const session = toStringOrNull(req.body?.session) || 'current';
      sendPawrtalResult(res, await pawrtalService.useCompanion(req.hermes, { petId, session }));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not select Pawrtal companion.');
    }
  });

  app.post('/api/pawrtal/spawn', async (req, res) => {
    try {
      const petId = toStringOrNull(req.body?.petId);
      const session = toStringOrNull(req.body?.session) || 'current';
      sendPawrtalResult(res, await pawrtalService.spawnCompanion(req.hermes, { petId, session }));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not spawn Pawrtal companion.');
    }
  });

  app.post('/api/pawrtal/vanish', async (req, res) => {
    try {
      const petId = toStringOrNull(req.body?.petId);
      const session = toStringOrNull(req.body?.session) || 'current';
      sendPawrtalResult(res, await pawrtalService.vanishCompanion(req.hermes, { petId, session }));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not vanish Pawrtal companion.');
    }
  });

  app.post('/api/pawrtal/switch', async (req, res) => {
    try {
      const petId = toStringOrNull(req.body?.petId);
      const session = toStringOrNull(req.body?.session) || 'current';
      sendPawrtalResult(res, await pawrtalService.switchCompanion(req.hermes, { petId, session }));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not switch Pawrtal companion.');
    }
  });

  app.post('/api/pawrtal/reset', async (req, res) => {
    try {
      const petId = toStringOrNull(req.body?.petId);
      const session = toStringOrNull(req.body?.session) || 'current';
      sendPawrtalResult(res, await pawrtalService.resetCompanion(req.hermes, { petId, session }));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not reset Pawrtal companion.');
    }
  });

  app.post('/api/pawrtal/autostart', async (req, res) => {
    try {
      const petId = toStringOrNull(req.body?.petId);
      const session = toStringOrNull(req.body?.session) || 'current';
      const resetBeforeSpawn = req.body?.resetBeforeSpawn !== false;
      sendPawrtalResult(res, await pawrtalService.autoStart(req.hermes, { petId, session, resetBeforeSpawn }));
    } catch (error) {
      sendPawrtalRouteError(res, error, 'Could not autostart Pawrtal companion.');
    }
  });
}
