import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { profiles as profilesApi, gateway as gatewayApi } from '../api';
import type { ConnectionStatus } from '../types';
import { ProfileContext } from './ProfileContext';

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [currentProfile, setCurrentProfile] = useState<string>(
    localStorage.getItem('hermes_profile') || 'default'
  );
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [isLoading, setIsLoading] = useState(true);
  const [gatewayStatus, setGatewayStatus] = useState<{ status: ConnectionStatus; port?: number | null; pid?: number }>({ status: 'connecting' });

  const refreshProfiles = useCallback(async () => {
    try {
      const { data } = await profilesApi.list();
      setProfiles(Array.isArray(data) ? data.map(profile => profile.name) : ['default']);
    } catch (error) {
      console.error('Failed to fetch profiles:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshGatewayStatus = useCallback(async () => {
    let directProbeBaseUrl: string | undefined;

    try {
      const { data } = await gatewayApi.processStatus();
      directProbeBaseUrl = data.gateway_url;
      const normalizedStatus: ConnectionStatus = data.status === 'online'
        ? 'online'
        : data.pid
          ? 'degraded'
          : 'offline';
      setGatewayStatus({ ...data, status: normalizedStatus });
      if (normalizedStatus === 'online') return;
    } catch {
      // Fall through to direct probe.
    }

    try {
      const direct = await gatewayApi.directHealth(directProbeBaseUrl);
      if (direct.status === 'online') {
        const parsed = new URL(direct.baseUrl);
        const fallbackPort = parsed.port ? Number(parsed.port) : 8642;
        setGatewayStatus({ status: 'direct', port: fallbackPort });
        return;
      }
    } catch {
      // Fall back to offline below.
    }

    setGatewayStatus(current => current.pid ? { ...current, status: 'degraded' } : { status: 'offline' });
  }, []);

  useEffect(() => {
    void refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    void refreshGatewayStatus();
    const timer = setInterval(() => {
      void refreshGatewayStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshGatewayStatus, currentProfile]);

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

  const startGateway = async (profileName?: string, port?: number) => {
    await gatewayApi.start(port, profileName);
    await refreshGatewayStatus();
  };

  const stopGateway = async (profileName?: string) => {
    await gatewayApi.stop(profileName);
    await refreshGatewayStatus();
  };

  return (
    <ProfileContext.Provider
      value={{
        currentProfile,
        profiles,
        isLoading,
        gatewayStatus,
        switchProfile,
        createProfile,
        deleteProfile,
        refreshProfiles,
        startGateway,
        stopGateway,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}
