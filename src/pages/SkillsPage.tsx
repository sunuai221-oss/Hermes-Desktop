import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Loader2, Plus, Trash2, X, Puzzle, ExternalLink,
} from 'lucide-react';
import { Card } from '../components/Card';
import { useFeedback } from '../contexts/FeedbackContext';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { SkillInfo } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';

export function SkillsPage() {
  const gateway = useGatewayContext();
  const { confirm } = useFeedback();
  const [skills, setSkills] = useState<SkillInfo[]>(gateway.skills);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [original, setOriginal] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createCategory, setCreateCategory] = useState('');
  const [creating, setCreating] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => { setSkills(gateway.skills); }, [gateway.skills]);

  const localSkills = useMemo(() => skills.filter(s => s.source !== 'external'), [skills]);
  const externalSkills = useMemo(() => skills.filter(s => s.source === 'external'), [skills]);
  const selectedSkill = useMemo(() => localSkills.find(s => s.path === selectedPath) || null, [localSkills, selectedPath]);
  const hasChanges = editor !== original;

  // Auto-select first
  useEffect(() => {
    if (localSkills.length > 0 && !selectedPath) setSelectedPath(localSkills[0].path);
  }, [localSkills, selectedPath]);

  // Load skill content
  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setLoadingDoc(true);
    setStatusMsg(null);
    api.skills.getContent(selectedPath)
      .then(res => { if (!cancelled) { const c = String(res.data?.content || ''); setEditor(c); setOriginal(c); } })
      .catch(() => { if (!cancelled) { setEditor(''); setOriginal(''); setStatusMsg({ text: 'Could not read skill.', tone: 'error' }); } })
      .finally(() => { if (!cancelled) setLoadingDoc(false); });
    return () => { cancelled = true; };
  }, [selectedPath]);

  const refresh = async (preferred?: string) => {
    const res = await api.skills.list();
    const next = Array.isArray(res.data) ? res.data : [];
    setSkills(next);
    const nextLocal = next.filter((s: SkillInfo) => s.source !== 'external');
    if (preferred && nextLocal.some((s: SkillInfo) => s.path === preferred)) { setSelectedPath(preferred); return; }
    setSelectedPath(nextLocal[0]?.path || null);
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const res = await api.skills.create({ name: createName.trim(), category: createCategory.trim() || undefined });
      await refresh(String(res.data?.skill?.path || ''));
      setCreateName(''); setCreateCategory(''); setShowCreate(false);
      setStatusMsg({ text: 'Skill created.', tone: 'success' });
    } catch { setStatusMsg({ text: 'Could not create skill.', tone: 'error' }); }
    finally { setCreating(false); }
  };

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSavingDoc(true);
    try {
      await api.skills.save(selectedSkill.path, editor);
      setOriginal(editor);
      setStatusMsg({ text: 'Saved.', tone: 'success' });
      await refresh(selectedSkill.path);
    } catch { setStatusMsg({ text: 'Could not save.', tone: 'error' }); }
    finally { setSavingDoc(false); }
  };

  const handleDelete = async () => {
    if (!selectedSkill) return;
    const ok = await confirm({ title: 'Delete skill', message: `Delete "${selectedSkill.name}"?`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.skills.delete(selectedSkill.path);
      await refresh();
      setStatusMsg({ text: 'Deleted.', tone: 'success' });
    } catch { setStatusMsg({ text: 'Could not delete.', tone: 'error' }); }
  };

  return (
    <motion.div key="skills" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Skills</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {localSkills.length} local · {externalSkills.length} external
          </p>
        </div>
        <button onClick={() => setShowCreate(v => !v)} className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', showCreate ? 'bg-muted text-foreground' : 'bg-primary/10 text-primary hover:bg-primary/15')}>
          {showCreate ? <><X size={13} /> Cancel</> : <><Plus size={13} /> New skill</>}
        </button>
      </div>

      {/* Create form — collapsible */}
      {showCreate && (
        <Card className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-3">
            <input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Skill name (e.g. deploy-checks)" className="bg-muted/30 border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <input value={createCategory} onChange={e => setCreateCategory(e.target.value)} placeholder="Category" className="bg-muted/30 border border-border/60 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <button onClick={handleCreate} disabled={creating || !createName.trim()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
              {creating ? <Loader2 size={14} className="animate-spin" /> : 'Create'}
            </button>
          </div>
        </Card>
      )}

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
        {/* Skill list */}
        <Card className="p-3 h-fit max-h-[70vh] overflow-auto">
          {localSkills.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground/50">No local skills.</p>
          ) : (
            <div className="space-y-0.5">
              {localSkills.map(skill => (
                <button
                  key={skill.path}
                  onClick={() => setSelectedPath(skill.path)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg transition-colors',
                    selectedPath === skill.path ? 'bg-primary/8 border border-primary/15' : 'hover:bg-muted/50 border border-transparent',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Puzzle size={13} className="text-muted-foreground/50 flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{skill.name}</span>
                  </div>
                  {skill.category && <p className="text-[10px] text-muted-foreground/50 mt-0.5 ml-5">{skill.category}</p>}
                </button>
              ))}
            </div>
          )}

          {externalSkills.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30">
              <p className="px-3 pb-2 text-[10px] font-medium text-muted-foreground/40 uppercase tracking-wider">External</p>
              {externalSkills.map(skill => (
                <div key={skill.path} className="px-3 py-1.5 flex items-center gap-2">
                  <ExternalLink size={11} className="text-muted-foreground/30 flex-shrink-0" />
                  <span className="text-xs text-muted-foreground truncate">{skill.name}</span>
                  {skill.version && <span className="text-[9px] text-muted-foreground/30">v{skill.version}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Editor */}
        <Card className="overflow-hidden">
          {!selectedSkill ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-sm text-muted-foreground/50">Select a skill or create one.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
                <div>
                  <div className="flex items-center gap-2">
                    <Puzzle size={14} className="text-primary" />
                    <span className="text-sm font-medium">{selectedSkill.name}</span>
                    {hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate max-w-md">{selectedSkill.path}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedSkill.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{selectedSkill.category}</span>}
                  <button onClick={handleSave} disabled={savingDoc || loadingDoc || !hasChanges} className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', 'bg-primary/10 text-primary hover:bg-primary/15', (savingDoc || !hasChanges) && 'opacity-40')}>
                    {savingDoc ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
                  </button>
                  <button onClick={handleDelete} className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-destructive hover:bg-destructive/5 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {loadingDoc ? (
                <div className="flex items-center justify-center h-[400px]"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
              ) : (
                <textarea
                  value={editor}
                  onChange={e => setEditor(e.target.value)}
                  className="w-full min-h-[400px] bg-transparent p-5 font-mono text-sm leading-7 focus:outline-none resize-y"
                  spellCheck={false}
                  placeholder="# Skill content&#10;&#10;Describe when and how to use..."
                />
              )}

              {statusMsg && (
                <div className={cn('px-5 py-2 text-xs border-t', statusMsg.tone === 'error' ? 'border-red-500/15 text-destructive bg-red-500/5' : 'border-green-500/15 text-success bg-green-500/5')}>
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
