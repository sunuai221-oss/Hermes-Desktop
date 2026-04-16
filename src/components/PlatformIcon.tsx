import {
  MessageSquare, Hash, Mail, Phone, Home, Globe, Radio,
  Webhook, Server, Shield, Smartphone, Headphones,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

type PlatformMeta = {
  icon: LucideIcon;
  color: string;
  label: string;
};

const platformMeta: Record<string, PlatformMeta> = {
  telegram: { icon: MessageSquare, color: '#2AABEE', label: 'Telegram' },
  discord: { icon: Headphones, color: '#5865F2', label: 'Discord' },
  whatsapp: { icon: Phone, color: '#25D366', label: 'WhatsApp' },
  slack: { icon: Hash, color: '#E01E5A', label: 'Slack' },
  signal: { icon: Shield, color: '#3A76F0', label: 'Signal' },
  sms: { icon: Smartphone, color: '#FF6B35', label: 'SMS' },
  email: { icon: Mail, color: '#EA4335', label: 'Email' },
  homeassistant: { icon: Home, color: '#41BDF5', label: 'Home Assistant' },
  mattermost: { icon: MessageSquare, color: '#0058CC', label: 'Mattermost' },
  matrix: { icon: Globe, color: '#0DBD8B', label: 'Matrix' },
  dingtalk: { icon: MessageSquare, color: '#0089FF', label: 'DingTalk' },
  feishu: { icon: MessageSquare, color: '#3370FF', label: 'Feishu' },
  wecom: { icon: MessageSquare, color: '#07C160', label: 'WeCom' },
  api_server: { icon: Server, color: '#8B5CF6', label: 'API Server' },
  webhook: { icon: Webhook, color: '#F59E0B', label: 'Webhook' },
};

const fallback: PlatformMeta = { icon: Radio, color: '#6B7280', label: 'Unknown' };

function getPlatformMeta(name: string): PlatformMeta {
  return platformMeta[name.toLowerCase()] || { ...fallback, label: name };
}

interface PlatformIconProps {
  name: string;
  size?: number;
  withLabel?: boolean;
  className?: string;
  state?: 'connected' | 'disconnected' | 'fatal';
}

export function PlatformIcon({ name, size = 20, withLabel = false, className, state }: PlatformIconProps) {
  const meta = getPlatformMeta(name);
  const Icon = meta.icon;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'rounded-lg flex items-center justify-center',
          state === 'connected' && 'ring-1 ring-success/40',
          state === 'fatal' && 'ring-1 ring-destructive/40',
        )}
        style={{
          width: size + 12,
          height: size + 12,
          backgroundColor: `${meta.color}15`,
        }}
      >
        <Icon size={size} style={{ color: meta.color }} />
      </div>
      {withLabel && <span className="text-sm font-medium capitalize">{meta.label}</span>}
    </div>
  );
}
