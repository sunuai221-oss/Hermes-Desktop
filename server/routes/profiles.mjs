async function exists(fs, targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyFileIfExists(fs, sourcePath, targetPath) {
  if (!(await exists(fs, sourcePath))) return false;
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

export function registerProfileRoutes({
  app,
  fs,
  path,
  yaml,
  gatewayManager,
  getHermesContext,
  hermesBase,
  localHermesStateHome,
  getHermesHome,
  resolveGatewayProcessStatus,
  resolveLocalAppStateDir,
  resolveProfilePaths,
  sanitizeProfileName,
  stateDbManager,
}) {
  app.get('/api/profiles/metadata', async (_req, res) => {
    try {
      const profilesDir = path.join(hermesBase, 'profiles');
      const profileNames = ['default'];
      const entries = await fs.readdir(profilesDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) profileNames.push(entry.name);
      }

      const results = [];
      for (const name of profileNames) {
        const context = await getHermesContext(name);
        let config = {};
        try {
          const configData = await fs.readFile(context.paths.config, 'utf-8');
          config = yaml.parse(configData);
        } catch {}

        const procStatus = await resolveGatewayProcessStatus(context, gatewayManager);

        results.push({
          name,
          isDefault: name === 'default',
          model: config?.model?.default || 'default',
          port: procStatus.port || context.gatewayPort || (name === 'default' ? 8642 : null),
          status: procStatus.status,
          managed: procStatus.managed,
          status_source: procStatus.status_source,
          home: procStatus.home,
        });
      }
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: 'Could not fetch profiles metadata', details: error.message });
    }
  });

  app.post('/api/profiles', async (req, res) => {
    try {
      const rawName = String(req.body?.name || '').trim();
      const name = sanitizeProfileName(rawName);
      if (!rawName || name === 'default' || rawName !== name) {
        return res.status(400).json({ error: 'Invalid profile name' });
      }
      const profileHome = getHermesHome(hermesBase, name);
      if (await exists(fs, profileHome)) {
        return res.status(409).json({ error: 'Profile already exists' });
      }
      await fs.mkdir(profileHome, { recursive: true });

      const paths = resolveProfilePaths(name, profileHome, localHermesStateHome);
      const defaultSoulPath = path.join(hermesBase, 'SOUL.md');
      const defaultConfigPath = path.join(hermesBase, 'config.yaml');
      const defaultEnvPath = path.join(hermesBase, '.env');
      const defaultAuthPath = path.join(hermesBase, 'auth.json');
      const defaultSoul = await fs.readFile(defaultSoulPath, 'utf-8').catch(() => '# Hermes');
      const defaultConfig = await fs.readFile(defaultConfigPath, 'utf-8').catch(() => '');

      await fs.writeFile(paths.soul, defaultSoul, 'utf-8');
      await fs.writeFile(paths.config, defaultConfig, 'utf-8');
      await copyFileIfExists(fs, defaultEnvPath, paths.env);
      await copyFileIfExists(fs, defaultAuthPath, path.join(profileHome, 'auth.json'));
      await fs.mkdir(paths.memories, { recursive: true });
      await fs.mkdir(paths.sessionsDir, { recursive: true });
      await fs.mkdir(paths.skills, { recursive: true });
      await fs.mkdir(paths.hooks, { recursive: true });
      await fs.mkdir(paths.cron, { recursive: true });
      await fs.mkdir(path.join(profileHome, 'logs'), { recursive: true });

      res.json({ success: true, name });
    } catch (error) {
      res.status(500).json({ error: 'Could not create profile', details: error.message });
    }
  });

  app.delete('/api/profiles/:name', async (req, res) => {
    try {
      const name = sanitizeProfileName(req.params.name);
      if (name === 'default') {
        return res.status(400).json({ error: 'Cannot delete default profile' });
      }
      const profileHome = getHermesHome(hermesBase, name);
      const stateDbPath = resolveProfilePaths(name, profileHome, localHermesStateHome).stateDb;
      const appStateDir = resolveLocalAppStateDir(name, localHermesStateHome);
      stateDbManager.closeStateDb(stateDbPath);

      if (profileHome.startsWith(hermesBase) && profileHome !== hermesBase) {
        await fs.rm(profileHome, { recursive: true, force: true });
      }
      if (appStateDir.startsWith(localHermesStateHome)) {
        await fs.rm(appStateDir, { recursive: true, force: true }).catch(() => {});
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Could not delete profile', details: error.message });
    }
  });
}
