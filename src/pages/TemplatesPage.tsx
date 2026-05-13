import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { useGatewayContext } from '../contexts/GatewayContext';
import { PreferredSkillsPicker } from '../features/templates/components/PreferredSkillsPicker';
import { TemplatesLibraryPanel } from '../features/templates/components/TemplatesLibraryPanel';
import { useTemplatesLibrary } from '../features/templates/hooks/useTemplatesLibrary';
import { getAgentCatalogLabel, inferAgentSubgroup } from '../lib/agentCatalog';
import { recommendSkillsForAgent } from '../lib/skillRecommendations';
import { cn } from '../lib/utils';
import type { AgentDefinition } from '../types';

function createTemplateDraft(seed = Date.now()): Partial<AgentDefinition> {
  return {
    source: 'user',
    name: `template-${String(seed).slice(-4)}`,
    slug: `template-${String(seed).slice(-4)}`,
    description: '',
    soul: [
      '# Identity',
      '',
      'You are a pragmatic Hermes-based specialist.',
      '',
      '## Style',
      '- Be direct',
      '- Be useful',
      '- Stay grounded in operational reality',
    ].join('\n'),
    preferredSkills: [],
    preferredToolsets: [],
    tags: [],
  };
}

function splitCsv(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function toCsv(value?: string[]) {
  return (value || []).join(', ');
}

function sameStringList(left?: string[], right?: string[]) {
  const a = left || [];
  const b = right || [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function formatError(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; details?: string } } }).response;
    return response?.data?.error || response?.data?.details || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function TemplatesPage() {
  const gateway = useGatewayContext();
  const {
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
    error: libraryError,
    clearError: clearLibraryError,
    sources,
    divisions,
    groupedTemplates,
    loadBundledAgencyCatalog,
    syncDefaultAgencyRepo,
    importAgencySource,
  } = useTemplatesLibrary();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestingAllSkills, setSuggestingAllSkills] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setActiveId(current => {
      if (current && templates.some(template => template.id === current)) return current;
      return templates[0]?.id || null;
    });
  }, [templates]);

  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === activeId) || null,
    [activeId, templates],
  );
  const models = useMemo(() => gateway.models.map(model => model.name), [gateway.models]);
  const displayError = error || libraryError;

  const patchSelectedTemplate = (patch: Partial<AgentDefinition>) => {
    if (!selectedTemplate) return;
    setTemplates(current => current.map(template =>
      template.id === selectedTemplate.id
        ? { ...template, ...patch, updatedAt: new Date().toISOString() }
        : template,
    ));
  };

  const replaceTemplate = (template: AgentDefinition) => {
    setTemplates(current => current.map(item => (item.id === template.id ? template : item)));
  };

  const createTemplate = async () => {
    setCreating(true);
    setError('');
    clearLibraryError();
    setStatus('');
    try {
      const res = await api.agentStudio.createAgent(createTemplateDraft());
      setTemplates(current => [res.data.agent, ...current]);
      setActiveId(res.data.agent.id);
      setStatus('Template created.');
    } catch (createError) {
      setError(formatError(createError, 'Could not create template.'));
    } finally {
      setCreating(false);
    }
  };

  const duplicateTemplate = async () => {
    if (!selectedTemplate) return;
    setCreating(true);
    setError('');
    clearLibraryError();
    setStatus('');
    try {
      const res = await api.agentStudio.createAgent({
        ...selectedTemplate,
        id: undefined,
        source: 'user',
        name: `${selectedTemplate.name} copy`,
        slug: `${selectedTemplate.slug || selectedTemplate.name}-copy`,
      });
      setTemplates(current => [res.data.agent, ...current]);
      setActiveId(res.data.agent.id);
      setStatus('Template duplicated.');
    } catch (duplicateError) {
      setError(formatError(duplicateError, 'Could not duplicate template.'));
    } finally {
      setCreating(false);
    }
  };

  const saveTemplate = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    setError('');
    clearLibraryError();
    setStatus('');
    try {
      const res = await api.agentStudio.updateAgent(selectedTemplate.id, selectedTemplate);
      replaceTemplate(res.data.agent);
      setStatus('Template saved.');
    } catch (saveError) {
      setError(formatError(saveError, 'Could not save template.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!selectedTemplate) return;
    setDeletingId(selectedTemplate.id);
    setError('');
    clearLibraryError();
    setStatus('');
    try {
      await api.agentStudio.deleteAgent(selectedTemplate.id);
      const remaining = templates.filter(template => template.id !== selectedTemplate.id);
      setTemplates(remaining);
      setActiveId(remaining[0]?.id || null);
      setStatus('Template deleted.');
    } catch (deleteError) {
      setError(formatError(deleteError, 'Could not delete template.'));
    } finally {
      setDeletingId(null);
    }
  };

  const applyTemplate = async () => {
    if (!selectedTemplate) return;
    setApplyingId(selectedTemplate.id);
    setError('');
    clearLibraryError();
    setStatus('');
    try {
      await api.agentStudio.applyAgent(selectedTemplate.id);
      setStatus('Template soul applied to the active profile.');
    } catch (applyError) {
      setError(formatError(applyError, 'Could not apply template soul.'));
    } finally {
      setApplyingId(null);
    }
  };

  const applySuggestedSkillsToAll = async () => {
    if (gateway.skills.length === 0 || templates.length === 0) return;
    setSuggestingAllSkills(true);
    setError('');
    clearLibraryError();
    setStatus('');
    try {
      const updates = templates
        .map(template => ({
          id: template.id,
          preferredSkills: recommendSkillsForAgent(template, gateway.skills),
        }))
        .filter(update => (
          update.preferredSkills.length > 0
          && !sameStringList(
            templates.find(template => template.id === update.id)?.preferredSkills,
            update.preferredSkills,
          )
        ));

      if (updates.length === 0) {
        setStatus('Preferred skills are already up to date.');
        return;
      }

      try {
        const res = await api.agentStudio.updatePreferredSkills(updates);
        setTemplates(Array.isArray(res.data.agents) ? res.data.agents : templates);
        setStatus(`Suggested skills applied to ${res.data.updated} templates.`);
      } catch (bulkError) {
        const statusCode = typeof bulkError === 'object' && bulkError && 'response' in bulkError
          ? (bulkError as { response?: { status?: number } }).response?.status
          : undefined;
        if (statusCode && statusCode !== 404 && statusCode !== 405) throw bulkError;

        const updatedById = new Map<string, AgentDefinition>();
        for (const update of updates) {
          const template = templates.find(item => item.id === update.id);
          if (!template) continue;
          const res = await api.agentStudio.updateAgent(update.id, {
            ...template,
            preferredSkills: update.preferredSkills,
          });
          updatedById.set(update.id, res.data.agent);
        }
        setTemplates(current => current.map(template => updatedById.get(template.id) || template));
        setStatus(`Suggested skills applied to ${updatedById.size} templates.`);
      }
    } catch (suggestError) {
      setError(formatError(suggestError, 'Could not apply suggested skills.'));
    } finally {
      setSuggestingAllSkills(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 size={28} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const selectedSubgroup = selectedTemplate ? inferAgentSubgroup(selectedTemplate.sourcePath) : '';
  const selectedCatalog = selectedTemplate ? getAgentCatalogLabel(selectedTemplate) : '';

  return (
    <motion.div
      key="templates"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto max-w-7xl space-y-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Templates</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Reusable agent definitions for profiles and workspaces.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void createTemplate()}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            New
          </button>
          <button
            onClick={() => void saveTemplate()}
            disabled={!selectedTemplate || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Save
          </button>
          <button
            onClick={() => void applyTemplate()}
            disabled={!selectedTemplate || applyingId === selectedTemplate?.id}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            title="Apply template soul to active profile"
          >
            {applyingId === selectedTemplate?.id ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Apply Soul
          </button>
        </div>
      </div>

      {(displayError || status) && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            displayError ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-success/30 bg-success/10 text-success',
          )}
        >
          {displayError || status}
        </div>
      )}

      <div className="grid min-h-[680px] grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <TemplatesLibraryPanel
          title="Library"
          templates={templates}
          groupedTemplates={groupedTemplates}
          query={query}
          sourceFilter={sourceFilter}
          divisionFilter={divisionFilter}
          sources={sources}
          divisions={divisions}
          importValue={importValue}
          importSummary={importSummary}
          importing={importing}
          onQueryChange={setQuery}
          onSourceFilterChange={setSourceFilter}
          onDivisionFilterChange={setDivisionFilter}
          onImportValueChange={setImportValue}
          onImportBundled={() => void loadBundledAgencyCatalog()}
          onImportDefault={() => void syncDefaultAgencyRepo()}
          onImportSource={() => void importAgencySource()}
          activeTemplateId={activeId}
          onSelectTemplate={setActiveId}
        />

        <Card className="min-h-[680px] p-5">
          {!selectedTemplate ? (
            <div className="flex h-full min-h-[520px] items-center justify-center text-sm text-muted-foreground">
              Select or create a template.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{selectedTemplate.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{selectedTemplate.source}{selectedTemplate.sourcePath ? ` / ${selectedTemplate.sourcePath}` : ''}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{selectedCatalog}</span>
                    {selectedSubgroup && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{selectedSubgroup}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void duplicateTemplate()}
                    disabled={creating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Copy size={14} />
                    Duplicate
                  </button>
                  <button
                    onClick={() => void deleteTemplate()}
                    disabled={deletingId === selectedTemplate.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {deletingId === selectedTemplate.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Name" value={selectedTemplate.name} onChange={value => patchSelectedTemplate({ name: value })} />
                <Field label="Slug" value={selectedTemplate.slug || ''} onChange={value => patchSelectedTemplate({ slug: value })} />
                <Field label="Default model" value={selectedTemplate.defaultModel || ''} onChange={value => patchSelectedTemplate({ defaultModel: value })} listId="template-models" />
                <Field label="Division" value={selectedTemplate.division || ''} onChange={value => patchSelectedTemplate({ division: value })} />
              </div>

              <Field label="Description" value={selectedTemplate.description || ''} onChange={value => patchSelectedTemplate({ description: value })} />

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Soul</label>
                <textarea
                  value={selectedTemplate.soul}
                  onChange={event => patchSelectedTemplate({ soul: event.target.value })}
                  className="min-h-[260px] w-full resize-y rounded-xl border border-border/60 bg-muted/30 px-4 py-3 font-mono text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  spellCheck={false}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <PreferredSkillsPicker
                  agent={selectedTemplate}
                  skills={gateway.skills}
                  value={selectedTemplate.preferredSkills}
                  onChange={preferredSkills => patchSelectedTemplate({ preferredSkills })}
                  onSuggestAll={() => void applySuggestedSkillsToAll()}
                  suggestingAll={suggestingAllSkills}
                />
                <Field
                  label="Toolsets"
                  value={toCsv(selectedTemplate.preferredToolsets)}
                  onChange={value => patchSelectedTemplate({ preferredToolsets: splitCsv(value) })}
                  placeholder="file, terminal, web"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Tags" value={toCsv(selectedTemplate.tags)} onChange={value => patchSelectedTemplate({ tags: splitCsv(value) })} />
                <Field label="Vibe" value={selectedTemplate.vibe || ''} onChange={value => patchSelectedTemplate({ vibe: value })} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <TemplateTextArea label="Workflow" value={selectedTemplate.workflow || ''} onChange={value => patchSelectedTemplate({ workflow: value })} />
                <TemplateTextArea label="Deliverables" value={selectedTemplate.deliverables || ''} onChange={value => patchSelectedTemplate({ deliverables: value })} />
              </div>
            </div>
          )}
        </Card>
      </div>

      <datalist id="template-models">
        {models.map(model => <option key={model} value={model} />)}
      </datalist>
    </motion.div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  listId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  listId?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        list={listId}
        className="w-full rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function TemplateTextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-h-[120px] w-full resize-y rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}
