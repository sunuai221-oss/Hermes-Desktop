import { ArrowRight, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import type {
  AgentDefinition,
  AgentWorkspace,
  WorkspaceAgentEdge,
  WorkspaceAgentNode,
  WorkspaceAutoConfigPlan,
  WorkspaceEdgeKind,
} from '../../../types';
import type { WorkspaceNodeProfileResolution } from '../profileRuntime';

const EDGE_KIND_OPTIONS: WorkspaceEdgeKind[] = ['handoff', 'review', 'qa', 'broadcast', 'escalation'];

function getNodeLabel(
  node: WorkspaceAgentNode | null | undefined,
  agentsById: Map<string, AgentDefinition>,
) {
  if (!node) return 'Missing node';
  return node.label || agentsById.get(node.agentId)?.name || 'Missing agent';
}

function getEdgeEndpointLabel(
  nodeId: string,
  node: WorkspaceAgentNode | undefined,
  agentsById: Map<string, AgentDefinition>,
) {
  return node?.label || agentsById.get(node?.agentId || '')?.name || nodeId;
}

export function AutoConfigDiffRow({ item }: { item: WorkspaceAutoConfigPlan['items'][number] }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-2 py-1.5">
      <p className="font-medium text-foreground">{item.title}</p>
      {item.detail && <p className="mt-0.5 text-muted-foreground">{item.detail}</p>}
      {(item.before || item.after) && (
        <div className="mt-1 grid gap-1 text-muted-foreground">
          {item.before && (
            <p>
              <span className="font-medium text-foreground/70">Before:</span> {item.before}
            </p>
          )}
          {item.after && (
            <p>
              <span className="font-medium text-foreground/70">After:</span> {item.after}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatEdgeKindLabel(kind: WorkspaceEdgeKind) {
  return kind.replace(/-/g, ' ');
}

export function NodeQuickSelect({
  workspace,
  agentsById,
  onSelectNode,
}: {
  workspace: AgentWorkspace;
  agentsById: Map<string, AgentDefinition>;
  onSelectNode: (id: string | null) => void;
}) {
  if (workspace.nodes.length === 0) {
    return (
      <p className="rounded-lg bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
        Drag templates from the library into the canvas.
      </p>
    );
  }

  return (
    <div>
      <h4 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Nodes</h4>
      <div className="space-y-2">
        {workspace.nodes.map(node => (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelectNode(node.id)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{getNodeLabel(node, agentsById)}</span>
              <span className="block text-[11px] uppercase text-muted-foreground">{node.role}</span>
            </span>
            <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function RelationsEditor({
  workspace,
  selectedNode,
  agentsById,
  onAddEdge,
  onRemoveEdge,
  onSelectNode,
}: {
  workspace: AgentWorkspace;
  selectedNode: WorkspaceAgentNode;
  agentsById: Map<string, AgentDefinition>;
  onAddEdge: (fromNodeId: string, toNodeId: string, kind: WorkspaceEdgeKind) => void;
  onRemoveEdge: (edgeId: string) => void;
  onSelectNode: (id: string | null) => void;
}) {
  const targetNodes = useMemo(
    () => workspace.nodes.filter(node => node.id !== selectedNode.id),
    [selectedNode.id, workspace.nodes],
  );
  const [targetNodeId, setTargetNodeId] = useState(targetNodes[0]?.id || '');
  const [edgeKind, setEdgeKind] = useState<WorkspaceEdgeKind>('handoff');
  const selectedTargetNodeId = targetNodes.some(node => node.id === targetNodeId)
    ? targetNodeId
    : targetNodes[0]?.id || '';

  const relatedEdges = (workspace.edges || []).filter(edge =>
    edge.fromNodeId === selectedNode.id || edge.toNodeId === selectedNode.id,
  );
  const nodesById = useMemo(
    () => new Map(workspace.nodes.map(node => [node.id, node] as const)),
    [workspace.nodes],
  );

  return (
    <div className="border-t border-border pt-4">
      <h4 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Relations</h4>
      <div className="grid grid-cols-[minmax(0,1fr)_112px_auto] gap-2">
        <select
          value={selectedTargetNodeId}
          onChange={event => setTargetNodeId(event.target.value)}
          disabled={targetNodes.length === 0}
          className="min-w-0 rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        >
          {targetNodes.length === 0 && <option value="">No target</option>}
          {targetNodes.map(node => (
            <option key={node.id} value={node.id}>{getNodeLabel(node, agentsById)}</option>
          ))}
        </select>
        <select
          value={edgeKind}
          onChange={event => setEdgeKind(event.target.value as WorkspaceEdgeKind)}
          disabled={targetNodes.length === 0}
          className="rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        >
          {EDGE_KIND_OPTIONS.map(kind => <option key={kind} value={kind}>{formatEdgeKindLabel(kind)}</option>)}
        </select>
        <button
          type="button"
          onClick={() => selectedTargetNodeId && onAddEdge(selectedNode.id, selectedTargetNodeId, edgeKind)}
          disabled={!selectedTargetNodeId}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          title="Add relation"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {relatedEdges.length === 0 ? (
          <p className="rounded-lg bg-muted/40 px-3 py-3 text-sm text-muted-foreground">No relations yet.</p>
        ) : relatedEdges.map(edge => (
          <RelationRow
            key={edge.id}
            edge={edge}
            selectedNodeId={selectedNode.id}
            nodesById={nodesById}
            agentsById={agentsById}
            onRemoveEdge={onRemoveEdge}
            onSelectNode={onSelectNode}
          />
        ))}
      </div>
    </div>
  );
}

function RelationRow({
  edge,
  selectedNodeId,
  nodesById,
  agentsById,
  onRemoveEdge,
  onSelectNode,
}: {
  edge: WorkspaceAgentEdge;
  selectedNodeId: string;
  nodesById: Map<string, WorkspaceAgentNode>;
  agentsById: Map<string, AgentDefinition>;
  onRemoveEdge: (edgeId: string) => void;
  onSelectNode: (id: string | null) => void;
}) {
  const isOutgoing = edge.fromNodeId === selectedNodeId;
  const otherNodeId = isOutgoing ? edge.toNodeId : edge.fromNodeId;
  const otherNode = nodesById.get(otherNodeId);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
        {isOutgoing ? 'to' : 'from'}
      </span>
      <button
        type="button"
        onClick={() => otherNode && onSelectNode(otherNode.id)}
        className="min-w-0 flex-1 truncate text-left font-medium hover:text-primary"
      >
        {getNodeLabel(otherNode, agentsById)}
      </button>
      <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">
        {formatEdgeKindLabel(edge.kind)}
      </span>
      <button
        type="button"
        onClick={() => onRemoveEdge(edge.id)}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        title="Remove relation"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function EdgeDetailBlock({
  edgeId,
  workspace,
  agentsById,
  onSelectEdge,
  onRemoveEdge,
}: {
  edgeId: string;
  workspace: AgentWorkspace;
  agentsById: Map<string, AgentDefinition>;
  onSelectEdge: (id: string | null) => void;
  onRemoveEdge: (id: string) => void;
}) {
  const edge = (workspace.edges || []).find(e => e.id === edgeId);
  if (!edge) return null;

  const nodesById = new Map(workspace.nodes.map(n => [n.id, n] as const));
  const from = nodesById.get(edge.fromNodeId);
  const to = nodesById.get(edge.toNodeId);
  const fromLabel = getEdgeEndpointLabel(edge.fromNodeId, from, agentsById);
  const toLabel = getEdgeEndpointLabel(edge.toNodeId, to, agentsById);

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/8 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-primary">Selected Relation</h4>
        <button
          type="button"
          onClick={() => { onRemoveEdge(edge.id); onSelectEdge(null); }}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          title="Remove relation"
        >
          <X size={13} />
        </button>
      </div>
      <div className="space-y-1.5 text-xs">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{edge.kind}</span>
          <span className="mx-1.5 text-muted-foreground/40">→</span>
          <span className="text-muted-foreground">{fromLabel}</span>
          <span className="mx-1 text-muted-foreground/40">→</span>
          <span className="text-muted-foreground">{toLabel}</span>
        </p>
        {edge.template && (
          <p className="text-muted-foreground">
            Template: <span className="font-mono text-foreground">{edge.template}</span>
          </p>
        )}
        <button
          type="button"
          onClick={() => onSelectEdge(null)}
          className="mt-1 text-[11px] text-primary hover:underline"
        >
          Deselect relation
        </button>
      </div>
    </div>
  );
}

export function CollapsibleSection({
  id,
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count: string | null;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground transition-colors hover:bg-muted/30"
      >
        <span>{label}</span>
        <span className="flex items-center gap-1.5">
          {count !== null && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{count}</span>
          )}
          <ChevronDown
            size={13}
            className={cn(
              'text-muted-foreground transition-transform',
              collapsed && '-rotate-90',
            )}
          />
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-border px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

export function InspectorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

export function InspectorTextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-[96px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

export function NodeProfileHint({
  resolution,
  profileModeActive,
}: {
  resolution: WorkspaceNodeProfileResolution;
  profileModeActive: boolean;
}) {
  const containerClassName = cn(
    'rounded-lg border px-3 py-2 text-xs',
    resolution.status === 'invalid' || resolution.status === 'missing'
      ? 'border-destructive/20 bg-destructive/5'
      : resolution.status === 'offline'
        ? 'border-amber-500/20 bg-amber-500/5'
        : 'border-border bg-muted/20',
  );
  const titleClassName = cn(
    'font-medium',
    resolution.status === 'invalid' || resolution.status === 'missing'
      ? 'text-destructive'
      : resolution.status === 'offline'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-foreground',
  );
  const bodyClassName = cn(
    'mt-1 leading-5',
    resolution.status === 'invalid' || resolution.status === 'missing'
      ? 'text-destructive/90'
      : resolution.status === 'offline'
        ? 'text-amber-700/90 dark:text-amber-300/90'
        : 'text-muted-foreground',
  );

  return (
    <div className={containerClassName}>
      <p className={titleClassName}>
        {resolution.usesFallback ? 'Runtime target' : 'Pinned profile'}: {resolution.effectiveProfileName}
      </p>
      <p className={bodyClassName}>{resolution.detail}</p>
      {!profileModeActive && (
        <p className="mt-1.5 text-muted-foreground">
          This setting is only used when the workspace runs in Profile runtime bridge mode.
        </p>
      )}
    </div>
  );
}
