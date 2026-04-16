import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { Card } from '../components/Card';
import { PlatformIcon } from '../components/PlatformIcon';
import { StatusBadge } from '../components/StatusBadge';
import { cn } from '../lib/utils';
import { useGatewayContext } from '../contexts/GatewayContext';

export function PlatformsPage() {
  const gateway = useGatewayContext();
  const platforms = gateway.state ? Object.entries(gateway.state.platforms) : [];

  return (
    <motion.div
      key="platforms"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold">Network <span className="text-primary">Hub</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Real-time connectivity for every gateway platform
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {platforms.filter(([, p]) => p.state === 'connected').length} connected
          {' '}of {platforms.length}
        </div>
      </div>

      {platforms.length === 0 ? (
        <Card className="p-16 text-center">
          <p className="text-muted-foreground">No platform detected. Is the gateway running?</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {platforms.map(([name, data], i) => {
            const glowColor = data.state === 'connected' ? 'rgba(34, 197, 94, 0.25)' : 'transparent';
            return (
              <motion.div
                key={name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card
                  className={cn(
                    'relative overflow-hidden p-5',
                    data.state === 'connected' && 'border-green-500/10',
                    data.state === 'fatal' && 'border-red-500/10',
                  )}
                >
                  <div
                    className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full blur-[60px]"
                    style={{
                      backgroundColor: glowColor,
                      opacity: 0.08,
                    }}
                  />

                  <div className="relative z-10">
                    <div className="mb-4 flex items-center justify-between">
                      <PlatformIcon name={name} size={22} withLabel state={data.state} />
                      <StatusBadge status={data.state} size="sm" />
                    </div>

                    {data.error_message && (
                      <div className="mt-3 rounded-lg border border-red-500/10 bg-red-500/5 p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs font-bold text-destructive">
                          <AlertTriangle size={12} />
                          {data.error_code || 'Error'}
                        </div>
                        <p className="text-xs leading-relaxed text-destructive/70">{data.error_message}</p>
                      </div>
                    )}

                    <div className="mt-3 text-[10px] text-muted-foreground/60">
                      Updated: {data.updated_at ? new Date(data.updated_at).toLocaleString('en-US') : '—'}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
