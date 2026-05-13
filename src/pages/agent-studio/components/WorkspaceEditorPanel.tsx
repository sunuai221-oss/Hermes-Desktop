import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ArrowRight, Check, Copy, GripVertical, Plus, Send, Trash2, X } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type MutableRefObject } from 'react';
import { Card } from '../../../components/Card';
import { cn } from '../../../lib/utils';
import type {
  AgentDefinition,
  AgentWorkspace,
  WorkspaceAgentEdge,
  WorkspaceAgentNode,
  WorkspaceAgentRole,
  WorkspaceEdgeKind,
} from '../../../types';

const ROLE_OPTIONS: WorkspaceAgentRole[] = ['orchestrator', 'worker', 'reviewer', 'qa', 'observer'];
const EDGE_KIND_OPTIONS: WorkspaceEdgeKind[] = ['handoff', 'review', 'qa', 'broadcast', 'escalation'];
const NODE_CARD_WIDTH = 224;
const NODE_CARD_HEIGHT = 104;

type WorkspaceEditorPanelProps = {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  workspace: AgentWorkspace | null;
  agentsById: Map<string, AgentDefinition>;
  selectedNode: WorkspaceAgentNode | null;
  selectedNodeId: string | null;
  generatedPrompt: string;
  copied: boolean;
  onSelectNode: (id: string | null) => void;
  onRemoveNode: (id: string) => void;
  onAddEdge: (fromNodeId: string, toNodeId: string, kind: WorkspaceEdgeKind) => void;
  onRemoveEdge: (edgeId: string) => void;
  onPatchWorkspace: (patch: Partial<AgentWorkspace>) => void;
  onPatchNode: (patch: Partial<WorkspaceAgentNode>) => void;
  onCopyPrompt: () => void;
  onSendToChat: () => void;
};

