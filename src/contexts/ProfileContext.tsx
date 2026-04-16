import { createContext, useContext } from 'react';
import type { ConnectionStatus } from '../types';

export interface ProfileContextType {
  currentProfile: string;
  profiles: string[];
  isLoading: boolean;
  gatewayStatus: { status: ConnectionStatus; port?: number | null; pid?: number };
  switchProfile: (name: string) => void;
  createProfile: (name: string) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
  startGateway: (profileName?: string, port?: number) => Promise<void>;
  stopGateway: (profileName?: string) => Promise<void>;
}

export const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const useProfiles = () => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfiles must be used within a ProfileProvider');
  }
  return context;
};
