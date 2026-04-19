export function registerContextReferenceRoutes({ app, contextReferenceService }) {
  app.post('/api/context-references/resolve', async (req, res) => {
    try {
      const refs = Array.isArray(req.body?.refs) ? req.body.refs : [];
      const resolved = [];
      for (const ref of refs) {
        try {
          resolved.push(await contextReferenceService.resolveContextReference(req.hermes, ref));
        } catch (error) {
          const value = String(ref || '');
          resolved.push({
            ref: value,
            kind: contextReferenceService.inferReferenceKind(value),
            label: value,
            content: '',
            warning: error.message,
            charCount: 0,
          });
        }
      }
      res.json(resolved);
    } catch (error) {
      res.status(500).json({ error: 'Could not resolve context references', details: error.message });
    }
  });
}