function splitCsv(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function toCsv(value?: string[]) {
  return (value || []).join(', ');
}

export function WorkspaceEditorPanel({
  canvasRef,
  workspace,
  agentsById,
  selectedNode,
  selectedNodeId,
  generatedPrompt,
  copied,
  onSelectNode,
  onRemoveNode,
  onAddEdge,
  onRemoveEdge,
  onPatchWorkspace,
  onPatchNode,
  onCopyPrompt,
  onSendToChat,
}: WorkspaceEditorPanelProps) {
  const selectedAgent = selectedNode ? agentsById.get(selectedNode.agentId) || null : null;

  return (
    <>
      <WorkspaceCanvas
        canvasRef={canvasRef}
        workspace={workspace}
        agentsById={agentsById}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        onRemoveNode={onRemoveNode}
      />
      <InspectorPanel
        workspace={workspace}
        selectedNode={selectedNode}
        selectedAgent={selectedAgent}
        agentsById={agentsById}
        generatedPrompt={generatedPrompt}
        copied={copied}
        onSelectNode={onSelectNode}
        onAddEdge={onAddEdge}
        onRemoveEdge={onRemoveEdge}
        onPatchWorkspace={onPatchWorkspace}
        onPatchNode={onPatchNode}
        onCopyPrompt={onCopyPrompt}
        onSendToChat={onSendToChat}
      />
    </>
  );
}

function WorkspaceCanvas({
  canvasRef,
  workspace,
  agentsById,
  selectedNodeId,
  onSelectNode,
  onRemoveNode,
}: {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  workspace: AgentWorkspace | null;
  agentsById: Map<string, AgentDefinition>;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onRemoveNode: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'workspace-canvas' });

  return (
    <Card className="min-h-[680px] overflow-hidden">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{workspace?.name || 'No workspace selected'}</h3>
          <p className="text-xs text-muted-foreground">{workspace?.nodes.length || 0} node(s)</p>
        </div>
      </div>
      <div
        ref={node => {
          setNodeRef(node);
          canvasRef.current = node;
        }}
        onClick={() => onSelectNode(null)}
        className={cn(
          'relative min-h-[628px] overflow-hidden bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] [background-size:24px_24px]',
          isOver && 'bg-primary/5',
        )}
      >
        {!workspace ? (
          <div className="flex h-[628px] items-center justify-center text-sm text-muted-foreground">
            Create a workspace to start arranging agents.
          </div>
        ) : workspace.nodes.length === 0 ? (
          <div className="flex h-[628px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Drag templates from the library into this workspace.
          </div>
        ) : (
          <>
            <WorkspaceEdgesOverlay workspace={workspace} selectedNodeId={selectedNodeId} />
            {workspace.nodes.map(node => (
              <WorkspaceNodeCard
                key={node.id}
                node={node}
                agent={agentsById.get(node.agentId) || null}
                selected={node.id === selectedNodeId}
                onSelect={() => onSelectNode(node.id)}
                onRemove={() => onRemoveNode(node.id)}
              />
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

function WorkspaceEdgesOverlay({
  workspace,
  selectedNodeId,
}: {
  workspace: AgentWorkspace;
  selectedNodeId: string | null;
}) {
  const nodesById = useMemo(
    () => new Map(workspace.nodes.map(node => [node.id, node] as const)),
    [workspace.nodes],
  );
  const visibleEdges = (workspace.edges || []).filter(edge => nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId));

  if (visibleEdges.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" aria-hidden="true">
      <defs>
        <marker id="workspace-edge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,4 L0,8 Z" className="fill-primary" />
        </marker>
      </defs>
      {visibleEdges.map(edge => {
        const from = nodesById.get(edge.fromNodeId);
        const to = nodesById.get(edge.toNodeId);
        if (!from || !to) return null;

        const fromX = from.position.x + NODE_CARD_WIDTH;
        const fromY = from.position.y + NODE_CARD_HEIGHT / 2;
        const toX = to.position.x;
        const toY = to.position.y + NODE_CARD_HEIGHT / 2;
        const middleX = (fromX + toX) / 2;
        const controlOffset = Math.max(60, Math.abs(toX - fromX) / 2);
        const isSelected = selectedNodeId === edge.fromNodeId || selectedNodeId === edge.toNodeId;

        return (
          <g key={edge.id}>
            <path
              d={`M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`}
              className={cn(
                'fill-none stroke-primary/60',
                isSelected ? 'stroke-[2.5]' : 'stroke-[1.5] opacity-70',
              )}
              markerEnd="url(#workspace-edge-arrow)"
            />
            <text
              x={middleX}
              y={(fromY + toY) / 2 - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] uppercase"
            >
              {edge.kind}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function WorkspaceNodeCard({
  node,
  agent,
  selected,
  onSelect,
  onRemove,
}: {
  node: WorkspaceAgentNode;
  agent: AgentDefinition | null;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { type: 'workspace-node', nodeId: node.id },
  });
  const style: CSSProperties = {
    transform: `translate3d(${node.position.x + (transform?.x || 0)}px, ${node.position.y + (transform?.y || 0)}px, 0)`,
    width: NODE_CARD_WIDTH,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={event => {
        event.stopPropagation();
        onSelect();
      }}
      className={cn(
        'absolute left-0 top-0 z-10 rounded-lg border bg-card p-3 shadow-sm transition-shadow',
        selected ? 'border-primary shadow-md' : 'border-border',
        isDragging && 'z-50 shadow-lg',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <button
          type="button"
          {...listeners}
          {...attributes}
          className="mt-0.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Drag node"
          onClick={event => event.stopPropagation()}
        >
          <GripVertical size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{node.label || agent?.name || 'Missing agent'}</p>
          <p className="text-[11px] uppercase text-muted-foreground">{node.role}</p>
        </div>
        <button
          type="button"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            onRemove();
          }}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
          title="Remove node"
        >
          <X size={13} />
        </button>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {agent?.description || 'Missing agent definition'}
      </p>
      <span className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-border bg-background" />
      <span className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-primary bg-background" />
    </div>
  );
}

function InspectorPanel({
  workspace,
  selectedNode,
  selectedAgent,
  agentsById,
  generatedPrompt,
  copied,
  onSelectNode,
  onAddEdge,
  onRemoveEdge,
  onPatchWorkspace,
  onPatchNode,
  onCopyPrompt,
  onSendToChat,
}: {
  workspace: AgentWorkspace | null;
  selectedNode: WorkspaceAgentNode | null;
  selectedAgent: AgentDefinition | null;
  agentsById: Map<string, AgentDefinition>;
  generatedPrompt: string;
  copied: boolean;
  onSelectNode: (id: string | null) => void;
  onAddEdge: (fromNodeId: string, toNodeId: string, kind: WorkspaceEdgeKind) => void;
  onRemoveEdge: (edgeId: string) => void;
  onPatchWorkspace: (patch: Partial<AgentWorkspace>) => void;
  onPatchNode: (patch: Partial<WorkspaceAgentNode>) => void;
  onCopyPrompt: () => void;
  onSendToChat: () => void;
}) {
  return (
    <Card className="flex min-h-[680px] flex-col p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Inspector</h3>
          <p className="text-xs text-muted-foreground">
            {selectedNode ? (selectedNode.label || selectedAgent?.name || 'Selected node') : 'Workspace settings'}
          </p>
        </div>
        {selectedNode && (
          <button
            type="button"
            onClick={() => onSelectNode(null)}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Workspace
          </button>
        )}
      </div>

      {!workspace ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          Create a workspace to edit settings.
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-auto pr-1">
          {selectedNode ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold">{selectedAgent?.name || 'Missing agent definition'}</h4>
                  <p className="text-[11px] uppercase text-muted-foreground">{selectedNode.role}</p>
                </div>
              </div>
              <InspectorField label="Label" value={selectedNode.label || ''} onChange={value => onPatchNode({ label: value })} />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Role</span>
                <select
                  value={selectedNode.role}
                  onChange={event => onPatchNode({ role: event.target.value as WorkspaceAgentRole })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {ROLE_OPTIONS.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              <InspectorField label="Model override" value={selectedNode.modelOverride || ''} onChange={value => onPatchNode({ modelOverride: value })} />
              <InspectorField label="Skills" value={toCsv(selectedNode.skills)} onChange={value => onPatchNode({ skills: splitCsv(value) })} />
              <InspectorField label="Toolsets" value={toCsv(selectedNode.toolsets)} onChange={value => onPatchNode({ toolsets: splitCsv(value) })} />
              <RelationsEditor
                workspace={workspace}
                selectedNode={selectedNode}
                agentsById={agentsById}
                onAddEdge={onAddEdge}
                onRemoveEdge={onRemoveEdge}
                onSelectNode={onSelectNode}
              />
            </div>
          ) : (
            <NodeQuickSelect
              workspace={workspace}
              agentsById={agentsById}
              onSelectNode={onSelectNode}
            />
          )}

          <div className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Workspace</h4>
            <InspectorField label="Workspace name" value={workspace.name} onChange={value => onPatchWorkspace({ name: value })} />
            <div className="mt-3 space-y-3">
              <InspectorField label="Description" value={workspace.description || ''} onChange={value => onPatchWorkspace({ description: value })} />
              <InspectorTextArea label="Shared context" value={workspace.sharedContext} onChange={value => onPatchWorkspace({ sharedContext: value })} />
              <InspectorTextArea label="Common rules" value={workspace.commonRules} onChange={value => onPatchWorkspace({ commonRules: value })} />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Execution mode</span>
                <select
                  value={workspace.defaultMode}
                  onChange={event => onPatchWorkspace({ defaultMode: event.target.value as AgentWorkspace['defaultMode'] })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="prompt">Prompt → copy to Chat</option>
                  <option value="delegate">Delegate task bridge</option>
                  <option value="profiles">Profile runtime bridge</option>
                </select>
              </label>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Generated Prompt</h4>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onSendToChat}
                  disabled={!workspace}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Send size={13} />
                  Send to Chat
                </button>
                <button
                  onClick={onCopyPrompt}
                  disabled={!generatedPrompt}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <textarea
              value={generatedPrompt}
              readOnly
              placeholder="Generated workspace prompt will appear here."
              className="min-h-[180px] w-full resize-y rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-xs leading-5 text-foreground focus:outline-none"
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function getNodeLabel(
  node: WorkspaceAgentNode | null | undefined,
  agentsById: Map<string, AgentDefinition>,
) {
  if (!node) return 'Missing node';
  return node.label || agentsById.get(node.agentId)?.name || 'Missing agent';
}

function formatEdgeKindLabel(kind: WorkspaceEdgeKind) {
  return kind.replace(/-/g, ' ');
}

function NodeQuickSelect({
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

function RelationsEditor({
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

function InspectorField({
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

function InspectorTextArea({
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
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-h-[96px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}
