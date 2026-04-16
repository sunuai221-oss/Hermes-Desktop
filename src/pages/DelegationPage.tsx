import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  GitBranchPlus,
  Layers3,
  Minus,
  Plus,
  Send,
  Settings,
  SplitSquareVertical,
} from 'lucide-react';
import { Card } from '../components/Card';
import * as api from '../api';
import { cn } from '../lib/utils';
import type { HermesConfig } from '../types';
import { useGatewayContext } from '../contexts/GatewayContext';

type Toolset =
  | 'terminal' | 'file' | 'web' | 'browser' | 'vision'
  | 'memory' | 'delegation' | 'send_message' | 'clarify' | 'code_execution';

interface TaskDraft {
  goal: string;
  context: string;
  toolsets: Toolset[];
  maxIterations: string;
}

const TOOLSET_GROUPS: { label: string; items: Toolset[] }[] = [
  { label: 'Core', items: ['terminal', 'file', 'web', 'browser', 'vision'] },
  { label: 'Agent', items: ['memory', 'delegation', 'send_message', 'clarify', 'code_execution'] },
];

function createTaskDraft(defaultToolsets: Toolset[] = ['terminal', 'file', 'web']): TaskDraft {
  return {
    goal: '',
    context: '',
    toolsets: [...defaultToolsets],
    maxIterations: '',
  };
}

