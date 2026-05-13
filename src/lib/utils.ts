import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(timestamp: number): string {
  const normalizedTimestamp = normalizeUnixTimestampSeconds(timestamp);
  const now = Date.now() / 1000;
  const diff = now - normalizedTimestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(normalizedTimestamp * 1000).toLocaleDateString('en-US');
}

export function normalizeUnixTimestampSeconds(timestamp: number | null | undefined): number {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1e12 ? Math.floor(value / 1000) : value;
}

export function formatUptime(startTimeOrUpdatedAt: string, updatedAt?: string): string {
  let diffSec: number;
  const parsed = new Date(startTimeOrUpdatedAt).getTime();

  if (!isNaN(parsed) && parsed > 1e12) {
    // Valid ISO date - compute diff from now
    diffSec = Math.floor((Date.now() - parsed) / 1000);
  } else if (updatedAt) {
    // start_time is a monotonic/process value - use updated_at as a proxy
    const up = new Date(updatedAt).getTime();
    if (!isNaN(up)) {
      diffSec = Math.floor((Date.now() - up) / 1000);
    } else {
      return '—';
    }
  } else {
    return '—';
  }

  if (diffSec < 0) diffSec = 0;
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function parsePlatformFromKey(key: string): string {
  const parts = key.split(':');
  return parts.length > 2 ? parts[2] : 'unknown';
}

export function parseChatTypeFromKey(key: string): string {
  const parts = key.split(':');
  return parts.length > 3 ? parts[3] : 'unknown';
}
