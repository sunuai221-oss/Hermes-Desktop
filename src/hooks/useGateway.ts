import { useState, useEffect, useCallback } from 'react';
import * as api from '../api';
import type {
  GatewayState,
  GatewayHook,
  GatewayProcessStatus,
  ConnectionStatus,
  OllamaModel,
  HermesConfig,
  SessionEntry,
  SkillInfo,
  HookInfo,
} from '../types';

export function useGateway(interval = 4000): GatewayHook {
  const [builderStatus, setBuilderStatus] = useState<ConnectionStatus>('connecting');
  const [state, setState] = useState<GatewayState | null>(null);
  const [health, setHealth] = useState<ConnectionStatus>('connecting');
  const [directGatewayHealth, setDirectGatewayHealth] = useState<ConnectionStatus>('connecting');
  const [directGatewayUrl, setDirectGatewayUrl] = useState(api.gateway.directBaseUrl);
  const [processStatus, setProcessStatus] = useState<GatewayProcessStatus | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<ConnectionStatus>('connecting');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [config, setConfig] = useState<HermesConfig | null>(null);
  const [sessions, setSessions] = useState<Record<string, SessionEntry>>({});
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [hooks, setHooks] = useState<HookInfo[]>([]);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);

  const probeDirectGateway = useCallback(async (baseUrl?: string) => {
    try {
      const result = await api.gateway.directHealth(baseUrl);
      setDirectGatewayUrl(result.baseUrl);
      setDirectGatewayHealth(result.status);
      return result.status;
    } catch {
      setDirectGatewayUrl(baseUrl || api.gateway.directBaseUrl);
      setDirectGatewayHealth('offline');
      return 'offline' as const;
    }
  }, []);

  const poll = useCallback(async () => {
    let nextProcessStatus: GatewayProcessStatus | null = null;

    try {
      await api.gateway.backendHealth();
      setBuilderStatus('online');
    } catch {
      setBuilderStatus('offline');
      setHealth('connecting');
      setProcessStatus(null);
      setState(null);
      setOllamaStatus('connecting');
      setModels([]);
      await probeDirectGateway();
      return;
    }

    try {
      const res = await api.gateway.processStatus();
      nextProcessStatus = {
        ...res.data,
        status: res.data.status === 'online'
          ? 'online'
          : res.data.pid
            ? 'degraded'
            : 'offline',
      } as GatewayProcessStatus;
      setProcessStatus(nextProcessStatus);
      if (nextProcessStatus.gateway_url) {
        setDirectGatewayUrl(nextProcessStatus.gateway_url);
      }
    } catch {
      setProcessStatus(null);
    }

    try {
      await api.gateway.health();
      setHealth('online');
      setDirectGatewayHealth('connecting');
    } catch {
      const directStatus = await probeDirectGateway(nextProcessStatus?.gateway_url);
      if (directStatus === 'online') {
        setHealth('direct');
      } else {
        setHealth('offline');
      }
      setState(null);
    }
    try {
      const res = await api.gateway.state();
      setState(res.data);
    } catch {
      setState(null);
    }
    try {
      const res = await api.models.list();
      setOllamaStatus('online');
      setModels(res.data?.models || []);
    } catch {
      setOllamaStatus('offline');
      setModels([]);
    }
  }, [probeDirectGateway]);

  const pollMeta = useCallback(async () => {
    try {
      const [configRes, sessionsRes, skillsRes, hooksRes] = await Promise.allSettled([
        api.config.get(),
        api.sessions.list(),
        api.skills.list(),
        api.hooks.list(),
      ]);

      setConfig(configRes.status === 'fulfilled' ? configRes.value.data : null);
      setSessions(sessionsRes.status === 'fulfilled' && sessionsRes.value.data ? sessionsRes.value.data : {});
      setSkills(skillsRes.status === 'fulfilled' && Array.isArray(skillsRes.value.data) ? skillsRes.value.data : []);
      setHooks(hooksRes.status === 'fulfilled' && Array.isArray(hooksRes.value.data) ? hooksRes.value.data : []);
    } finally {
      setIsLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, interval);
    return () => clearInterval(timer);
  }, [poll, interval]);

  useEffect(() => {
    pollMeta();
    const timer = setInterval(pollMeta, Math.max(interval * 5, 15000));
    return () => clearInterval(timer);
  }, [pollMeta, interval]);

  return {
    builderStatus,
    state,
    health,
    directGatewayHealth,
    directGatewayUrl,
    processStatus,
    ollamaStatus,
    models,
    config,
    sessions,
    skills,
    hooks,
    isLoadingMeta,
  };
}
