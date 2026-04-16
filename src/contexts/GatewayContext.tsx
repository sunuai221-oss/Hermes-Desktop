import { createContext, useContext } from 'react';
import type { GatewayHook } from '../types';

export const GatewayContext = createContext<GatewayHook | null>(null);

export function useGatewayContext(): GatewayHook {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error('useGatewayContext must be used within <GatewayProvider>');
  }
  return ctx;
}
