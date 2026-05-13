import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronDown, ChevronRight, Copy, ExternalLink, FileText, GitBranchPlus,
  Layers3, Play, Sparkles, Terminal
} from 'lucide-react';
import { Card } from '../components/Card';
import { cn } from '../lib/utils';

/* ── Collapsible Section ─────────────────────────────────────────── */

function Section({
  defaultOpen = false,
  icon,
  title,
  badge,
  children,
}: {
  defaultOpen?: boolean;
  icon?: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon && <span className="text-primary">{icon}</span>}
          <span className="text-base font-semibold">{title}</span>
          {badge && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
              {badge}
            </span>
          )}
        </div>
        {open ? <ChevronDown size={16} className="text-muted-foreground" /> : <ChevronRight size={16} className="text-muted-foreground" />}
      </button>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="px-6 pb-6 border-t border-border/40 pt-4 space-y-4">
            {children}
          </div>
        </motion.div>
      )}
    </Card>
  );
}

/* ── Inline Code ─────────────────────────────────────────────────── */

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
        {n}
      </span>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

/* ── Feature card ────────────────────────────────────────────────── */

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </Card>
  );
}

/* ── Workflow box ────────────────────────────────────────────────── */

function Workflow({ title, steps }: { title: string; steps: string[] }) {
  return (
    <Card className="p-5">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <Play size={14} className="text-primary" />
        {title}
      </h4>
      <div className="space-y-3">
        {steps.map((s, i) => (
          <Step key={i} n={i + 1} text={s} />
        ))}
      </div>
    </Card>
  );
}

/* ── Copy button ─────────────────────────────────────────────────── */

function CopyBlock({ title, children }: { title: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative rounded-lg border border-border/50 bg-muted/20">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">{title}</span>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy size={11} />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-auto p-3 text-[12px] leading-relaxed text-foreground/85 font-mono">
        {children}
      </pre>
    </div>
  );
}

