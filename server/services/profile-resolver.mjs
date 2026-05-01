/**
 * Hermes home resolution and profile path management.
 * Extracted from server/index.mjs.
 */

import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { parseWslUncPath, toWslUncPath } from './path-resolver.mjs';

/**
 * Sanitize a profile name to a filesystem-safe identifier.
 */
function sanitizeProfileName(profileName) {
  if (!profileName || profileName === 'default') return 'default';
  return String(profileName).replace(/[^\w.-]+/g, '_');
}

/**
 * Score a candidate path by how much "Hermes data" it contains.
 * Higher score = more likely to be the real HERMES_HOME.
 */
function getHermesHomeScore(candidatePath) {
  try {
    const resolved = path.resolve(candidatePath);
    let score = 0;
    if (fsSync.existsSync(path.join(resolved, 'profiles'))) score += 8;
    if (fsSync.existsSync(path.join(resolved, 'sessions'))) score += 10;
    if (fsSync.existsSync(path.join(resolved, 'gateway_state.json'))) score += 5;
    if (fsSync.existsSync(path.join(resolved, 'SOUL.md'))) score += 3;
    if (fsSync.existsSync(path.join(resolved, 'config.yaml'))) score += 2;
    if (fsSync.existsSync(path.join(resolved, 'skills'))) score += 1;
    if (fsSync.existsSync(path.join(resolved, 'hooks'))) score += 1;
    return score;
  } catch {
    return 0;
  }
}

/**
 * Try to detect a WSL-based .hermes home via UNC path.
 */
function detectWslHermesHome(distro = 'Ubuntu') {
  try {
    const command = `printf '%s' "$HOME"`;
    const wslExePath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    if (!fsSync.existsSync(wslExePath)) return null;

    const result = execFileSync('wsl.exe', ['-d', distro, '-e', 'bash', '-lc', command], {
      encoding: 'utf8',
    }).trim();
    if (!result) return null;

    const uncPath = `\\\\wsl.localhost\\${distro}${result.replace(/\//g, '\\')}\\.hermes`;
    return getHermesHomeScore(uncPath) > 0 ? uncPath : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the main HERMES_BASE home directory.
 * Checks env vars, parent dir, home dir, and WSL UNC paths.
 */
function resolveHermesHome({ builderRoot, distro = 'Ubuntu', env = process.env } = {}) {
  const builderParent = path.dirname(builderRoot);
  const homeCandidate = path.join(os.homedir(), '.hermes');
  const wslCandidate = detectWslHermesHome(distro);
  const explicitWslHome = env.HERMES_WSL_HOME
    ? toWslUncPath(env.HERMES_WSL_HOME, distro)
    : null;
  const explicit = env.HERMES_HOME ? path.resolve(env.HERMES_HOME) : null;
  const candidates = [
    explicit,
    explicitWslHome,
    path.basename(builderParent).toLowerCase() === '.hermes' ? builderParent : null,
    homeCandidate,
    wslCandidate,
  ].filter(Boolean);

  const ranked = candidates
    .map(candidate => ({ candidate, score: getHermesHomeScore(candidate) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0) {
    return ranked[0].candidate;
  }

  return explicit || homeCandidate;
}

/**
 * Resolve the local Hermes state home (where state.db lives).
 */
function resolveLocalHermesStateHome({ builderRoot, hermesBase } = {}) {
  const builderParent = path.dirname(builderRoot);
  const explicit = process.env.HERMES_BUILDER_STATE_HOME
    ? path.resolve(process.env.HERMES_BUILDER_STATE_HOME)
    : null;
  const candidates = [
    explicit,
    path.basename(builderParent).toLowerCase() === '.hermes' ? builderParent : null,
    parseWslUncPath(hermesBase) ? null : hermesBase,
    path.join(os.homedir(), '.hermes'),
  ].filter(Boolean);

  const ranked = candidates
    .map(candidate => ({ candidate, score: getHermesHomeScore(candidate) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score > 0) {
    return ranked[0].candidate;
  }

  return candidates[0] || path.join(os.homedir(), '.hermes');
}

/**
 * Resolve the workspace root.
 */
function resolveWorkspaceRoot({ hermesBase, builderRoot } = {}) {
  if (process.env.HERMES_WORKSPACE_ROOT) {
    return path.resolve(process.env.HERMES_WORKSPACE_ROOT);
  }

  if (path.basename(hermesBase).toLowerCase() === '.hermes') {
    return path.dirname(hermesBase);
  }

  return builderRoot;
}

/**
 * Resolve the local app state directory for a profile.
 */
function resolveLocalAppStateDir(profileName, localStateHome) {
  const appStateRoot = path.join(localStateHome, '.hermes-builder');
  const safeProfile = sanitizeProfileName(profileName);
  return safeProfile === 'default'
    ? appStateRoot
    : path.join(appStateRoot, 'profiles', safeProfile);
}

/**
 * Get the HERMES home for a profile.
 */
function getHermesHome(hermesBase, profileName) {
  if (!profileName || profileName === 'default') return hermesBase;
  const safeName = sanitizeProfileName(profileName);
  return path.join(hermesBase, 'profiles', safeName);
}

/**
 * Resolve all paths for a profile.
 */
function resolveProfilePaths(profileName, hermesHome, localStateHome) {
  const appState = resolveLocalAppStateDir(profileName, localStateHome);
  return {
    home: hermesHome,
    soul: path.join(hermesHome, 'SOUL.md'),
    config: path.join(hermesHome, 'config.yaml'),
    env: path.join(hermesHome, '.env'),
    gatewayState: path.join(hermesHome, 'gateway_state.json'),
    sessionsDir: path.join(hermesHome, 'sessions'),
    stateDb: path.join(appState, 'state.db'),
    skills: path.join(hermesHome, 'skills'),
    hooks: path.join(hermesHome, 'hooks'),
    memories: path.join(hermesHome, 'memories'),
    memory: path.join(hermesHome, 'memories', 'MEMORY.md'),
    userMemory: path.join(hermesHome, 'memories', 'USER.md'),
    images: path.join(hermesHome, 'images'),
    voice: path.join(hermesHome, 'voice'),
    cron: path.join(hermesHome, 'cron'),
    cronJobs: path.join(hermesHome, 'cron', 'jobs.json'),
    cronOutput: path.join(hermesHome, 'cron', 'output'),
    appState,
    agents: path.join(appState, 'agents.json'),
  };
}

export {
  sanitizeProfileName,
  getHermesHomeScore,
  detectWslHermesHome,
  resolveHermesHome,
  resolveLocalHermesStateHome,
  resolveWorkspaceRoot,
  resolveLocalAppStateDir,
  getHermesHome,
  resolveProfilePaths,
};
