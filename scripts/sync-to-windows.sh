#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-${HERMES_WINDOWS_MIRROR_DIR:-}}"

if [[ -z "${TARGET_DIR}" ]]; then
  echo "Usage: scripts/sync-to-windows.sh /mnt/c/Users/<User>/.hermes/hermes-builder" >&2
  echo "Or set HERMES_WINDOWS_MIRROR_DIR before running the script." >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"

rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'server/node_modules/' \
  --exclude 'dist/' \
  --exclude 'dist-ssr/' \
  --exclude 'release/' \
  --exclude 'coverage/' \
  --exclude '.vite/' \
  --exclude '*.log' \
  --exclude '*.err' \
  --exclude '*.out' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'hermes-builder.local.cmd' \
  "${ROOT_DIR}/" "${TARGET_DIR}/"
