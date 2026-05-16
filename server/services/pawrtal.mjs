import path from 'path';
import { parseWslUncPath, quoteBash, toWslUncPath } from './path-resolver.mjs';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER = 8 * 1024 * 1024;
const SESSION_PATTERN = /^[\w.-]{1,120}$/;
const PET_PATTERN = /^[\w.-]{1,120}$/;

function classifyCommandFailure(result) {
  const stderr = String(result?.stderr || '');
  if (result?.code === 127 || /pawrtal CLI not found/i.test(stderr)) {
    return {
      errorCode: 'pawrtal_cli_missing',
      error: 'Pawrtal CLI was not found in WSL. Install pawrtal or set PAWRTAL_CLI_PATH.',
      httpStatus: 503,
    };
  }
  if (/timed out/i.test(stderr)) {
    return {
      errorCode: 'pawrtal_cli_timeout',
      error: 'Pawrtal command timed out.',
      httpStatus: 504,
    };
  }
  return {
    errorCode: 'pawrtal_cli_failed',
    error: stderr || 'Pawrtal command failed.',
    httpStatus: 502,
  };
}

function pickFailureDetails(result) {
  if (result?.ok !== false) return {};
  return Object.fromEntries(
    ['errorCode', 'httpStatus', 'error', 'stderr', 'code']
      .filter(key => result[key] !== undefined)
      .map(key => [key, result[key]]),
  );
}

function sanitizeSession(value) {
  const normalized = String(value || 'current').trim().toLowerCase();
  if (!normalized) return 'current';
  return SESSION_PATTERN.test(normalized) ? normalized : 'current';
}

function sanitizePetId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return PET_PATTERN.test(normalized) ? normalized : null;
}

function inferLinuxHomeFromHermesPath(linuxPath) {
  const match = String(linuxPath || '').match(/^(.*)\/\.hermes(?:\/.*)?$/);
  if (match?.[1]) return match[1];
  const posixDir = path.posix.dirname(String(linuxPath || '/home'));
  return posixDir || '/home';
}

function resolvePawrtalStateDir(hermes) {
  const unc = parseWslUncPath(hermes.home);
  if (unc) {
    const customLinuxHome = String(process.env.PAWRTAL_HOME || '').trim();
    const linuxHome = customLinuxHome || `${inferLinuxHomeFromHermesPath(unc.linuxPath)}/.pawrtal`;
    const linuxStateDir = `${linuxHome}/state/hermes`;
    const uncStateDir = toWslUncPath(linuxStateDir, unc.distro);
    if (uncStateDir) {
      return { stateDir: uncStateDir, distro: unc.distro, linuxStateDir };
    }
  }

  const custom = String(process.env.PAWRTAL_HOME || '').trim();
  const pawrtalRoot = custom || path.join(path.dirname(hermes.home), '.pawrtal');
  return { stateDir: path.join(pawrtalRoot, 'state', 'hermes'), distro: null, linuxStateDir: null };
}

function resolveInsideStateDir(stateDir, ...parts) {
  const root = path.resolve(stateDir);
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('Resolved Pawrtal state path escaped the expected state directory');
    error.statusCode = 400;
    error.code = 'pawrtal_state_path_escape';
    throw error;
  }
  return target;
}

function getSessionStateFile(session) {
  return session === 'current' ? 'current.json' : `${session}.json`;
}

