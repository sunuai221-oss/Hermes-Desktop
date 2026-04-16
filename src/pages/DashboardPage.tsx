import { motion } from 'framer-motion';
import { Activity, Clock3, FileCode2, Server, Shield } from 'lucide-react';
import { Card } from '../components/Card';
import { PlatformIcon } from '../components/PlatformIcon';
import { StatusBadge } from '../components/StatusBadge';
import { formatRelativeTime, formatUptime, parseChatTypeFromKey, parsePlatformFromKey } from '../lib/utils';
import type { SessionEntry } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';


export function DashboardPage() {
  const gateway = useGatewayContext();
  const {
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
  } = gateway;

  const platforms = state ? Object.entries(state.platforms) : [];
  const connected = platforms.filter(([, platform]) => platform.state === 'connected').length;
  const fatal = platforms.filter(([, platform]) => platform.state === 'fatal');
  const disconnected = platforms.filter(([, platform]) => platform.state === 'disconnected');
  const currentModel = config?.model?.default || models[0]?.name || 'unset';
  const sessionEntries = Object.entries(sessions).sort((a, b) => getSessionTimestamp(b[1]) - getSessionTimestamp(a[1]));
  const recentSessions = sessionEntries.slice(0, 6);
  const sessionResetMode = config?.session_reset?.mode || 'unset';
  const memoryProvider = config?.memory?.provider || 'builtin';
  const backendAvailable = builderStatus === 'online';
  const gatewayReachable = health === 'online';
  const directGatewayReachable = directGatewayHealth === 'online';

  const directGateway = (() => {
    try {
      return new URL(directGatewayUrl);
    } catch {
      return null;
    }
  })();

  const apiEndpoint = directGateway
    ? `${directGateway.hostname}:${directGateway.port || '8642'}`
    : `${processStatus?.port || 8642}`;

  const runtimeAlerts = [
    !backendAvailable
      ? (directGatewayReachable
        ? `The desktop backend is not responding, but the gateway responds directly on ${apiEndpoint}.`
        : 'The desktop backend is not responding.')
      : null,
    backendAvailable && !gatewayReachable
      ? (directGatewayReachable
        ? `The desktop backend proxy is failing, but the gateway responds directly on ${apiEndpoint}.`
        : `The Hermes gateway is not responding on ${apiEndpoint}.`)
      : null,
    fatal.length > 0 ? `${fatal.length} platform(s) are in a fatal state.` : null,
    connected === 0 && platforms.length > 0 ? 'All platforms are disconnected.' : null,
  ].filter(Boolean) as string[];

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      <div>
        <h2 className="text-3xl font-semibold">
          Gateway <span className="text-primary">Dashboard</span>
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard
          icon={<Server size={18} />}
          label="Backend"
          value={backendAvailable ? 'online' : 'offline'}
          detail={<StatusBadge status={builderStatus} size="sm" />}
        />
        <StatCard
          icon={<Activity size={18} />}
          label="Gateway"
          value={gatewayReachable ? 'online' : directGatewayReachable ? 'direct' : 'offline'}
          detail={<StatusBadge status={gatewayReachable ? 'online' : directGatewayReachable ? 'connected' : health} size="sm" />}
        />
        <StatCard
          icon={<Shield size={18} />}
          label="Platforms"
          value={`${connected}/${platforms.length}`}
          detail={`${fatal.length} fatal, ${disconnected.length} disconnected`}
        />
        <StatCard
          icon={<Clock3 size={18} />}
          label="Uptime"
          value={state?.start_time ? formatUptime(String(state.start_time), state.updated_at) : '-'}
          detail={state?.updated_at ? new Date(state.updated_at).toLocaleTimeString('en-US') : 'no heartbeat'}
        />
        <StatCard
          icon={<FileCode2 size={18} />}
          label="Extensions"
          value={`${skills.length}/${hooks.length}`}
          detail="skills / hooks"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <Card className="p-6">
          <h3 className="mb-4 text-lg font-bold">Runtime</h3>
          <div className="space-y-3">
            <RuntimeRow label="API server" value={apiEndpoint} />
            <RuntimeRow label="HERMES_HOME" value={processStatus?.home || 'unset'} breakAll />
            <RuntimeRow label="Active model" value={currentModel} />
            <RuntimeRow label="Local Ollama" value={<StatusBadge status={ollamaStatus} size="sm" />} />
            <RuntimeRow label="Memory" value={memoryProvider} />
            <RuntimeRow label="Session reset" value={sessionResetMode} />
            <RuntimeRow label="Sessions" value={String(sessionEntries.length)} />
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="mb-4 text-lg font-bold">Alerts</h3>
          {runtimeAlerts.length === 0 ? (
            <div className="rounded-lg border border-green-500/12 bg-green-500/5 p-4 text-sm text-success">
              No blocking alert.
            </div>
          ) : (
            <div className="space-y-3">
              {runtimeAlerts.map(alert => (
                <div key={alert} className="rounded-lg border border-red-500/12 bg-red-500/5 p-4 text-sm text-destructive">
                  {alert}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="p-6">
          <h3 className="mb-4 text-lg font-bold">Platforms</h3>
          <div className="space-y-3">
            {platforms.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">No platform detected.</p>
            ) : (
              platforms.map(([name, platform]) => (
                <div key={name} className="rounded-lg border border-border bg-muted/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <PlatformIcon name={name} size={14} withLabel state={platform.state} />
                    <StatusBadge status={platform.state} size="sm" />
                  </div>
                  {platform.error_message && (
                    <p className="mt-2 text-xs text-muted-foreground">{platform.error_message}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="mb-4 text-lg font-bold">Recent sessions</h3>
          <div className="space-y-3">
            {recentSessions.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">No session visible.</p>
            ) : (
              recentSessions.map(([id, session]) => (
                <SessionRow key={id} id={id} session={session} />
              ))
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="mb-4 text-lg font-bold">Extensions</h3>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Skills</p>
              <div className="space-y-2">
                {skills.slice(0, 5).map(skill => (
                  <div key={skill.path} className="rounded-lg border border-border bg-muted/50 px-3 py-2">
                    <p className="text-sm font-medium">{skill.name}</p>
                    {skill.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{skill.description}</p>}
                  </div>
                ))}
                {skills.length === 0 && <p className="text-sm italic text-muted-foreground">No skill detected.</p>}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs text-muted-foreground">Hooks</p>
              <div className="space-y-2">
                {hooks.slice(0, 5).map(hook => (
                  <div key={hook.path} className="rounded-lg border border-border bg-muted/50 px-3 py-2">
                    <p className="text-sm font-medium">{hook.name}</p>
                    {hook.events && hook.events.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">{hook.events.join(' - ')}</p>
                    )}
                  </div>
                ))}
                {hooks.length === 0 && <p className="text-sm italic text-muted-foreground">No hook detected.</p>}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs text-muted-foreground">Models</p>
              <div className="space-y-2">
                {models.slice(0, 5).map(model => (
                  <div key={model.digest} className="rounded-lg border border-border bg-muted/50 px-3 py-2">
                    <p className="text-sm font-medium">{model.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {model.details?.family || 'unknown family'} - {model.details?.parameter_size || 'unknown size'}
                    </p>
                  </div>
                ))}
                {models.length === 0 && <p className="text-sm italic text-muted-foreground">No model detected.</p>}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

function getSessionTimestamp(session: SessionEntry) {
  const candidate = session.last_accessed ?? session.created_at ?? 0;
  return candidate > 1e12 ? candidate : candidate * 1000;
}

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-3 break-all text-xl font-semibold capitalize">{value}</p>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </Card>
  );
}

function RuntimeRow({
  label,
  value,
  breakAll = false,
}: {
  label: string;
  value: React.ReactNode;
  breakAll?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className={breakAll ? 'mt-2 break-all text-sm' : 'mt-2 text-sm'}>{value}</div>
    </div>
  );
}

function SessionRow({ id, session }: { id: string; session: SessionEntry }) {
  const platform = parsePlatformFromKey(id);
  const chatType = parseChatTypeFromKey(id);
  const ts = getSessionTimestamp(session);

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <PlatformIcon name={platform} size={14} />
            <p className="truncate text-sm font-semibold">{session.title || id}</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {platform} - {chatType} - {session.model || 'default'}
          </p>
        </div>
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
          {ts > 0 ? formatRelativeTime(ts / 1000) : '-'}
        </span>
      </div>
      <p className="mt-3 truncate text-[10px] text-muted-foreground/55">{id}</p>
    </div>
  );
}
