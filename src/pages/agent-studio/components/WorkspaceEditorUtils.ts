import type { WorkspaceAgentRole } from '../../../types';

export const ROLE_OPTIONS: WorkspaceAgentRole[] = ['orchestrator', 'worker', 'reviewer', 'qa', 'observer'];

export function splitCsv(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

export function toCsv(value?: string[]) {
  return (value || []).join(', ');
}

export function formatProfileOptionLabel(
  profile: { name: string; isDefault?: boolean; status: 'online' | 'offline' },
  currentProfile: string,
) {
  const markers = [
    profile.name === currentProfile ? 'current' : '',
    profile.isDefault ? 'default' : '',
    profile.status === 'offline' ? 'offline' : '',
  ].filter(Boolean);
  return markers.length > 0 ? `${profile.name} (${markers.join(', ')})` : profile.name;
}
