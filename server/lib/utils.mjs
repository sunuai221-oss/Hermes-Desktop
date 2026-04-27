/**
 * Utility functions extracted from server/index.mjs
 * Pure functions — no Express, no gateway, no state.
 */

import fs from 'fs';

/**
 * Parse a .env-style string into a plain object.
 */
function parseDotEnv(content) {
  const result = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
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
 * Check if a path exists (async).
 */
async function exists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a file only if the source exists. Returns true if copied.
 */
async function copyFileIfExists(sourcePath, targetPath) {
  if (!(await exists(sourcePath))) return false;
  await fs.promises.copyFile(sourcePath, targetPath);
  return true;
}

export { parseDotEnv, parsePort, exists, copyFileIfExists };
