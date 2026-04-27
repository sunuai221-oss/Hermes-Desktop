/**
 * Manages multiple Hermes Gateway processes for different profiles.
 * Extracted from server/index.mjs — GatewayProcessManager class.
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';
import { parseWslUncPath, toWslPath, quoteBash, parsePort } from './path-resolver.mjs';

const execFileAsync = promisify(execFileCb);

const DEFAULT_WSL_DISTRO = 'Ubuntu';

class GatewayProcessManager {
  constructor() {
    this.processes = new Map(); // profileName -> { process, port, startTime }
  }

  async getStatus(profileName) {
    const entry = this.processes.get(profileName);
    if (!entry) return { status: 'offline' };

    if (entry.process.exitCode != null || entry.process.killed) {
      this.processes.delete(profileName);
      return { status: 'offline' };
    }

    return {
      status: 'online',
      port: entry.port,
      startTime: entry.startTime,
      pid: entry.process.pid,
    };
  }

  async start(profileName, port, hermesHome = null) {
    if (this.processes.has(profileName)) {
      const status = await this.getStatus(profileName);
      if (status.status === 'online') return status;
    }

    const unc = parseWslUncPath(hermesHome);
    const distro = unc?.distro || DEFAULT_WSL_DISTRO;
    const wslHome = hermesHome ? await toWslPath(hermesHome, distro).catch(() => null) : null;
    const safeProfile = String(profileName || 'default').replace(/[^\w.-]+/g, '_');
    const bashCommand = [
      'set -e',
      wslHome ? `export HERMES_HOME=${quoteBash(wslHome)}` : '',
      'HERMES_BIN="${HERMES_CLI_PATH:-$(command -v hermes || true)}"',
      'if [ -z "$HERMES_BIN" ] && [ -x "$HOME/.local/bin/hermes" ]; then HERMES_BIN="$HOME/.local/bin/hermes"; fi',
      'if [ -z "$HERMES_BIN" ]; then echo "Hermes CLI not found in WSL" >&2; exit 127; fi',
      `exec "$HERMES_BIN"${safeProfile === 'default' ? '' : ` -p ${quoteBash(safeProfile)}`} gateway run --port ${Number(port)}`,
    ].filter(Boolean).join('; ');
    const args = [
      '-d', distro, '-e', 'bash', '-lc',
      bashCommand,
    ];

    console.log(`[ProcessManager] Starting gateway for profile "${profileName}" on port ${port}...`);

    const child = spawn('wsl.exe', args, {
      stdio: 'pipe',
      detached: false
    });

    child.stdout.on('data', (data) => {
      // console.log(`[Gateway:${profileName}] ${data}`);
    });

    child.stderr.on('data', (data) => {
      console.error(`[Gateway:${profileName}:err] ${data}`);
    });

    child.on('error', (error) => {
      console.error(`[ProcessManager] Failed to start gateway for profile "${profileName}": ${error.message}`);
      this.processes.delete(profileName);
    });

    child.on('exit', (code) => {
      console.warn(`[ProcessManager] Gateway for profile "${profileName}" exited with code ${code}`);
      this.processes.delete(profileName);
    });

    const entry = {
      process: child,
      port: port,
      startTime: Date.now()
    };
    this.processes.set(profileName, entry);

    return { status: 'online', port, pid: child.pid };
  }

  async stop(profileName, hermesHome = null) {
    const entry = this.processes.get(profileName);
    if (entry) {
      console.log(`[ProcessManager] Stopping gateway for profile "${profileName}" (PID: ${entry.process.pid})...`);
      entry.process.kill();
      this.processes.delete(profileName);
      return { success: true };
    }

    const unc = parseWslUncPath(hermesHome);
    if (unc) {
      const bashCommand = [
        `export HERMES_HOME=${quoteBash(unc.linuxPath)}`,
        'pid=$(cat "$HERMES_HOME/gateway.pid" 2>/dev/null || true)',
        'if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi',
      ].join('; ');
      await execFileAsync('wsl.exe', ['-d', unc.distro, '-e', 'bash', '-lc', bashCommand], {
        cwd: process.cwd(),
        windowsHide: true,
      }).catch(() => {});
      return { success: true };
    }

    return { success: true };
  }
}

export { GatewayProcessManager };
