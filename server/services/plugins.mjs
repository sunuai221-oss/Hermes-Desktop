function createPathExists(fs) {
  return async function pathExists(targetPath) {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  };
}

export function createPluginsService({
  fs,
  path,
  yaml,
  readConfigForSkills,
  workspaceRoot,
}) {
  const pathExists = createPathExists(fs);

  async function listPlugins(hermes) {
    const config = await readConfigForSkills(hermes);
    const disabled = new Set(config?.plugins?.disabled || []);
    const projectPluginsEnabled = String(process.env.HERMES_ENABLE_PROJECT_PLUGINS || '').toLowerCase() === 'true';
    const roots = [
      { dir: path.join(hermes.home, 'plugins'), source: 'user', enabledByPolicy: true },
      { dir: path.join(workspaceRoot, '.hermes', 'plugins'), source: 'project', enabledByPolicy: projectPluginsEnabled },
    ];
    const results = [];

    for (const root of roots) {
      if (!(await pathExists(root.dir))) continue;
      const entries = await fs.readdir(root.dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = path.join(root.dir, entry.name);
        const manifestPath = path.join(pluginDir, 'plugin.yaml');
        if (!(await pathExists(manifestPath))) continue;

        const manifestRaw = await fs.readFile(manifestPath, 'utf-8').catch(() => '');
        const manifest = manifestRaw ? (yaml.parse(manifestRaw) || {}) : {};
        const pluginName = manifest.name || entry.name;

        results.push({
          name: pluginName,
          version: manifest.version,
          description: manifest.description,
          path: pluginDir,
          source: root.source,
          enabled: root.enabledByPolicy && !disabled.has(pluginName),
          requiresEnv: manifest.requires_env || [],
          hasInitPy: await pathExists(path.join(pluginDir, '__init__.py')),
          hasSchemasPy: await pathExists(path.join(pluginDir, 'schemas.py')),
          hasToolsPy: await pathExists(path.join(pluginDir, 'tools.py')),
        });
      }
    }

    return {
      plugins: results.sort((a, b) => a.name.localeCompare(b.name)),
      projectPluginsEnabled,
      pipEntryPointsVisible: false,
    };
  }

  return {
    listPlugins,
  };
}
