import { createContext, useContext } from 'react';

export interface ProfileContextType {
  currentProfile: string;
  profiles: string[];
  isLoading: boolean;
  switchProfile: (name: string) => void;
  createProfile: (name: string) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  refreshProfiles: () => Promise<void>;
}

export const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const useProfiles = () => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfiles must be used within a ProfileProvider');
  }
  return context;
};