export function DelegationPage() {
  const gateway = useGatewayContext();
  const [configOpen, setConfigOpen] = useState(false);
  const [isConfigDirty, setIsConfigDirty] = useState(false);
  const [configDraft, setConfigDraft] = useState(() => ({
    max_iterations: String(gateway.config?.delegation?.max_iterations ?? 50),
    default_toolsets: (gateway.config?.delegation?.default_toolsets || ['terminal', 'file', 'web']).join(', '),
    model: gateway.config?.delegation?.model || '',
    provider: gateway.config?.delegation?.provider || '',
    base_url: gateway.config?.delegation?.base_url || '',
    api_key: gateway.config?.delegation?.api_key || '',
  }));
  const [savingConfig, setSavingConfig] = useState(false);
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [singleTask, setSingleTask] = useState<TaskDraft>(() => createTaskDraft());
  const [batchTasks, setBatchTasks] = useState<TaskDraft[]>(() => [createTaskDraft(), createTaskDraft(), createTaskDraft()]);

  // Get current default toolsets from config for new tasks
  const currentDefaults = useMemo<Toolset[]>(() => {
    const raw = configDraft.default_toolsets.split(',').map(s => s.trim()).filter(Boolean);
    return raw.length > 0 ? raw as Toolset[] : ['terminal', 'file', 'web'];
  }, [configDraft.default_toolsets]);

  const generatedPrompt = useMemo(() => {
    if (mode === 'single') {
      return buildSingleDelegatePrompt(singleTask);
    }
    return buildBatchDelegatePrompt(batchTasks.filter(task => task.goal.trim()));
  }, [mode, singleTask, batchTasks]);

  useEffect(() => {
    if (!gateway.config || isConfigDirty) return;
    setConfigDraft({
      max_iterations: String(gateway.config.delegation?.max_iterations ?? 50),
      default_toolsets: (gateway.config.delegation?.default_toolsets || ['terminal', 'file', 'web']).join(', '),
      model: gateway.config.delegation?.model || '',
      provider: gateway.config.delegation?.provider || '',
      base_url: gateway.config.delegation?.base_url || '',
      api_key: gateway.config.delegation?.api_key || '',
    });
  }, [gateway.config, isConfigDirty]);

  const saveConfig = async () => {
    const next: HermesConfig = JSON.parse(JSON.stringify(gateway.config || {}));
    if (!next.delegation) next.delegation = {};
    next.delegation.max_iterations = parseInt(configDraft.max_iterations, 10) || 50;
    next.delegation.default_toolsets = splitCsv(configDraft.default_toolsets);
    next.delegation.model = configDraft.model || undefined;
    next.delegation.provider = configDraft.provider || undefined;
    next.delegation.base_url = configDraft.base_url || undefined;
    next.delegation.api_key = configDraft.api_key || undefined;

    setSavingConfig(true);
    try {
      await api.config.save(next);
      setIsConfigDirty(false);
    } finally {
      setSavingConfig(false);
    }
  };

  const addBatchTask = () => {
    setBatchTasks(current => [...current, createTaskDraft(currentDefaults)]);
  };

  const removeBatchTask = (index: number) => {
    setBatchTasks(current => current.filter((_, i) => i !== index));
  };

  const sendToChat = () => {
    localStorage.setItem('hermes-chat-draft', generatedPrompt);
    localStorage.setItem('hermes-chat-draft-ts', String(Date.now()));
  };

  return (
    <motion.div
      key="delegation"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-7xl space-y-6"
    >
      {/* Header */}
      <div>
        <h2 className="text-3xl font-semibold">
          Subagent <span className="text-primary">Delegation</span>
        </h2>
      </div>

      {/* Config collapsible */}
      <div className="rounded-lg border border-border overflow-hidden">
        <button
          onClick={() => setConfigOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Settings size={14} className="text-muted-foreground" />
            Configuration
            {isConfigDirty && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">modified</span>
            )}
          </span>
          {configOpen ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </button>
        {configOpen && (
          <div className="border-t border-border p-6">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Field
                label="Max iterations"
                value={configDraft.max_iterations}
                onChange={v => { setIsConfigDirty(true); setConfigDraft(c => ({ ...c, max_iterations: v })); }}
              />
              <Field
                label="Default toolsets"
                value={configDraft.default_toolsets}
                onChange={v => { setIsConfigDirty(true); setConfigDraft(c => ({ ...c, default_toolsets: v })); }}
                placeholder="terminal, file, web"
              />
              <Field
                label="Model override"
                value={configDraft.model}
                onChange={v => { setIsConfigDirty(true); setConfigDraft(c => ({ ...c, model: v })); }}
                placeholder="google/gemini-3-flash-preview"
              />
              <Field
                label="Provider override"
                value={configDraft.provider}
                onChange={v => { setIsConfigDirty(true); setConfigDraft(c => ({ ...c, provider: v })); }}
                placeholder="openrouter"
              />
              <Field
                label="Base URL override"
                value={configDraft.base_url}
                onChange={v => { setIsConfigDirty(true); setConfigDraft(c => ({ ...c, base_url: v })); }}
                placeholder="http://localhost:1234/v1"
              />
              <Field
                label="API key override"
                value={configDraft.api_key}
                onChange={v => { setIsConfigDirty(true); setConfigDraft(c => ({ ...c, api_key: v })); }}
                placeholder="local-key"
              />
            </div>
            <button
              onClick={saveConfig}
              disabled={savingConfig}
              className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              {savingConfig ? 'Saving...' : 'Apply config'}
            </button>
          </div>
        )}
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        {/* Task editor */}
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-bold">
              <GitBranchPlus size={16} className="text-primary" />
              Task Builder
            </h3>
            <div className="flex items-center gap-2">
              <ModeButton active={mode === 'single'} onClick={() => setMode('single')} icon={<ArrowRight size={14} />}>Single</ModeButton>
              <ModeButton active={mode === 'batch'} onClick={() => setMode('batch')} icon={<SplitSquareVertical size={14} />}>Batch</ModeButton>
            </div>
          </div>

          {mode === 'single' ? (
            <TaskEditor task={singleTask} onChange={setSingleTask} />
          ) : (
            <div className="space-y-4">
              {batchTasks.map((task, index) => (
                <div key={index} className="relative">
                  {batchTasks.length > 1 && (
                    <button
                      onClick={() => removeBatchTask(index)}
                      className="absolute top-3 right-3 z-10 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-red-500/10 transition-colors"
                      title="Remove task"
                    >
                      <Minus size={14} />
                    </button>
                  )}
                  <TaskEditor title={`Task ${index + 1}`} task={task} onChange={next => setBatchTasks(current => current.map((item, i) => i === index ? next : item))} />
                </div>
              ))}
              <button
                onClick={addBatchTask}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-sm text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
              >
                <Plus size={14} />
                Add task
              </button>
            </div>
          )}
        </Card>

        {/* Generated prompt */}
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg font-bold">
              <Layers3 size={16} className="text-primary" />
              Generated prompt
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigator.clipboard?.writeText(generatedPrompt)}
                className="rounded-lg border border-border bg-muted px-3 py-2 text-sm"
              >
                <Copy size={14} className="mr-1 inline" />
                Copy
              </button>
              <button
                onClick={sendToChat}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                <Send size={14} className="mr-1 inline" />
                Send to Chat
              </button>
            </div>
          </div>

          <pre className="min-h-[420px] overflow-auto rounded-lg border border-border bg-muted p-4 text-xs text-muted-foreground leading-relaxed">
            {generatedPrompt}
          </pre>
        </Card>
      </div>
    </motion.div>
  );
}

