import { useDraggable } from '@dnd-kit/core';
import type { CSSProperties } from 'react';
import { TemplatesLibraryPanel } from '../../../features/templates/components/TemplatesLibraryPanel';
import {
  formatDivisionLabel,
  inferAgentSubgroup,
} from '../../../lib/agentCatalog';
import { cn } from '../../../lib/utils';
import type { AgentDefinition } from '../../../types';

type TemplateGroup = {
  key: string;
  label: string;
  agents: AgentDefinition[];
};

type WorkspaceTemplatePanelProps = {
  className?: string;
  title?: string;
  templates: AgentDefinition[];
  groupedTemplates: TemplateGroup[];
  query: string;
  sourceFilter: string;
  divisionFilter: string;
  sources: string[];
  divisions: string[];
  importValue: string;
  importSummary: string;
  importing: boolean;
  onQueryChange: (value: string) => void;
  onSourceFilterChange: (value: string) => void;
  onDivisionFilterChange: (value: string) => void;
  onImportValueChange: (value: string) => void;
  onImportBundled: () => void;
  onImportDefault: () => void;
  onImportSource: () => void;
};

export function WorkspaceTemplatePanel({
  className,
  title = 'Templates',
  templates,
  groupedTemplates,
  query,
  sourceFilter,
  divisionFilter,
  sources,
  divisions,
  importValue,
  importSummary,
  importing,
  onQueryChange,
  onSourceFilterChange,
  onDivisionFilterChange,
  onImportValueChange,
  onImportBundled,
  onImportDefault,
  onImportSource,
}: WorkspaceTemplatePanelProps) {
  return (
    <TemplatesLibraryPanel
      className={className}
      title={title}
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
      onQueryChange={onQueryChange}
      onSourceFilterChange={onSourceFilterChange}
      onDivisionFilterChange={onDivisionFilterChange}
      onImportValueChange={onImportValueChange}
      onImportBundled={onImportBundled}
      onImportDefault={onImportDefault}
      onImportSource={onImportSource}
      renderTemplateCard={(agent: AgentDefinition) => <DraggableAgentCard agent={agent} />}
    />
  );
}

function DraggableAgentCard({ agent }: { agent: AgentDefinition }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `library:${agent.id}`,
    data: { type: 'library-agent', agentId: agent.id },
  });
  const style: CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : {};

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        'w-full rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/60',
        isDragging && 'z-50 opacity-80 shadow-lg',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
          {agent.emoji || agent.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{agent.name}</p>
          {agent.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{agent.source}</span>
            {agent.division && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{formatDivisionLabel(agent.division)}</span>}
            {inferAgentSubgroup(agent.sourcePath) && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{inferAgentSubgroup(agent.sourcePath)}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
