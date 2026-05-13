import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { profiles as profilesApi } from '../api';
import { ProfileContext } from './ProfileContext';

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [currentProfile, setCurrentProfile] = useState<string>(
    localStorage.getItem('hermes_profile') || 'default',
  );
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfiles = useCallback(async () => {
    try {
      const { data } = await profilesApi.metadata();
      setProfiles(Array.isArray(data) ? data.map(profile => profile.name) : ['default']);
    } catch (error) {
      console.error('Failed to fetch profiles:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  const switchProfile = (name: string) => {
    localStorage.setItem('hermes_profile', name);
    setCurrentProfile(name);
  };

  const createProfile = async (name: string) => {
    await profilesApi.create(name);
    await refreshProfiles();
  };

  const deleteProfile = async (name: string) => {
    await profilesApi.delete(name);
    if (currentProfile === name) {
      switchProfile('default');
    } else {
      await refreshProfiles();
    }
  };

  return (
    <ProfileContext.Provider
      value={{
        currentProfile,
        profiles,
        isLoading,
        switchProfile,
        createProfile,
        deleteProfile,
        refreshProfiles,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}
