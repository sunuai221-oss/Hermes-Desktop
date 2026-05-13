import type { AgentDefinition } from '../types';

export const DEFAULT_AGENCY_REPO_URL = 'https://github.com/msitarzewski/agency-agents';
export const DEFAULT_AGENCY_REPO_BRANCH = 'main';

const ACRONYMS = new Set(['ai', 'api', 'aso', 'devops', 'ios', 'mcp', 'qa', 'seo', 'sre', 'ui', 'ux', 'xr']);

function compareStrings(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function humanizeCatalogSegment(value?: string) {
  return String(value || '')
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();
      if (ACRONYMS.has(normalized)) return normalized.toUpperCase();
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(' ');
}

export function formatDivisionLabel(division?: string) {
  return humanizeCatalogSegment(division) || 'General';
}

export function inferAgentSubgroup(sourcePath?: string) {
  const parts = String(sourcePath || '').split('/').filter(Boolean);
  if (parts.length <= 2) return '';
  return parts.slice(1, -1).map(humanizeCatalogSegment).join(' / ');
}

export function getAgentCatalogLabel(agent: Pick<AgentDefinition, 'division' | 'sourcePath'>) {
  const inferredDivision = agent.division || String(agent.sourcePath || '').split('/').filter(Boolean)[0] || '';
  const divisionLabel = formatDivisionLabel(inferredDivision);
  const subgroup = inferAgentSubgroup(agent.sourcePath);
  return subgroup ? `${divisionLabel} / ${subgroup}` : divisionLabel;
}

export function groupAgentsByCatalog<T extends Pick<AgentDefinition, 'id' | 'name' | 'division' | 'sourcePath'>>(agents: T[]) {
  const groups = new Map<string, { key: string; label: string; agents: T[] }>();
  const sortedAgents = [...agents].sort((left, right) => (
    compareStrings(getAgentCatalogLabel(left), getAgentCatalogLabel(right))
    || compareStrings(left.name, right.name)
    || compareStrings(left.id, right.id)
  ));

  for (const agent of sortedAgents) {
    const label = getAgentCatalogLabel(agent);
    const key = label.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.agents.push(agent);
      continue;
    }
    groups.set(key, { key, label, agents: [agent] });
  }

  return Array.from(groups.values());
}

export function isGitHubRepoUrl(value: string) {
  try {
    const url = new URL(value);
    return ['github.com', 'www.github.com'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
