import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ExternalLink, Loader2, Plus, Power, Puzzle, Search, Trash2, X,
} from 'lucide-react';
import { Card } from '../components/Card';
import { useFeedback } from '../contexts/FeedbackContext';
import { useGatewayContext } from '../contexts/GatewayContext';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { SkillInfo } from '../types';

type SkillFilter = 'all' | 'enabled' | 'disabled' | 'local' | 'external';

function isSkillEnabled(skill: SkillInfo) {
  return skill.enabled !== false;
}

export function SkillsPage() {
  const gateway = useGatewayContext();
  const { confirm } = useFeedback();
  const [skills, setSkills] = useState<SkillInfo[]>(gateway.skills);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SkillFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [original, setOriginal] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createCategory, setCreateCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [togglingPath, setTogglingPath] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => { setSkills(gateway.skills); }, [gateway.skills]);

  const localSkills = useMemo(() => skills.filter(s => s.source !== 'external'), [skills]);
  const externalSkills = useMemo(() => skills.filter(s => s.source === 'external'), [skills]);
  const enabledCount = useMemo(() => localSkills.filter(isSkillEnabled).length, [localSkills]);
  const disabledCount = localSkills.length - enabledCount;
  const selectedSkill = useMemo(() => localSkills.find(s => s.path === selectedPath) || null, [localSkills, selectedPath]);
  const hasChanges = editor !== original;

  const categoryOptions = useMemo(() => (
    Array.from(new Set(skills.map(s => s.category || 'root'))).sort((a, b) => a.localeCompare(b))
  ), [skills]);

  const matchesFilters = useCallback((skill: SkillInfo) => {
    const searchText = search.trim().toLowerCase();
    const haystack = [
      skill.name,
      skill.description,
      skill.category,
      skill.version,
      skill.id,
      ...(skill.tags || []),
    ].filter(Boolean).join(' ').toLowerCase();
    const textMatch = !searchText || haystack.includes(searchText);
    const categoryMatch = categoryFilter === 'all' || (skill.category || 'root') === categoryFilter;
    const stateMatch = statusFilter === 'all'
      || (statusFilter === 'enabled' && isSkillEnabled(skill))
      || (statusFilter === 'disabled' && !isSkillEnabled(skill))
      || (statusFilter === 'local' && skill.source !== 'external')
      || (statusFilter === 'external' && skill.source === 'external');
    return textMatch && categoryMatch && stateMatch;
  }, [search, categoryFilter, statusFilter]);

  const filteredLocalSkills = useMemo(
    () => localSkills.filter(matchesFilters),
    [localSkills, matchesFilters],
  );
  const filteredExternalSkills = useMemo(
    () => externalSkills.filter(matchesFilters),
    [externalSkills, matchesFilters],
  );

  useEffect(() => {
    if (localSkills.length > 0 && !selectedPath) setSelectedPath(localSkills[0].path);
  }, [localSkills, selectedPath]);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setLoadingDoc(true);
    setStatusMsg(null);
    api.skills.getContent(selectedPath)
      .then(res => {
        if (!cancelled) {
          const c = String(res.data?.content || '');
          setEditor(c);
          setOriginal(c);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEditor('');
          setOriginal('');
          setStatusMsg({ text: 'Could not read skill.', tone: 'error' });
        }
      })
      .finally(() => { if (!cancelled) setLoadingDoc(false); });
    return () => { cancelled = true; };
  }, [selectedPath]);

  const refresh = async (preferred?: string) => {
    const res = await api.skills.list();
    const next = Array.isArray(res.data) ? res.data : [];
    setSkills(next);
    const nextLocal = next.filter((s: SkillInfo) => s.source !== 'external');
    if (preferred && nextLocal.some((s: SkillInfo) => s.path === preferred)) {
      setSelectedPath(preferred);
      return;
    }
    setSelectedPath(nextLocal[0]?.path || null);
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const res = await api.skills.create({ name: createName.trim(), category: createCategory.trim() || undefined });
      await refresh(String(res.data?.skill?.path || ''));
      setCreateName('');
      setCreateCategory('');
      setShowCreate(false);
      setStatusMsg({ text: 'Skill created.', tone: 'success' });
    } catch {
      setStatusMsg({ text: 'Could not create skill.', tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSavingDoc(true);
    try {
      await api.skills.save(selectedSkill.path, editor);
      setOriginal(editor);
      setStatusMsg({ text: 'Saved.', tone: 'success' });
      await refresh(selectedSkill.path);
    } catch {
      setStatusMsg({ text: 'Could not save.', tone: 'error' });
    } finally {
      setSavingDoc(false);
    }
  };

  const handleToggleSkill = async (skill: SkillInfo, enabled: boolean) => {
    if (skill.source === 'external') return;
    const previous = skills;
    setTogglingPath(skill.path);
    setStatusMsg(null);
    setSkills(current => current.map(item => item.path === skill.path
      ? { ...item, enabled, disabledReason: enabled ? undefined : 'disabled in config.yaml' }
      : item
    ));
    try {
      await api.skills.setEnabled(skill.path, enabled);
      await refresh(skill.path);
      setStatusMsg({ text: enabled ? 'Skill enabled.' : 'Skill disabled.', tone: 'success' });
    } catch {
      setSkills(previous);
      setStatusMsg({ text: 'Could not update skill state.', tone: 'error' });
    } finally {
      setTogglingPath(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedSkill) return;
    const ok = await confirm({ title: 'Delete skill', message: `Delete "${selectedSkill.name}"?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.skills.delete(selectedSkill.path);
      await refresh();
      setStatusMsg({ text: 'Deleted.', tone: 'success' });
    } catch {
      setStatusMsg({ text: 'Could not delete.', tone: 'error' });
    }
  };

  return (
    <motion.div
      key="skills"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto max-w-6xl space-y-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Skills</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {localSkills.length} local | {enabledCount} enabled | {disabledCount} disabled | {externalSkills.length} external
          </p>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            showCreate ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary hover:bg-primary/15',
          )}
        >
          {showCreate ? <><X size={13} /> Cancel</> : <><Plus size={13} /> New skill</>}
        </button>
      </div>

      {showCreate && (
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_auto]">
            <input
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              placeholder="Skill name (e.g. deploy-checks)"
              className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              value={createCategory}
              onChange={e => setCreateCategory(e.target.value)}
              placeholder="Category"
              className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
            </button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit max-h-[72vh] overflow-auto p-3">
          <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-3 space-y-2 border-b border-border/30 bg-card/95 p-3 backdrop-blur">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/45" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search skills"
                className="w-full rounded-lg border border-border/60 bg-muted/30 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="min-w-0 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs focus:outline-none"
                title="Category"
              >
                <option value="all">All categories</option>
                {categoryOptions.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as SkillFilter)}
                className="rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs focus:outline-none"
                title="State"
              >
                <option value="all">All</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
                <option value="local">Local</option>
                <option value="external">External</option>
              </select>
            </div>
          </div>

          {filteredLocalSkills.length === 0 && filteredExternalSkills.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground/50">No skills match.</p>
          ) : (
            <div className="space-y-0.5">
              {filteredLocalSkills.map(skill => (
                <button
                  key={skill.path}
                  onClick={() => setSelectedPath(skill.path)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    selectedPath === skill.path ? 'border-primary/15 bg-primary/8' : 'border-transparent hover:bg-muted/50',
                    !isSkillEnabled(skill) && 'opacity-70',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Puzzle size={13} className="flex-shrink-0 text-muted-foreground/50" />
                    <span className={cn(
                      'min-w-0 flex-1 truncate text-sm font-medium',
                      !isSkillEnabled(skill) && 'text-muted-foreground line-through decoration-muted-foreground/50',
                    )}>
                      {skill.name}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 pl-5">
                    <p className="truncate text-[10px] text-muted-foreground/50">{skill.category || 'root'}</p>
                    <SkillSwitch
                      enabled={isSkillEnabled(skill)}
                      busy={togglingPath === skill.path}
                      onChange={(enabled) => void handleToggleSkill(skill, enabled)}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}

          {filteredExternalSkills.length > 0 && (
            <div className="mt-3 border-t border-border/30 pt-3">
              <p className="px-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40">External</p>
              {filteredExternalSkills.map(skill => (
                <div key={skill.path} className="flex items-center gap-2 px-3 py-1.5">
                  <ExternalLink size={11} className="flex-shrink-0 text-muted-foreground/30" />
                  <span className="truncate text-xs text-muted-foreground">{skill.name}</span>
                  {skill.version && <span className="text-[9px] text-muted-foreground/30">v{skill.version}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          {!selectedSkill ? (
            <div className="flex h-48 items-center justify-center">
              <p className="text-sm text-muted-foreground/50">Select a skill or create one.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-border/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Puzzle size={14} className="text-primary" />
                    <span className="truncate text-sm font-medium">{selectedSkill.name}</span>
                    {hasChanges && <span className="h-1.5 w-1.5 rounded-full bg-warning" />}
                  </div>
                  <p className="mt-0.5 max-w-xl truncate font-mono text-[10px] text-muted-foreground">{selectedSkill.path}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <SkillSwitch
                    enabled={isSkillEnabled(selectedSkill)}
                    busy={togglingPath === selectedSkill.path}
                    onChange={(enabled) => void handleToggleSkill(selectedSkill, enabled)}
                  />
                  {!isSkillEnabled(selectedSkill) && <SkillStateBadge skill={selectedSkill} />}
                  {selectedSkill.category && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{selectedSkill.category}</span>}
                  <button
                    onClick={handleSave}
                    disabled={savingDoc || loadingDoc || !hasChanges}
                    className={cn(
                      'rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15',
                      (savingDoc || !hasChanges) && 'opacity-40',
                    )}
                  >
                    {savingDoc ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="rounded-lg p-1.5 text-muted-foreground/50 transition-colors hover:bg-destructive/5 hover:text-destructive"
                    title="Delete skill"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {loadingDoc ? (
                <div className="flex h-[400px] items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-muted-foreground" />
                </div>
              ) : (
                <textarea
                  value={editor}
                  onChange={e => setEditor(e.target.value)}
                  className="min-h-[440px] w-full resize-y bg-transparent p-5 font-mono text-sm leading-7 focus:outline-none"
                  spellCheck={false}
                  placeholder="# Skill content&#10;&#10;Describe when and how to use..."
                />
              )}

              {statusMsg && (
                <div className={cn(
                  'border-t px-5 py-2 text-xs',
                  statusMsg.tone === 'error'
                    ? 'border-red-500/15 bg-red-500/5 text-destructive'
                    : 'border-green-500/15 bg-green-500/5 text-success',
                )}>
                  {statusMsg.text}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </motion.div>
  );
}

function SkillStateBadge({ skill }: { skill: SkillInfo }) {
  const enabled = isSkillEnabled(skill);
  return (
    <span className={cn(
      'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium',
      enabled ? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground',
    )}>
      {enabled ? 'enabled' : 'disabled'}
    </span>
  );
}

function SkillSwitch({ enabled, busy, onChange }: {
  enabled: boolean;
  busy?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <span
      role="switch"
      aria-checked={enabled}
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        if (!busy) onChange(!enabled);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onChange(!enabled);
      }}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors',
        enabled ? 'border-primary/30 bg-muted/70' : 'border-border bg-muted',
        busy && 'cursor-wait opacity-60',
      )}
      title={enabled ? 'Disable skill' : 'Enable skill'}
    >
      <span className={cn(
        'grid h-4 w-4 place-items-center rounded-full bg-background shadow-sm transition-transform',
        enabled && 'translate-x-4',
      )}>
        {busy ? <Loader2 size={9} className="animate-spin" /> : <Power size={8} className="text-muted-foreground" />}
      </span>
    </span>
  );
}
