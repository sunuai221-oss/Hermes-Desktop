import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Circle, ExternalLink, Save } from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import type { ContextFileInfo, ContextFilesResponse } from '../types';

type FilterKind = 'all' | 'startup' | 'nested' | 'cursor-module';

const FILTER_OPTIONS: { value: FilterKind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'startup', label: 'Startup' },
  { value: 'nested', label: 'Nested' },
  { value: 'cursor-module', label: 'Cursor' },
];

const KIND_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  startup:       { label: 'startup', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  nested:        { label: 'nested',  bg: 'bg-sky-500/10',     text: 'text-sky-400' },
  'cursor-module': { label: 'cursor', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  soul:          { label: 'soul',    bg: 'bg-amber-500/10',   text: 'text-amber-400' },
};

function sortContextFiles(files: ContextFileInfo[]) {
  return [...files].sort((a, b) => {
    const aAgents = a.name === 'AGENTS.md' ? 0 : 1;
    const bAgents = b.name === 'AGENTS.md' ? 0 : 1;
    if (aAgents !== bAgents) return aAgents - bAgents;
    return a.path.localeCompare(b.path);
  });
}

function pickDefaultPath(payload: ContextFilesResponse) {
  const startupAgents = payload.startupCandidates.find(f => f.name === 'AGENTS.md');
  if (startupAgents) return startupAgents.path;
  if (payload.startupWinner) return payload.startupWinner;
  const nestedAgents = payload.nestedCandidates.find(f => f.name === 'AGENTS.md');
  if (nestedAgents) return nestedAgents.path;
  return payload.startupCandidates[0]?.path
    || payload.nestedCandidates[0]?.path
    || payload.cursorModules[0]?.path
    || null;
}

export function ContextFilesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ContextFilesResponse | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<FilterKind>('all');

  const load = useCallback(async () => {
    const res = await api.contextFiles.get();
    const payload: ContextFilesResponse = res.data;
    setData(payload);
    const allFiles = [
      ...payload.startupCandidates,
      ...payload.nestedCandidates,
      ...payload.cursorModules,
    ];
    setDrafts(Object.fromEntries(allFiles.map(f => [f.path, f.content])));
    setSelectedPath(current => current || pickDefaultPath(payload));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const allFiles = useMemo(() => {
    if (!data) return [];
    return sortContextFiles([
      ...data.startupCandidates,
      ...data.nestedCandidates,
      ...data.cursorModules,
    ]);
  }, [data]);

  const filteredFiles = useMemo(() => {
    if (filter === 'all') return allFiles;
    return allFiles.filter(f => f.kind === filter);
  }, [allFiles, filter]);

  const selected = useMemo(
    () => filteredFiles.find(f => f.path === selectedPath) || null,
    [filteredFiles, selectedPath],
  );

  const modifiedPaths = useMemo(() => {
    if (!data) return new Set<string>();
    const allOrig = [
      ...data.startupCandidates,
      ...data.nestedCandidates,
      ...data.cursorModules,
    ];
    return new Set(
      allOrig
        .filter(f => drafts[f.path] !== undefined && drafts[f.path] !== f.content)
        .map(f => f.path),
    );
  }, [data, drafts]);

  const hasDraftChanges = selected ? modifiedPaths.has(selected.path) : false;

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.contextFiles.save(selected.path, drafts[selected.path] || '');
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      key="contextFiles"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="max-w-7xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-semibold">
            Context <span className="text-primary">Files</span>
          </h2>
          {data?.workspaceRoot && (
            <p className="text-xs text-muted-foreground mt-1 font-mono truncate max-w-md">
              {data.workspaceRoot}
            </p>
          )}
        </div>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as FilterKind)}
          className="rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm focus:outline-none"
        >
          {FILTER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Soul redirect banner */}
      {data?.soul && (
        <button
          onClick={() => navigate('/identity')}
          className="w-full flex items-center justify-between gap-3 rounded-lg border border-amber-500/15 bg-amber-500/5 px-4 py-3 text-sm text-left hover:bg-amber-500/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-medium">SOUL.md</span>
            <span className="text-muted-foreground">is part of the active profile.</span>
          </div>
          <span className="flex items-center gap-1 text-amber-400 text-xs font-medium">
            Edit in Identity <ExternalLink size={12} />
          </span>
        </button>
      )}

      {/* Split pane */}
      <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-6">
        {/* List */}
        <Card className="p-6">
          <div className="space-y-2">
            {filteredFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-8 text-center">
                No context files detected{filter !== 'all' ? ` for "${FILTER_OPTIONS.find(o => o.value === filter)?.label}"` : ''}.
              </p>
            ) : (
              filteredFiles.map(file => {
                const badge = KIND_BADGE[file.kind] || KIND_BADGE.nested;
                const isModified = modifiedPaths.has(file.path);
                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                    className={`w-full text-left rounded-lg border p-3.5 transition-all ${
                      selectedPath === file.path
                        ? 'border-primary/30 bg-primary/8'
                        : 'border-border bg-muted/50 hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm truncate">{file.name}</p>
                          {isModified && (
                            <Circle size={8} className="fill-amber-400 text-amber-400 shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{file.path}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {file.selectedAtStartup && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                            active
                          </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Editor */}
        <Card className="p-6">
          {!selected ? (
            <p className="text-sm text-muted-foreground italic py-12 text-center">
              Select a context file to view or edit.
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold">{selected.name}</h3>
                    {hasDraftChanges && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                        modified
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 break-all font-mono">{selected.path}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selected.charCount} chars{selected.truncated ? ' · preview truncated' : ''}
                  </p>
                </div>
                <button
                  onClick={save}
                  disabled={saving || !hasDraftChanges}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                    hasDraftChanges
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground cursor-default'
                  } disabled:opacity-40`}
                >
                  {saving ? 'Saving...' : <><Save size={14} />Save</>}
                </button>
              </div>

              {selected.truncated && (
                <div className="mb-4 rounded-lg border border-amber-500/12 bg-amber-500/5 p-4 text-sm text-amber-500">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <AlertTriangle size={14} />
                    Truncated preview
                  </div>
                  <p>Showing a bounded preview. Hermes applies its own scan and truncation rules at runtime.</p>
                </div>
              )}

              <textarea
                value={drafts[selected.path] ?? selected.content}
                onChange={e => setDrafts(current => ({ ...current, [selected.path]: e.target.value }))}
                className="w-full min-h-[520px] bg-transparent rounded-lg border border-border p-5 font-mono text-sm leading-7 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
                spellCheck={false}
              />
            </>
          )}
        </Card>
      </div>
    </motion.div>
  );
}
