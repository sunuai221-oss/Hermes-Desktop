import { cn } from '../../../lib/utils';
import type { AgentDefinition } from '../../../types';

interface TemplatesLibraryPanelProps {
  className?: string;
  title?: string;
  templates: AgentDefinition[];
  groupedTemplates: { key: string; label: string; agents: AgentDefinition[] }[];
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
  renderTemplateCard?: (agent: AgentDefinition) => React.ReactNode;
  activeTemplateId?: string | null;
  onSelectTemplate?: (id: string) => void;
}

export function TemplatesLibraryPanel({
  className,
  title = 'Templates',
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
  renderTemplateCard,
  activeTemplateId,
  onSelectTemplate,
}: TemplatesLibraryPanelProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {groupedTemplates.reduce((acc, g) => acc + g.agents.length, 0)} templates
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
        <input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          className="flex-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
        />
        {sources.length > 1 && (
          <select
            value={sourceFilter}
            onChange={e => onSourceFilterChange(e.target.value)}
            className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
          >
            <option value="all">All sources</option>
            {sources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {divisions.length > 1 && (
          <select
            value={divisionFilter}
            onChange={e => onDivisionFilterChange(e.target.value)}
            className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
          >
            <option value="all">All divisions</option>
            {divisions.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
      </div>

      {/* Import section */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Import from path, URL, or Git..."
            value={importValue}
            onChange={e => onImportValueChange(e.target.value)}
            className="flex-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
          />
        </div>
        {importSummary && (
          <p className="mt-1 text-xs text-muted-foreground">{importSummary}</p>
        )}
        <div className="mt-2 flex gap-1 flex-wrap">
          <button
            onClick={onImportBundled}
            disabled={importing}
            className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80"
          >
            Load bundled
          </button>
          <button
            onClick={onImportDefault}
            disabled={importing}
            className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/80"
          >
            Import default agency
          </button>
          <button
            onClick={onImportSource}
            disabled={importing || !importValue.trim()}
            className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
          >
            Import
          </button>
        </div>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {groupedTemplates.map(group => (
          <div key={group.key}>
            <h4 className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {group.label} ({group.agents.length})
            </h4>
            <div className={cn(
              "grid gap-2",
              renderTemplateCard ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1",
            )}>
              {group.agents.map(agent => {
                if (renderTemplateCard) {
                  return (
                    <div key={agent.id}>
                      {renderTemplateCard(agent)}
                    </div>
                  );
                }
                // List mode for TemplatesPage
                const isActive = activeTemplateId === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => onSelectTemplate?.(agent.id)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted/60",
                    )}
                  >
                    <p className="truncate text-sm font-medium">{agent.name}</p>
                    {agent.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{agent.source}</span>
                      {agent.division && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{agent.division}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groupedTemplates.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No templates found
          </p>
        )}
      </div>
    </div>
  );
}
