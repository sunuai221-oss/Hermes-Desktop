function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function createAgentsService({ fs, runtimeFilesService }) {
  async function readAgentProfiles(hermes) {
    try {
      const data = await fs.readFile(hermes.paths.agents, 'utf-8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    } catch {
      return [];
    }
  }

  async function writeAgentProfiles(hermes, profiles) {
    await runtimeFilesService.ensureAppStateDir(hermes);
    await fs.writeFile(hermes.paths.agents, JSON.stringify({ profiles }, null, 2), 'utf-8');
  }

  async function applyAgentProfile(hermes, profileId) {
    const profiles = await readAgentProfiles(hermes);
    const profile = profiles.find(item => item.id === profileId);

    if (!profile) {
      throw createHttpError(404, 'Agent profile not found');
    }

    await fs.writeFile(hermes.paths.soul, profile.soul || '', 'utf-8');

    const config = await runtimeFilesService.readYamlConfig(hermes);
    if (!config.agent) config.agent = {};
    if (!config.agent.personalities) config.agent.personalities = {};
    config.agent.personalities[profile.name] = profile.personalityOverlay || '';

    if (profile.defaultModel) {
      if (!config.model) config.model = {};
      config.model.default = profile.defaultModel;
    }

    await runtimeFilesService.writeYamlConfig(hermes, config);

    const now = new Date().toISOString();
    const nextProfiles = profiles.map(item =>
      item.id === profile.id
        ? { ...item, lastAppliedAt: now, updatedAt: now }
        : item
    );
    await writeAgentProfiles(hermes, nextProfiles);

    return {
      success: true,
      applied: {
        id: profile.id,
        name: profile.name,
        wroteSoul: true,
        updatedConfig: true,
        limitations: [
          'SOUL.md is singleton per HERMES_HOME',
          'Preferred skills and tool policy are advisory in the app',
          'Actual tool access remains platform-scoped in Hermes',
        ],
      },
    };
  }

  return {
    readAgentProfiles,
    writeAgentProfiles,
    applyAgentProfile,
  };
}
