/**
 * Live2D model routes — serve and discover user-imported Live2D models.
 */

import path from 'path';

export function registerLive2dRoutes({ app, fs, expressStatic, hermesBase }) {
  const MODELS_REL = 'live2d-models';

  /**
   * GET /api/live2d/models
   * Returns user-imported model directories from ~/.hermes/live2d-models/.
   */
  app.get('/api/live2d/models', async (_req, res) => {
    try {
      const userModelsDir = path.resolve(hermesBase, MODELS_REL);
      const userModels = [];

      try {
        const entries = await fs.readdir(userModelsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const modelDir = path.join(userModelsDir, entry.name);
          const files = await fs.readdir(modelDir);
          const model2File = files.find(f => f.endsWith('.model.json'));
          const model3File = files.find(f => f.endsWith('.model3.json'));
          const modelFile = model3File || model2File;
          if (!modelFile) continue;

          userModels.push({
            id: `user-${entry.name}`,
            label: entry.name,
            description: 'Imported user model',
            modelUrl: `/api/live2d/user-models/${entry.name}/${modelFile}`,
            modelVersion: model3File ? 'cubism4' : 'cubism2',
            isUserModel: true,
          });
        }
      } catch (e) {
        if (e.code !== 'ENOENT') console.warn('[live2d] Failed to scan user models:', e.message);
      }

      res.json({ userModels });
    } catch (error) {
      res.status(500).json({ error: 'Could not list Live2D models', details: error.message });
    }
  });

  // Serve user model files statically
  const userModelsDir = path.resolve(hermesBase, MODELS_REL);
  app.use('/api/live2d/user-models', expressStatic(userModelsDir));
}
