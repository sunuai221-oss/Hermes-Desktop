import type { ReactNode } from 'react';
import { useGateway as useGatewayHook } from '../hooks/useGateway';
import { GatewayContext } from './GatewayContext';

export function GatewayProvider({ children }: { children: ReactNode }) {
  const gateway = useGatewayHook();
  return (
    <GatewayContext.Provider value={gateway}>
      {children}
    </GatewayContext.Provider>
  );
}
