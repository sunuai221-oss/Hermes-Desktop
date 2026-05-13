import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../../api';
import {
  DEFAULT_AGENCY_REPO_BRANCH,
  DEFAULT_AGENCY_REPO_URL,
  groupAgentsByCatalog,
  isGitHubRepoUrl,
} from '../../../lib/agentCatalog';
import type { AgentDefinition } from '../../../types';

type UseTemplatesLibraryLoadResult =
  | { ok: true; templates: AgentDefinition[] }
  | { ok: false; error: string };

function formatError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; details?: string } } }).response;
    return response?.data?.error || response?.data?.details || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function buildImportSummary(label: string, imported: number, updated: number, skipped: number) {
  return `${label}: ${imported} imported, ${updated} updated, ${skipped} skipped.`;
}

type UseTemplatesLibraryOptions = {
  autoLoad?: boolean;
};

export function useTemplatesLibrary({ autoLoad = true }: UseTemplatesLibraryOptions = {}) {
  const [templates, setTemplates] = useState<AgentDefinition[]>([]);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [divisionFilter, setDivisionFilter] = useState('all');
  const [importValue, setImportValue] = useState('');
  const [importSummary, setImportSummary] = useState('');
  const [loading, setLoading] = useState(autoLoad);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const clearError = useCallback(() => setError(''), []);

  const loadTemplates = useCallback(async (): Promise<UseTemplatesLibraryLoadResult> => {
    setLoading(true);
    setError('');
    try {
      const res = await api.agentStudio.library();
      const nextTemplates = Array.isArray(res.data.agents) ? res.data.agents : [];
      setTemplates(nextTemplates);
      return { ok: true, templates: nextTemplates };
    } catch (loadError) {
      const message = formatError(loadError, 'Could not load templates.');
      setError(message);
      return { ok: false, error: message };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoLoad) return;
    void loadTemplates();
  }, [autoLoad, loadTemplates]);

  const runAgencyImport = useCallback(async (
    payload: { bundled?: boolean; rootPath?: string; repoUrl?: string; branch?: string },
    summaryLabel: string,
  ) => {
    setImporting(true);
    setError('');
    setImportSummary('');
    try {
      const res = await api.agentStudio.importAgency(payload);
      const nextTemplates = Array.isArray(res.data.agents) ? res.data.agents : [];
      setTemplates(nextTemplates);
      setImportSummary(buildImportSummary(summaryLabel, res.data.imported, res.data.updated, res.data.skipped));
    } catch (importError) {
      setError(formatError(importError, 'Could not import agency agents.'));
    } finally {
      setImporting(false);
    }
  }, []);

  const syncDefaultAgencyRepo = useCallback(async () => {
    await runAgencyImport(
      { repoUrl: DEFAULT_AGENCY_REPO_URL, branch: DEFAULT_AGENCY_REPO_BRANCH },
      'Synced official agency-agents repo',
    );
  }, [runAgencyImport]);

  const loadBundledAgencyCatalog = useCallback(async () => {
    await runAgencyImport(
      { bundled: true },
      'Loaded bundled offline agency catalog',
    );
  }, [runAgencyImport]);

  const importAgencySource = useCallback(async () => {
    const value = importValue.trim();
    if (!value) {
      setError('Paste a local agency-agents folder path or a GitHub repo URL first.');
      return;
    }

    if (isGitHubRepoUrl(value)) {
      await runAgencyImport({ repoUrl: value }, 'Synced GitHub agency repo');
      return;
    }

    await runAgencyImport({ rootPath: value }, 'Imported local agency-agents folder');
  }, [importValue, runAgencyImport]);

  const sources = useMemo(() => Array.from(new Set(templates.map(template => template.source))).sort(), [templates]);
  const divisions = useMemo(
    () => Array.from(new Set(templates.map(template => template.division).filter(Boolean) as string[])).sort(),
    [templates],
  );

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return templates.filter(template => {
      if (sourceFilter !== 'all' && template.source !== sourceFilter) return false;
      if (divisionFilter !== 'all' && template.division !== divisionFilter) return false;
      if (!normalizedQuery) return true;
      return [template.name, template.description, template.slug, template.division, template.sourcePath, template.vibe]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [divisionFilter, query, sourceFilter, templates]);

  const groupedTemplates = useMemo(() => groupAgentsByCatalog(filteredTemplates), [filteredTemplates]);

  return {
    templates,
    setTemplates,
    query,
    setQuery,
    sourceFilter,
    setSourceFilter,
    divisionFilter,
    setDivisionFilter,
    importValue,
    setImportValue,
    importSummary,
    loading,
    importing,
    error,
    clearError,
    sources,
    divisions,
    filteredTemplates,
    groupedTemplates,
    loadTemplates,
    loadBundledAgencyCatalog,
    syncDefaultAgencyRepo,
    importAgencySource,
  };
}
