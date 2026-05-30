import { motion } from 'framer-motion';
import { Loader2, Save } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { KanbanTaskForm } from './kanbanUtils';
import { Field, SelectField, TextArea } from './KanbanControls';

export function TaskForm({ form, assigneeNames, skillNames, saving, onCancel, onChange, onSubmit }: {
  form: KanbanTaskForm;
  assigneeNames: string[];
  skillNames: string[];
  saving: boolean;
  onCancel: () => void;
  onChange: (form: KanbanTaskForm) => void;
  onSubmit: () => void;
}) {
  const toggleSkill = (skill: string) => {
    onChange({
      ...form,
      skills: form.skills.includes(skill)
        ? form.skills.filter(item => item !== skill)
        : [...form.skills, skill],
    });
  };

  const isTriage = form.triage;

  return (
    <div className="space-y-4">
      <Field label="Title *" value={form.title} onChange={value => onChange({ ...form, title: value })} required />
      <TextArea label="Body" value={form.body} onChange={value => onChange({ ...form, body: value })} />

      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Assignee" value={form.assignee} onChange={value => onChange({ ...form, assignee: value })} options={assigneeNames} emptyLabel="Unassigned" />
        <SelectField label="Priority" value={form.priority} onChange={value => onChange({ ...form, priority: value })} options={['0', '1', '2', '3']} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tenant" value={form.tenant} onChange={value => onChange({ ...form, tenant: value })} />
        <SelectField
          label="Workspace"
          value={form.workspace}
          onChange={value => onChange({ ...form, workspace: value })}
          options={['scratch', 'worktree']}
        />
      </div>

      <Field label="Parents" value={form.parents} onChange={value => onChange({ ...form, parents: value })} placeholder="task ids, comma-separated" />

      <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={form.triage}
          onChange={event => onChange({ ...form, triage: event.target.checked })}
          className="h-4 w-4 accent-brand-amber"
        />
        Triage (agent-executable task)
      </label>

      {isTriage && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="grid grid-cols-2 gap-3"
        >
          <Field label="Max runtime" value={form.maxRuntime} onChange={value => onChange({ ...form, maxRuntime: value })} placeholder="30m" />
          <Field label="Max retries" value={form.maxRetries} onChange={value => onChange({ ...form, maxRetries: value })} placeholder="3" />
        </motion.div>
      )}

      {skillNames.length > 0 && (
        <div>
          <label className="mb-2 block text-xs text-muted-foreground">Skills</label>
          <div className="max-h-[120px] overflow-y-auto">
            <div className="flex flex-wrap gap-1.5">
              {skillNames.map(skill => (
                <button
                  key={skill}
                  type="button"
                  onClick={() => toggleSkill(skill)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    form.skills.includes(skill)
                      ? 'border-brand-amber/25 bg-brand-amber/10 text-brand-amber font-medium'
                      : 'border-border/60 bg-muted/60 text-muted-foreground hover:border-brand-amber/20',
                  )}
                >
                  {skill}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/60 px-4 py-2.5 text-sm font-medium hover:bg-muted/80"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={saving || !form.title.trim()}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-amber px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-amber/90 disabled:opacity-40"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Create task
        </button>
      </div>
    </div>
  );
}