async function readJsonIfExists(fs, filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function removeIfExists(fs, filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

function toSafeOutput(value) {
  return String(value || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/(api[_-]?key\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[redacted]')
    .replace(/(token\s*[:=]\s*["']?)[^"'\s]+/gi, '$1[redacted]')
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, 'sk-[redacted]');
}

export function createPawrtalService({ fs, execFileAsync }) {
  async function runWslBash(hermes, script, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const unc = parseWslUncPath(hermes.home);
    const distro = unc?.distro || process.env.HERMES_WSL_DISTRO || 'Ubuntu';

    try {
      const { stdout, stderr } = await execFileAsync(
        'wsl.exe',
        ['-d', distro, '-e', 'bash', '-lc', script],
        {
          cwd: process.cwd(),
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer: MAX_BUFFER,
        },
      );

      return {
        ok: true,
        distro,
        stdout: toSafeOutput(stdout),
        stderr: toSafeOutput(stderr),
        code: 0,
      };
    } catch (error) {
      return {
        ok: false,
        distro,
        stdout: toSafeOutput(error?.stdout || ''),
        stderr: toSafeOutput(error?.stderr || error?.message || 'Command failed'),
        code: typeof error?.code === 'number' ? error.code : null,
      };
    }
  }

  async function runPawrtalCommand(hermes, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const unc = parseWslUncPath(hermes.home);
    const homeExport = unc?.linuxPath
      ? `export HERMES_HOME=${quoteBash(unc.linuxPath)}`
      : 'export HERMES_HOME="${HERMES_WSL_HOME:-$HOME/.hermes}"';
    const escapedArgs = args.map(arg => quoteBash(String(arg))).join(' ');

    const script = [
      'set -e',
      homeExport,
      'PAWRTAL_BIN="${PAWRTAL_CLI_PATH:-$(command -v pawrtal || true)}"',
      'if [ -z "$PAWRTAL_BIN" ] && [ -x "$HERMES_HOME/bin/pawrtal" ]; then PAWRTAL_BIN="$HERMES_HOME/bin/pawrtal"; fi',
      'if [ -z "$PAWRTAL_BIN" ] && [ -x "$HOME/.hermes/bin/pawrtal" ]; then PAWRTAL_BIN="$HOME/.hermes/bin/pawrtal"; fi',
      'if [ -z "$PAWRTAL_BIN" ]; then echo "pawrtal CLI not found in WSL PATH." >&2; exit 127; fi',
      `"$PAWRTAL_BIN" ${escapedArgs}`,
    ].join('; ');

    const result = await runWslBash(hermes, script, timeoutMs);
    const commandResult = {
      ...result,
      command: `pawrtal ${args.join(' ')}`.trim(),
    };
    if (!commandResult.ok) {
      return {
        ...commandResult,
        ...classifyCommandFailure(commandResult),
      };
    }
    return commandResult;
  }

  async function readStatus(hermes, sessionInput = 'current') {
    const session = sanitizeSession(sessionInput);
    const { stateDir } = resolvePawrtalStateDir(hermes);
    const statePath = resolveInsideStateDir(stateDir, getSessionStateFile(session));
    const desktopPath = resolveInsideStateDir(stateDir, `desktop-${session}.json`);
    const relayPath = resolveInsideStateDir(stateDir, 'relay.json');
    const activityPath = resolveInsideStateDir(stateDir, 'activity', getSessionStateFile(session));

    const [active, desktopRaw, relay, activity] = await Promise.all([
      readJsonIfExists(fs, statePath),
      readJsonIfExists(fs, desktopPath),
      readJsonIfExists(fs, relayPath),
      readJsonIfExists(fs, activityPath),
    ]);

    let running = false;
    const pid = Number(desktopRaw?.pid);
    if (Number.isInteger(pid) && pid > 0) {
      const check = await runWslBash(
        hermes,
        `if kill -0 ${quoteBash(String(pid))} >/dev/null 2>&1; then echo running; else echo stopped; fi`,
        15000,
      );
      running = check.ok && String(check.stdout || '').trim() === 'running';
    }

    const desktop = desktopRaw
      ? {
          ...desktopRaw,
          running,
        }
      : null;

    return {
      ok: true,
      session,
      active,
      desktop,
      relay,
      activity,
      stateDir,
    };
  }

  async function listCompanions(hermes) {
    const result = await runPawrtalCommand(hermes, ['list', '--json']);
    if (!result.ok) {
      return { ...result, companions: [] };
    }

    try {
      const parsed = JSON.parse(result.stdout || '{}');
      const companions = Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed?.companions) ? parsed.companions : []);
      return {
        ...result,
        companions: companions.map((item) => ({
          id: String(item?.id || ''),
          displayName: String(item?.displayName || item?.id || ''),
          description: String(item?.description || ''),
          packDir: String(item?.packDir || item?.path || ''),
        })),
      };
    } catch {
      return {
        ...result,
        ok: false,
        errorCode: 'pawrtal_list_parse_failed',
        httpStatus: 502,
        error: 'Could not parse pawrtal list JSON output.',
        stderr: `${result.stderr ? `${result.stderr}\n` : ''}Could not parse pawrtal list JSON output.`,
        companions: [],
      };
    }
  }

  async function useCompanion(hermes, { petId, session = 'current' }) {
    const normalizedPetId = sanitizePetId(petId);
    if (!normalizedPetId) {
      return {
        ok: false,
        errorCode: 'pawrtal_invalid_pet_id',
        httpStatus: 400,
        error: 'Invalid pet id. Use /pawrtal list to get valid ids.',
      };
    }
    const normalizedSession = sanitizeSession(session);
    return runPawrtalCommand(
      hermes,
      ['use', normalizedPetId, '--target', 'hermes', '--session', normalizedSession],
    );
  }

  async function spawnCompanion(hermes, { petId = null, session = 'current' }) {
    const normalizedSession = sanitizeSession(session);
    const normalizedPetId = sanitizePetId(petId);
    const args = ['spawn'];
    if (normalizedPetId) args.push(normalizedPetId);
    args.push('--target', 'hermes', '--session', normalizedSession);
    return runPawrtalCommand(hermes, args);
  }

  async function vanishCompanion(hermes, { petId = null, session = 'current' }) {
    const normalizedSession = sanitizeSession(session);
    const normalizedPetId = sanitizePetId(petId);
    const args = ['vanish'];
    if (normalizedPetId) args.push(normalizedPetId);
    args.push('--target', 'hermes', '--session', normalizedSession);
    return runPawrtalCommand(hermes, args);
  }

  async function cleanupSessionState(hermes, sessionInput = 'current') {
    const session = sanitizeSession(sessionInput);
    const { stateDir } = resolvePawrtalStateDir(hermes);
    const cleanupTargets = new Set([
      resolveInsideStateDir(stateDir, `${session}.json`),
      resolveInsideStateDir(stateDir, `desktop-${session}.json`),
      resolveInsideStateDir(stateDir, 'activity', `${session}.json`),
    ]);

    if (session === 'current') {
      cleanupTargets.add(resolveInsideStateDir(stateDir, 'current.json'));
      cleanupTargets.add(resolveInsideStateDir(stateDir, 'desktop-current.json'));
      cleanupTargets.add(resolveInsideStateDir(stateDir, 'activity', 'current.json'));
    }

    const removedFiles = [];
    for (const target of cleanupTargets) {
      // Best-effort cleanup only touches the known Pawrtal state directory.
      if (await removeIfExists(fs, target)) removedFiles.push(target);
    }

    return { ok: true, session, removedFiles };
  }

  async function resetCompanion(hermes, { petId = null, session = 'current' }) {
    const normalizedSession = sanitizeSession(session);
    const statusBefore = await readStatus(hermes, normalizedSession);
    const fallbackPetId = sanitizePetId(statusBefore.active?.activePetId);
    const targetPetId = sanitizePetId(petId) || fallbackPetId;

    const vanish = await vanishCompanion(hermes, { session: normalizedSession });
    const cleanup = await cleanupSessionState(hermes, normalizedSession);

    if (!targetPetId) {
      return {
        ok: false,
        errorCode: 'pawrtal_no_selected_companion',
        httpStatus: 400,
        error: 'No companion is selected for this session. Provide a pet id, e.g. /pawrtal reset veyra.',
        vanish,
        cleanup,
      };
    }

    const spawn = await spawnCompanion(hermes, { petId: targetPetId, session: normalizedSession });
    const statusAfter = await readStatus(hermes, normalizedSession);

    return {
      ok: spawn.ok,
      ...pickFailureDetails(spawn),
      session: normalizedSession,
      petId: targetPetId,
      vanish,
      cleanup,
      spawn,
      status: statusAfter,
    };
  }

  async function switchCompanion(hermes, { petId, session = 'current' }) {
    const normalizedPetId = sanitizePetId(petId);
    if (!normalizedPetId) {
      return {
        ok: false,
        errorCode: 'pawrtal_invalid_pet_id',
        httpStatus: 400,
        error: 'Invalid pet id. Use /pawrtal list to get valid ids.',
      };
    }
    return resetCompanion(hermes, { petId: normalizedPetId, session });
  }

  async function autoStart(hermes, { petId = null, session = 'current', resetBeforeSpawn = true }) {
    const normalizedSession = sanitizeSession(session);
    const normalizedPetId = sanitizePetId(petId);
    const status = await readStatus(hermes, normalizedSession);
    const activePetId = sanitizePetId(status.active?.activePetId);
    const desiredPetId = normalizedPetId || activePetId;
    const alreadyRunning = Boolean(status.desktop?.running);

    if (alreadyRunning && (!desiredPetId || desiredPetId === activePetId)) {
      return {
        ok: true,
        autoStarted: false,
        alreadyRunning: true,
        reason: 'Pawrtal desktop companion is already running.',
        status,
      };
    }

    if (desiredPetId && resetBeforeSpawn) {
      const reset = await resetCompanion(hermes, { petId: desiredPetId, session: normalizedSession });
      return {
        ok: reset.ok,
        autoStarted: reset.ok,
        action: 'reset-spawn',
        ...reset,
      };
    }

    const spawn = await spawnCompanion(hermes, { petId: desiredPetId, session: normalizedSession });
    const statusAfter = await readStatus(hermes, normalizedSession);
    return {
      ok: spawn.ok,
      autoStarted: spawn.ok,
      ...pickFailureDetails(spawn),
      action: 'spawn',
      session: normalizedSession,
      petId: desiredPetId,
      spawn,
      status: statusAfter,
    };
  }

  return {
    listCompanions,
    readStatus,
    useCompanion,
    spawnCompanion,
    vanishCompanion,
    resetCompanion,
    switchCompanion,
    autoStart,
  };
}
