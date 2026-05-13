import { useMemo } from 'react';
import type { ConnectionStatus, GatewayHook } from '../types';

export const statusLabels: Record<ConnectionStatus, string> = {
  online: 'Online',
  direct: 'Direct',
  degraded: 'Degraded',
  connecting: 'Connecting',
  offline: 'Offline',
};

/**
 * Derives the effective runtime status from gateway state.
 *
 * Logic (same everywhere):
 *   gateway.health === 'online'  → 'online'
 *   gateway.health === 'direct'  → 'direct'
 *   process has PID              → 'degraded'
 *   else                         → fallbackStatus (default: gateway.health)
 */
export function useRuntimeStatus(
  gateway: GatewayHook,
  fallbackStatus?: ConnectionStatus,
): { status: ConnectionStatus; label: string } {
  return useMemo(() => {
    const status: ConnectionStatus = gateway.runtimeStatus || fallbackStatus || gateway.health;

    return { status, label: statusLabels[status] ?? status };
  }, [gateway.health, gateway.runtimeStatus, fallbackStatus]);
}
