export function createRuntimeFilesService({ fs, yaml }) {
  async function ensureAppStateDir(hermes) {
    await fs.mkdir(hermes.paths.appState, { recursive: true });
  }

  async function readYamlConfig(hermes) {
    const data = await fs.readFile(hermes.paths.config, 'utf-8');
    return yaml.parse(data) || {};
  }

  async function writeYamlConfig(hermes, config) {
    await fs.writeFile(hermes.paths.config, yaml.stringify(config), 'utf-8');
  }

  return {
    ensureAppStateDir,
    readYamlConfig,
    writeYamlConfig,
  };
}
