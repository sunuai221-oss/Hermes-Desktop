import type { ConnectionStatus, GatewayProcessStatus } from '../../types';

type ProcessStatusInput = Omit<GatewayProcessStatus, 'status'> & {
  status: 'online' | 'degraded' | 'offline';
};

export type RuntimeStatusSnapshot = {
  runtimeStatus: ConnectionStatus;
  gatewayProcessStatus: GatewayProcessStatus | null;
  gatewayHealth: ConnectionStatus;
  lastCheckedAt: string | null;
};

export function normalizeGatewayProcessStatus(status: ProcessStatusInput | null | undefined): GatewayProcessStatus | null {
  if (!status) return null;

  const normalizedStatus: GatewayProcessStatus['status'] = status.status === 'online'
    ? 'online'
    : status.status === 'degraded' || status.pid
      ? 'degraded'
      : 'offline';

  return { ...status, status: normalizedStatus };
}

export function deriveRuntimeStatus({
  builderStatus,
  gatewayHealth,
  directGatewayHealth,
  gatewayProcessStatus,
}: {
  builderStatus: ConnectionStatus;
  gatewayHealth: ConnectionStatus;
  directGatewayHealth: ConnectionStatus;
  gatewayProcessStatus: GatewayProcessStatus | null;
}): ConnectionStatus {
  if (builderStatus !== 'online') {
    return builderStatus === 'connecting' ? 'connecting' : 'offline';
  }
  if (gatewayHealth === 'online') return 'online';
  if (gatewayHealth === 'direct' || directGatewayHealth === 'online') return 'direct';
  if (gatewayProcessStatus?.pid) return 'degraded';
  if (gatewayHealth === 'connecting') return 'connecting';
  return 'offline';
}

export function createRuntimeStatusSnapshot({
  builderStatus,
  gatewayHealth,
  directGatewayHealth,
  gatewayProcessStatus,
  lastCheckedAt,
}: {
  builderStatus: ConnectionStatus;
  gatewayHealth: ConnectionStatus;
  directGatewayHealth: ConnectionStatus;
  gatewayProcessStatus: GatewayProcessStatus | null;
  lastCheckedAt: string | null;
}): RuntimeStatusSnapshot {
  return {
    runtimeStatus: deriveRuntimeStatus({
      builderStatus,
      gatewayHealth,
      directGatewayHealth,
      gatewayProcessStatus,
    }),
    gatewayProcessStatus,
    gatewayHealth,
    lastCheckedAt,
  };
}
