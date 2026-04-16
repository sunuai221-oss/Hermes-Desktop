import { motion } from 'framer-motion';
import { BookOpen, BrainCircuit, FileStack, GitBranchPlus, PlugZap, Sparkles, Webhook } from 'lucide-react';
import { Card } from '../components/Card';

const sections = [
  {
    title: 'Profile files',
    icon: <Sparkles size={16} className="text-primary" />,
    points: [
      '`SOUL.md`, `USER.md`, and `MEMORY.md` belong to the active profile.',
      'They live inside the profile `HERMES_HOME` and are not shared with other profiles.',
      'Editors for these files are available in `Agent Studio`.',
    ],
  },
  {
    title: 'Workspace files',
    icon: <FileStack size={16} className="text-primary" />,
    points: [
      '`AGENTS.md`, `.hermes.md`, `CLAUDE.md`, and `.cursorrules` belong to the workspace.',
      'They are detected from the project and can be shared across profiles when the workspace is the same.',
      'They can be edited in `Context Files`.',
    ],
  },
  {
    title: 'Agent presets',
    icon: <BookOpen size={16} className="text-primary" />,
    points: [
      'The Builder agent library is a layer of reusable presets.',
      'A preset can apply `SOUL.md`, the default model, and the target personality.',
      'This is not a native multi-agent runtime system.',
    ],
  },
  {
    title: 'Memory providers',
    icon: <BrainCircuit size={16} className="text-primary" />,
    points: [
      'External providers are added on top of `MEMORY.md` and `USER.md`.',
      'Builtin remains the simplest local baseline.',
      '`openviking` requires an active external service; `holographic` remains the simple local fallback.',
    ],
  },
  {
    title: 'Delegation',
    icon: <GitBranchPlus size={16} className="text-primary" />,
    points: [
      'A subagent does not automatically inherit the parent context.',
      'The `context` field must be self-sufficient.',
      'The `Delegation` page is used to configure Hermes and compose delegation prompts.',
    ],
  },
  {
    title: 'Plugins',
    icon: <PlugZap size={16} className="text-primary" />,
    points: [
      'The `Plugins` page is currently an inventory view: source, status, present files, and required environment variables.',
      'Still to implement: enable or disable a plugin from the app by editing the config.',
      'Still to implement: create, edit, and delete a local plugin with manifest editing and related Python files.',
      'Still to implement: runtime introspection exposed by the gateway to know which plugins are actually loaded in memory.',
    ],
  },
  {
    title: 'Hooks',
    icon: <Webhook size={16} className="text-primary" />,
    points: [
      'The `Hooks` page is currently an inventory view: gateway hooks detected on disk and active plugins that may expose hooks.',
      'Still to implement: full CRUD for gateway hooks with editing of `HOOK.yaml` and `handler.py`.',
      'Still to implement: validation of supported events and handler tests before saving.',
      'Still to implement: runtime introspection exposed by the gateway to list callbacks that are effectively registered.',
    ],
  },
];

export function DocsPage() {
  return (
    <motion.div
      key="docs"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-6xl space-y-6"
    >
      <div>
        <h2 className="text-3xl font-semibold">
          Builder <span className="text-primary">Docs</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {sections.map(section => (
          <Card key={section.title} className="p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
              {section.icon}
              {section.title}
            </h3>
            <div className="space-y-3 text-sm text-muted-foreground">
              {section.points.map(point => (
                <p key={point}>{point}</p>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </motion.div>
  );
}