/* ── Table-like info rows ────────────────────────────────────────── */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
      <span className="shrink-0 text-xs font-semibold text-foreground/70 w-32">{label}</span>
      <span className="text-xs text-muted-foreground">{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
  PAGE COMPONENT
  ═══════════════════════════════════════════════════════════════════ */

export function DocsPage() {
  return (
    <motion.div
      key="docs"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.35 }}
      className="mx-auto max-w-4xl space-y-6"
    >
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Documentation
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How to use Templates & Workspaces in Hermes Desktop.
        </p>
      </div>

      {/* Quick nav */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { icon: <FileText size={16} />, label: 'Templates', desc: 'Agent definitions' },
          { icon: <Layers3 size={16} />, label: 'Workspaces', desc: 'Multi-agent flows' },
          { icon: <GitBranchPlus size={16} />, label: 'Workflows', desc: 'Common patterns' },
          { icon: <ExternalLink size={16} />, label: 'Full Docs', desc: 'hermes-agent.nousresearch.com' },
        ].map((item, i) => {
          const isExternal = i === 3;
          return (
            <a
              key={item.label}
              href={isExternal ? 'https://hermes-agent.nousresearch.com/docs/' : undefined}
              target={isExternal ? '_blank' : undefined}
              rel={isExternal ? 'noopener noreferrer' : undefined}
              onClick={!isExternal ? () => {
                const el = document.getElementById(item.label.toLowerCase());
                el?.scrollIntoView({ behavior: 'smooth' });
              } : undefined}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border border-border/50 p-4 text-center transition-colors hover:bg-muted/30',
                isExternal && 'cursor-pointer',
              )}
            >
              <span className="text-primary">{item.icon}</span>
              <span className="text-sm font-semibold">{item.label}</span>
              <span className="text-[11px] text-muted-foreground">{item.desc}</span>
            </a>
          );
        })}
      </div>

      {/* ── What are Templates & Workspaces ── */}
      <div id="overview" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FeatureCard
          icon={<FileText size={20} />}
          title="Templates"
          description="Reusable agent definitions — identity, SOUL prompt, skills, toolsets. One template = one personality recipe."
        />
        <FeatureCard
          icon={<Layers3 size={20} />}
          title="Workspaces"
          description="Multi-agent compositions — drag templates onto a canvas, assign roles, and run them as an orchestrated pipeline."
        />
      </div>

      {/* ── Section 1: Templates ── */}
      <div id="templates">
        <Section defaultOpen icon={<FileText size={18} />} title="Templates" badge="Agent Definitions">
          <p className="text-sm text-muted-foreground leading-relaxed">
            A Template is a <strong className="text-foreground">reusable agent definition</strong>. It holds the SOUL (system prompt), preferred skills, toolsets, and metadata. Templates live globally — they are shared across all profiles and can be used inside Workspaces.
          </p>

          <div className="space-y-3">
            <InfoRow label="Soul" value="The system prompt (SOUL.md) that defines the agent's identity and behavior" />
            <InfoRow label="Default model" value="Preferred LLM model (e.g. Qwen3.6, Gemini)" />
            <InfoRow label="Preferred skills" value="Comma-separated skill names to activate" />
            <InfoRow label="Toolsets" value="Allowed tools: file, terminal, web, vision, memory…" />
            <InfoRow label="Tags / Vibe / Workflow" value="Optional metadata for organization" />
          </div>

          <h4 className="pt-2 text-sm font-bold">Quick Start</h4>

          <div className="space-y-4">
            <Workflow
              title="Create a template from scratch"
              steps={[
                'Go to <strong>Templates</strong> in the sidebar.',
                'Click <strong>[New]</strong> — a generic template is created.',
                'Edit the <strong>Name</strong> and <strong>Slug</strong> (e.g. "security-auditor" / "security-auditor").',
                'Write the <strong>Soul</strong> — this is the agent\'s identity and instructions.',
                'Set <strong>Preferred skills</strong> (e.g. "cyber-assessment-planning, cyber-blue-team-review").',
                'Set <strong>Toolsets</strong> (e.g. "terminal, file, web, vision").',
                'Click <strong>[Save]</strong> to persist.',
              ]}
            />

            <Workflow
              title="Import templates"
              steps={[
                'In the left sidebar library, choose an import method:',
                '<strong>Bundled Agency</strong> — load pre-packaged agents shipped with Hermes.',
                '<strong>Default Agency</strong> — sync from the community GitHub repo.',
                '<strong>Import Source</strong> — provide your own URL or path.',
                'Imported templates appear under the "Agency-agents" section. Click one to open it in the editor.',
              ]}
            />

            <Workflow
              title="Apply a template to your profile"
              steps={[
                'Select a template in the library.',
                'Review/adjust the Soul in the editor.',
                'Click <strong>[Apply Soul]</strong> — the Soul is copied to your active profile\'s SOUL.md.',
                'Next chat session, Hermes uses this identity.',
              ]}
            />
          </div>

          <CopyBlock
            title="Example Soul template"
          >{`# Identity

You are a focused technical researcher.

## Style
- Be direct and cite sources
- Prioritize recent information
- Flag uncertainty clearly

## Capabilities
- Search academic papers
- Synthesize findings
- Produce structured summaries`}</CopyBlock>
        </Section>
      </div>

      {/* ── Section 2: Workspaces ── */}
      <div id="workspaces">
        <Section icon={<Layers3 size={18} />} title="Workspaces" badge="Multi-Agent Composition">
          <p className="text-sm text-muted-foreground leading-relaxed">
            A Workspace is an <strong className="text-foreground">orchestrated pipeline</strong> of agent nodes. Each node uses a template agent with a specific role, priority, and context. Drag templates onto the Canvas, wire them together, and execute.
          </p>

          <h4 className="pt-2 text-sm font-bold">The 3-Panel Layout</h4>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<FileText size={16} />}
              title="Templates (left)"
              description="Your agent palette. Browse, search, and drag templates onto the canvas."
            />
            <FeatureCard
              icon={<Layers3 size={16} />}
              title="Canvas (center)"
              description="Visual workspace. Nodes appear here when you drop agents. Arrange them spatially."
            />
            <FeatureCard
              icon={<Sparkles size={16} />}
              title="Inspector (right)"
              description="Configure the selected node: role, priority, max iterations, model override, context."
            />
          </div>

          <h4 className="pt-2 text-sm font-bold">Workflow</h4>

          <Workflow
            title="Build a multi-agent workspace"
            steps={[
              'Go to <strong>Workspaces</strong> in the sidebar.',
              'Click <strong>[New Workspace]</strong> and give it a name.',
              'In the left Templates panel, find an agent you want.',
              '<strong>Drag it</strong> onto the Canvas — a node appears.',
              'Select the node. In the <strong>Inspector</strong> (right panel):',
              '<ul class="ml-8 list-disc space-y-1 text-sm text-muted-foreground">' +
              '  <li><strong>Role</strong>: "Primary Researcher", "QA Reviewer", etc.</li>' +
              '  <li><strong>Priority</strong>: execution order (High / Medium / Low)</li>' +
              '  <li><strong>Context</strong>: role-specific instructions</li>' +
              '  <li><strong>Model</strong>: optional model override for this node</li>' +
              '</ul>',
              'Repeat for each agent in your pipeline.',
              'Click <strong>[Save]</strong> to persist the workspace.',
            ]}
          />

          <h4 className="pt-2 text-sm font-bold">Tabs</h4>

          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4">
              <h5 className="text-sm font-bold flex items-center gap-2">
                <Layers3 size={14} className="text-primary" /> Canvas
              </h5>
              <p className="mt-1 text-xs text-muted-foreground">
                The main editor. Compose, configure, and save your workspace. Generate prompts from here.
              </p>
            </Card>
            <Card className="p-4">
              <h5 className="text-sm font-bold flex items-center gap-2">
                <Terminal size={14} className="text-primary" /> Runs
              </h5>
              <p className="mt-1 text-xs text-muted-foreground">
                Execution outputs and results. Monitor workspace runs and view generated prompts.
              </p>
            </Card>
          </div>

          <h4 className="pt-2 text-sm font-bold">Actions</h4>

          <div className="space-y-2">
            <InfoRow
              label="[Generate Prompt]"
              value="Builds an orchestration prompt from your workspace structure"
            />
            <InfoRow
              label="[Copy]"
              value="Copies the generated prompt to your clipboard"
            />
            <InfoRow
              label="[Send to Chat]"
              value="Opens Chat with the prompt pre-filled so you can review before sending"
            />
            <InfoRow
              label="[Execute]"
              value="Runs the workspace directly via the Gateway"
            />
          </div>
        </Section>
      </div>

      {/* ── Section 3: Common Workflows ── */}
      <div id="workflows">
        <Section icon={<GitBranchPlus size={18} />} title="Common Workflows">
          <Workflow
            title="Create a specialized agent + use it"
            steps={[
              '<strong>Templates</strong> → [New] → name it, write the Soul, set skills and toolsets.',
              '[Save] to persist.',
              'Option A: [Apply Soul] to use it immediately in your current profile.',
              'Option B: Go to <strong>Workspaces</strong> and drag it into a multi-agent pipeline.',
            ]}
          />

          <Workflow
            title="Compose a research pipeline"
            steps={[
              '<strong>Workspaces</strong> → [New Workspace] → name it "Research Pipeline".',
              'Drag "researcher" template → set Role: "Primary Researcher", Priority: High.',
              'Drag "synthesizer" template → set Role: "Synthesizer", Priority: Medium.',
              '[Save] → [Generate Prompt] → review the output.',
              '[Send to Chat] or [Execute].',
            ]}
          />

          <Workflow
            title="Iterate rapidly on a template"
            steps={[
              'Select an existing template in <strong>Templates</strong>.',
              'Modify the Soul → [Save].',
              '[Apply Soul] → test with a quick chat message.',
              'Works? The template is ready. Doesn\'t work? Adjust → [Save] → retry.',
            ]}
          />
        </Section>
      </div>

      {/* ── Key Rules ── */}
      <Card className="p-5 border-amber-500/20 bg-amber-500/5">
        <h4 className="mb-3 text-sm font-bold flex items-center gap-2 text-amber-400">
          <Sparkles size={16} />
          Key Rules
        </h4>
        <div className="space-y-3">
          {[
            ['Templates are global', 'Not tied to any profile. Reusable everywhere.'],
            ['Apply Soul = overwrite', 'Completely replaces the profile\'s SOUL.md. Not a merge.'],
            ['Workspace nodes don\'t edit templates', 'Role/priority changes in the Inspector are stored in the workspace only.'],
            ['Workspaces are compositions, not processes', 'They don\'t run continuously. Execute → get output → done.'],
          ].map(([rule, desc]) => (
            <div key={rule} className="flex items-start gap-2">
              <span className="mt-0.5 text-amber-400">✦</span>
              <div>
                <p className="text-sm font-semibold text-amber-400">{rule}</p>
                <p className="text-xs text-muted-foreground/60">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Link to full docs */}
      <div className="flex items-center justify-center py-6">
        <a
          href="https://hermes-agent.nousresearch.com/docs/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
        >
          <ExternalLink size={14} />
          Full Hermes Agent Documentation
        </a>
      </div>
    </motion.div>
  );
}
