/**
 * Path resolution between Windows and WSL.
 * Extracted from server/index.mjs — GatewayProcessManager and all path
 * translation functions live here.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

/**
 * Convert a gateway host to a normalized loopback address.
 */
function normalizeGatewayHost(host) {
  const normalized = String(host || '').trim();
  if (!normalized || normalized === '0.0.0.0' || normalized === '::' || normalized === '::0') {
    return '127.0.0.1';
  }
  return normalized;
}

/**
 * Parse a gateway URL into host + port.
 */
function parseGatewayTarget(value, fallbackHost = '127.0.0.1', fallbackPort = 8642) {
  try {
    const parsed = new URL(String(value || '').trim());
    const port = parsePort(parsed.port) || fallbackPort;
    const host = normalizeGatewayHost(parsed.hostname || fallbackHost);
    return {
      url: `${parsed.protocol}//${host}:${port}`,
      host,
      port,
    };
  } catch {
    return null;
  }
}

/**
 * Build a gateway target object from host + port.
 */
function buildGatewayTarget(host, port) {
  const normalizedHost = normalizeGatewayHost(host);
  return {
    url: `http://${normalizedHost}:${port}`,
    host: normalizedHost,
    port,
  };
}

/**
 * Parse a port number from a string. Returns null if invalid.
 */
function parsePort(value) {
  const port = Number(value);
  if (!Number.isFinite(port) || port <= 0) return null;
  return Math.trunc(port);
}

/**
 * Parse a Windows UNC path back to a WSL distro + Linux path.
 */
function parseWslUncPath(inputPath) {
  const value = String(inputPath || '');
  const match = value.match(/^\\\\wsl(?:\.localhost)?\\([^\\]+)(.*)$/i);
  if (!match) return null;
  const distro = match[1];
  const suffix = match[2] || '';
  const linuxPath = suffix ? suffix.replace(/\\/g, '/') : '/';
  return {
    distro,
    linuxPath: linuxPath.startsWith('/') ? linuxPath : `/${linuxPath}`,
  };
}

/**
 * Convert a Linux path to a Windows UNC path.
 */
function toWslUncPath(linuxPath, distro) {
  const normalized = String(linuxPath || '').trim().replace(/\\/g, '/');
  if (!normalized.startsWith('/')) return null;
  return `\\\\wsl.localhost\\${distro}${normalized.replace(/\//g, '\\')}`;
}

/**
 * Quote a value for safe bash embedding.
 */
function quoteBash(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Convert a Windows path to its WSL equivalent.
 * Handles UNC paths directly, falls back to wslpath CLI.
 */
async function toWslPath(targetPath, distro, { execFile, cwd } = {}) {
  if (!targetPath) return null;
  const unc = parseWslUncPath(targetPath);
  if (unc) return unc.linuxPath;

  const ef = execFile || execFileAsync;
  const { stdout } = await ef('wsl.exe', ['-d', distro, '-e', 'wslpath', '-a', targetPath], {
    cwd: cwd || process.cwd(),
    windowsHide: true,
  });
  return stdout.trim();
}

export {
  normalizeGatewayHost,
  parseGatewayTarget,
  buildGatewayTarget,
  parsePort,
  parseWslUncPath,
  toWslUncPath,
  quoteBash,
  toWslPath,
};
