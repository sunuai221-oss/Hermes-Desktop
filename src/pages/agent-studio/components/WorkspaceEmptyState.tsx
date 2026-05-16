import { BookOpen, GitBranchPlus, Library, Plus } from 'lucide-react';

interface WorkspaceEmptyStateProps {
  onCreateWorkspace: () => void;
  onImportBundled: () => void;
}

export function WorkspaceEmptyState({ onCreateWorkspace, onImportBundled }: WorkspaceEmptyStateProps) {
  return (
    <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
      {/* Illustration */}
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <GitBranchPlus size={36} className="text-primary/60" />
      </div>

      {/* Title */}
      <h3 className="text-xl font-semibold text-foreground">No workspaces yet</h3>
      <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
        Create a workspace to start composing multi-agent pipelines. Drag agents from
        the template library onto a canvas, define their roles, and connect them into
        a workflow.
      </p>

      {/* Quick actions */}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={onCreateWorkspace}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus size={15} />
          Create blank workspace
        </button>
        <button
          onClick={onImportBundled}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Library size={15} />
          Import from library
        </button>
        <a
          href="https://hermes-agent.nousresearch.com/docs/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BookOpen size={15} />
          Quick start guide
        </a>
      </div>
    </div>
  );
}