/* ── Prompt builders ────────────────────────────── */

function buildSingleDelegatePrompt(task: TaskDraft) {
  const toolsets = task.toolsets.length > 0 ? task.toolsets : ['terminal', 'file', 'web'];
  const maxIterations = task.maxIterations.trim() ? `,\n  max_iterations=${task.maxIterations.trim()}` : '';
  return `delegate_task(\n  goal=${toPyString(task.goal || 'Describe the task goal clearly')},\n  context=${toTripleString(task.context || 'Provide all required context here. The child knows nothing about the parent conversation.')},\n  toolsets=[${toolsets.map(item => toPyString(item)).join(', ')}]${maxIterations}\n)`;
}

function buildBatchDelegatePrompt(tasks: TaskDraft[]) {
  if (tasks.length === 0) {
    return `delegate_task(tasks=[\n  {\n    "goal": "Describe the task goal clearly",\n    "context": "Provide all required context here. The child knows nothing about the parent conversation.",\n    "toolsets": ["terminal", "file", "web"]\n  }\n])`;
  }
  return `delegate_task(tasks=[\n${tasks.map(task => {
    const toolsets = task.toolsets.length ? task.toolsets : ['terminal', 'file', 'web'];
    const maxIter = task.maxIterations.trim() ? `,\n    "max_iterations": ${task.maxIterations.trim()}` : '';
    return `  {\n    "goal": ${toPyString(task.goal)},\n    "context": ${toPyString(task.context)},\n    "toolsets": [${toolsets.map(item => toPyString(item)).join(', ')}]${maxIter}\n  }`;
  }).join(',\n')}\n])`;
}

function toPyString(value: string) {
  return JSON.stringify(value || '');
}

function toTripleString(value: string) {
  return `"""${String(value || '').replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}"""`;
}

function splitCsv(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

/* ── Components ─────────────────────────────────── */

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-muted-foreground">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        className="w-full rounded-lg border border-border bg-muted px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}

function TaskEditor({ title, task, onChange }: {
  title?: string; task: TaskDraft; onChange: (task: TaskDraft) => void;
}) {
  const toggleToolset = (toolset: Toolset) => {
    onChange({
      ...task,
      toolsets: task.toolsets.includes(toolset)
        ? task.toolsets.filter(item => item !== toolset)
        : [...task.toolsets, toolset],
    });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-4">
      {title && <p className="mb-3 font-semibold">{title}</p>}
      <div className="space-y-3">
        <Field label="Goal" value={task.goal} onChange={v => onChange({ ...task, goal: v })} placeholder="Implement X" />
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">Context</label>
          <textarea
            value={task.context}
            onChange={e => onChange({ ...task, context: e.target.value })}
            placeholder="All required context for the subagent."
            className="min-h-[120px] w-full resize-y rounded-lg border border-border bg-muted px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs text-muted-foreground">Toolsets</label>
          <div className="space-y-2">
            {TOOLSET_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-[10px] text-muted-foreground/50 mb-1 uppercase tracking-wider">{group.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.items.map(toolset => (
                    <button
                      key={toolset}
                      onClick={() => toggleToolset(toolset)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] transition-all',
                        task.toolsets.includes(toolset)
                          ? 'border-primary/20 bg-primary/15 text-primary'
                          : 'border-border bg-muted text-muted-foreground',
                      )}
                    >
                      {toolset}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Field label="Max iterations" value={task.maxIterations} onChange={v => onChange({ ...task, maxIterations: v })} placeholder="optional" />
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        active ? 'border-primary/25 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
