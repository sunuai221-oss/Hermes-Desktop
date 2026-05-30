import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Check, Copy, GripVertical, Loader2, RotateCcw, Send, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useState, useCallback, useEffect, useRef, type CSSProperties, type MutableRefObject } from 'react';
import { Card } from '../../../components/Card';
import { useProfiles } from '../../../contexts/ProfileContext';
import { cn } from '../../../lib/utils';
import type {
  AgentDefinition,
  AgentWorkspace,
  WorkspaceAgentNode,
  WorkspaceAgentRole,
  WorkspaceAutoConfigPlan,
  WorkspaceAutoConfigPreviewResult,
  WorkspaceEdgeKind,
} from '../../../types';
import { resolveWorkspaceNodeProfile } from '../profileRuntime';
import {
  AutoConfigDiffRow,
  CollapsibleSection,
  EdgeDetailBlock,
  InspectorField,
  InspectorTextArea,
  NodeProfileHint,
  NodeQuickSelect,
  RelationsEditor,
} from './WorkspaceEditorControls';
import { ROLE_OPTIONS, formatProfileOptionLabel, splitCsv, toCsv } from './WorkspaceEditorUtils';

const NODE_CARD_WIDTH = 224;
const NODE_CARD_HEIGHT = 104;

type WorkspaceEditorPanelProps = {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  canvasZoom: number;
  onCanvasZoomChange: (zoom: number) => void;
  onCanvasPanChange?: (pan: { x: number; y: number }) => void;
  workspace: AgentWorkspace | null;
  agentsById: Map<string, AgentDefinition>;
  selectedNode: WorkspaceAgentNode | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  generatedPrompt: string;
  copied: boolean;
  sendingToChat: boolean;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onRemoveNode: (id: string) => void;
  onAddEdge: (fromNodeId: string, toNodeId: string, kind: WorkspaceEdgeKind) => void;
  onRemoveEdge: (edgeId: string) => void;
  onPatchWorkspace: (patch: Partial<AgentWorkspace>) => void;
  onPatchNode: (patch: Partial<WorkspaceAgentNode>) => void;
  onCopyPrompt: () => void;
  onSendToChat: () => void;
  autoConfigBusy: boolean;
  autoConfigPreview: WorkspaceAutoConfigPreviewResult | null;
  autoConfigPlan: WorkspaceAutoConfigPlan | null;
  autoConfigSaving: boolean;
  onGenerateAutoConfig: () => void;
  onApplyAutoConfig: () => void;
  onApplyAndSaveAutoConfig: () => void;
  onDiscardAutoConfig: () => void;
};

export function WorkspaceEditorPanel({
  canvasRef,
  canvasZoom,
  onCanvasZoomChange,
  onCanvasPanChange,
  workspace,
  agentsById,
  selectedNode,
  selectedNodeId,
  selectedEdgeId,
  generatedPrompt,
  copied,
  sendingToChat,
  onSelectNode,
  onSelectEdge,
  onRemoveNode,
  onAddEdge,
  onRemoveEdge,
  onPatchWorkspace,
  onPatchNode,
  onCopyPrompt,
  onSendToChat,
  autoConfigBusy,
  autoConfigPreview,
  autoConfigPlan,
  autoConfigSaving,
  onGenerateAutoConfig,
  onApplyAutoConfig,
  onApplyAndSaveAutoConfig,
  onDiscardAutoConfig,
}: WorkspaceEditorPanelProps) {
  const selectedAgent = selectedNode ? agentsById.get(selectedNode.agentId) || null : null;

  return (
    <>
      <WorkspaceCanvas
        canvasRef={canvasRef}
        canvasZoom={canvasZoom}
        onCanvasZoomChange={onCanvasZoomChange}
        onCanvasPanChange={onCanvasPanChange}
        workspace={workspace}
        agentsById={agentsById}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
        onRemoveEdge={onRemoveEdge}
        onRemoveNode={onRemoveNode}
      />
      <InspectorPanel
        workspace={workspace}
        selectedNode={selectedNode}
        selectedAgent={selectedAgent}
        agentsById={agentsById}
        selectedEdgeId={selectedEdgeId}
        onSelectEdge={onSelectEdge}
        generatedPrompt={generatedPrompt}
        copied={copied}
        sendingToChat={sendingToChat}
        onSelectNode={onSelectNode}
        onAddEdge={onAddEdge}
        onRemoveEdge={onRemoveEdge}
        onPatchWorkspace={onPatchWorkspace}
        onPatchNode={onPatchNode}
        onCopyPrompt={onCopyPrompt}
        onSendToChat={onSendToChat}
        autoConfigBusy={autoConfigBusy}
        autoConfigPreview={autoConfigPreview}
        autoConfigPlan={autoConfigPlan}
        autoConfigSaving={autoConfigSaving}
        onGenerateAutoConfig={onGenerateAutoConfig}
        onApplyAutoConfig={onApplyAutoConfig}
        onApplyAndSaveAutoConfig={onApplyAndSaveAutoConfig}
        onDiscardAutoConfig={onDiscardAutoConfig}
      />
    </>
  );
}

function WorkspaceCanvas({
  canvasRef,
  canvasZoom,
  onCanvasZoomChange,
  onCanvasPanChange,
  workspace,
  agentsById,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onRemoveEdge,
  onRemoveNode,
}: {
  canvasRef: MutableRefObject<HTMLDivElement | null>;
  canvasZoom: number;
  onCanvasZoomChange: (zoom: number) => void;
  onCanvasPanChange?: (pan: { x: number; y: number }) => void;
  workspace: AgentWorkspace | null;
  agentsById: Map<string, AgentDefinition>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onRemoveEdge: (id: string) => void;
  onRemoveNode: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'workspace-canvas' });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    onCanvasPanChange?.(pan);
  }, [onCanvasPanChange, pan]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      const next = Math.max(0.25, Math.min(3, canvasZoom * (1 + delta)));
      onCanvasZoomChange(next);
    }
  }, [canvasZoom, onCanvasZoomChange]);

  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start pan when clicking the background (not on a node)
    const target = e.target as HTMLElement;
    if (target.closest('[data-node-card]')) return;
    isPanningRef.current = true;
    setIsPanning(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleBackgroundMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const handleBackgroundMouseUp = useCallback(() => {
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);

  const zoomIn = useCallback(() => {
    onCanvasZoomChange(Math.min(3, canvasZoom * 1.25));
  }, [canvasZoom, onCanvasZoomChange]);

  const zoomOut = useCallback(() => {
    onCanvasZoomChange(Math.max(0.25, canvasZoom / 1.25));
  }, [canvasZoom, onCanvasZoomChange]);

  const resetZoom = useCallback(() => {
    onCanvasZoomChange(1);
    setPan({ x: 0, y: 0 });
  }, [onCanvasZoomChange]);

  const hasContent = workspace && workspace.nodes.length > 0;

  return (
    <Card className="relative min-h-[680px] overflow-hidden">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{workspace?.name || 'No workspace selected'}</h3>
          <p className="text-xs text-muted-foreground">{workspace?.nodes.length || 0} node(s)</p>
        </div>
      </div>

      {/* Canvas viewport */}
      <div
        ref={node => {
          setNodeRef(node);
          canvasRef.current = node;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-canvas-bg]')) {
            onSelectNode(null);
          }
        }}
        onWheel={handleWheel}
        onMouseDown={handleBackgroundMouseDown}
        onMouseMove={handleBackgroundMouseMove}
        onMouseUp={handleBackgroundMouseUp}
        onMouseLeave={handleBackgroundMouseUp}
        className={cn(
          'relative min-h-[628px] overflow-hidden',
          isPanning && 'cursor-grabbing',
          !isPanning && 'cursor-grab',
        )}
      >
        {/* Grid background (static) */}
        <div
          className={cn(
            'absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] [background-size:24px_24px]',
            isOver && 'bg-primary/5',
          )}
          data-canvas-bg
        />

        {!workspace ? (
          <div className="relative z-10 flex h-[628px] items-center justify-center text-sm text-muted-foreground">
            Create a workspace to start arranging agents.
          </div>
        ) : workspace.nodes.length === 0 ? (
          <div className="relative z-10 flex h-[628px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Drag templates from the library into this workspace.
          </div>
        ) : (
          /* Stable render plane transformed with pan+zoom for both nodes and edges */
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${canvasZoom})`,
              transformOrigin: 'top left',
            }}
          >
            <WorkspaceEdgesOverlay workspace={workspace} selectedNodeId={selectedNodeId} selectedEdgeId={selectedEdgeId} onSelectEdge={onSelectEdge} onRemoveEdge={onRemoveEdge} />
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
          </div>
        )}

        {/* Zoom controls — always visible */}
        {hasContent && (
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/90 px-2 py-1.5 shadow-sm backdrop-blur">
            <button
              onClick={zoomOut}
              disabled={canvasZoom <= 0.25}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <span className="min-w-[44px] text-center text-[11px] font-medium tabular-nums text-muted-foreground">
              {Math.round(canvasZoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={canvasZoom >= 3}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <div className="mx-1 h-4 w-px bg-border" />
            <button
              onClick={resetZoom}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Reset zoom and pan"
            >
              <RotateCcw size={13} />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function WorkspaceEdgesOverlay({
  workspace,
  selectedNodeId,
  selectedEdgeId,
  onSelectEdge,
  onRemoveEdge,
}: {
  workspace: AgentWorkspace;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectEdge: (id: string | null) => void;
  onRemoveEdge: (id: string) => void;
}) {
  const nodesById = useMemo(
    () => new Map(workspace.nodes.map(node => [node.id, node] as const)),
    [workspace.nodes],
  );
  const visibleEdges = (workspace.edges || []).filter(edge => nodesById.has(edge.fromNodeId) && nodesById.has(edge.toNodeId));

  if (visibleEdges.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible" aria-hidden="true">
      <defs>
        <marker id="workspace-edge-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,4 L0,8 Z" className="fill-primary" />
        </marker>
        <marker id="workspace-edge-arrow-selected" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
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
        const nodeSelected = selectedNodeId === edge.fromNodeId || selectedNodeId === edge.toNodeId;
        const edgeSelected = selectedEdgeId === edge.id;
        const edgeD = `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;
        const labelY = (fromY + toY) / 2 - 10;

        return (
          <g key={edge.id}>
            {/* Invisible wider hit area for clicking */}
            <path
              d={edgeD}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); onSelectEdge(edge.id); }}
            />
            {/* Visible stroke */}
            <path
              d={edgeD}
              className={cn(
                'fill-none transition-all duration-150',
                edgeSelected
                  ? 'stroke-primary stroke-[3]'
                  : nodeSelected
                    ? 'stroke-primary/70 stroke-[2]'
                    : 'stroke-primary/50 stroke-[1.5]',
              )}
              style={{ pointerEvents: 'none' }}
              markerEnd={edgeSelected || nodeSelected ? 'url(#workspace-edge-arrow-selected)' : 'url(#workspace-edge-arrow)'}
            />
            {/* Label */}
            <text
              x={middleX}
              y={labelY}
              textAnchor="middle"
              className={cn(
                'text-[10px] uppercase transition-all duration-150',
                edgeSelected ? 'fill-primary font-semibold' : 'fill-muted-foreground',
              )}
              style={{ pointerEvents: 'none' }}
            >
              {edge.kind}
            </text>
            {/* Remove button — always visible when selected */}
            {edgeSelected && (
              <g
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onRemoveEdge(edge.id); onSelectEdge(null); }}
              >
                <rect
                  x={middleX - 8}
                  y={(fromY + toY) / 2 + 2}
                  width={16}
                  height={16}
                  rx={4}
                  className="fill-destructive/20"
                />
                <text
                  x={middleX}
                  y={(fromY + toY) / 2 + 14}
                  textAnchor="middle"
                  className="fill-destructive text-xs font-bold"
                >
                  ✕
                </text>
              </g>
            )}
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
      data-node-card
      className={cn(
        'pointer-events-auto absolute left-0 top-0 z-10 rounded-lg border bg-card p-3 shadow-sm transition-shadow',
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
  sendingToChat,
  selectedEdgeId,
  onSelectEdge,
  onSelectNode,
  onAddEdge,
  onRemoveEdge,
  onPatchWorkspace,
  onPatchNode,
  onCopyPrompt,
  onSendToChat,
  autoConfigBusy,
  autoConfigPreview,
  autoConfigPlan,
  autoConfigSaving,
  onGenerateAutoConfig,
  onApplyAutoConfig,
  onApplyAndSaveAutoConfig,
  onDiscardAutoConfig,
}: {
  workspace: AgentWorkspace | null;
  selectedNode: WorkspaceAgentNode | null;
  selectedAgent: AgentDefinition | null;
  agentsById: Map<string, AgentDefinition>;
  generatedPrompt: string;
  copied: boolean;
  sendingToChat: boolean;
  selectedEdgeId: string | null;
  onSelectEdge: (id: string | null) => void;
  onSelectNode: (id: string | null) => void;
  onAddEdge: (fromNodeId: string, toNodeId: string, kind: WorkspaceEdgeKind) => void;
  onRemoveEdge: (edgeId: string) => void;
  onPatchWorkspace: (patch: Partial<AgentWorkspace>) => void;
  onPatchNode: (patch: Partial<WorkspaceAgentNode>) => void;
  onCopyPrompt: () => void;
  onSendToChat: () => void;
  autoConfigBusy: boolean;
  autoConfigPreview: WorkspaceAutoConfigPreviewResult | null;
  autoConfigPlan: WorkspaceAutoConfigPlan | null;
  autoConfigSaving: boolean;
  onGenerateAutoConfig: () => void;
  onApplyAutoConfig: () => void;
  onApplyAndSaveAutoConfig: () => void;
  onDiscardAutoConfig: () => void;
}) {
  const { currentProfile, profileMetadata } = useProfiles();
  const autoConfigGroups = useMemo(() => {
    const items = autoConfigPlan?.items || [];
    return [
      { id: 'workspace', label: 'Workspace fields', items: items.filter(item => item.category === 'workspace') },
      { id: 'mode', label: 'Execution mode', items: items.filter(item => item.category === 'mode') },
      { id: 'node', label: 'Nodes', items: items.filter(item => item.category === 'node') },
      { id: 'edge', label: 'Relations', items: items.filter(item => item.category === 'edge') },
    ].filter(group => group.items.length > 0);
  }, [autoConfigPlan]);
  const canApplyAutoConfig = Boolean(autoConfigPreview && autoConfigPlan?.hasChanges && !autoConfigBusy && !autoConfigSaving);
  const selectedNodeProfile = useMemo(
    () => (selectedNode
      ? resolveWorkspaceNodeProfile({
        requestedProfileName: selectedNode.profileName,
        currentProfile,
        profileMetadata,
      })
      : null),
    [currentProfile, profileMetadata, selectedNode],
  );
  const profileOptions = useMemo(() => {
    if (!selectedNodeProfile) return [];
    const options = profileMetadata.map(profile => ({
      value: profile.name,
      label: formatProfileOptionLabel(profile, currentProfile),
    }));
    if (
      selectedNodeProfile.requestedProfileName
      && !options.some(option => option.value === selectedNodeProfile.requestedProfileName)
    ) {
      options.unshift({
        value: selectedNodeProfile.requestedProfileName,
        label: `${selectedNodeProfile.requestedProfileName} (${selectedNodeProfile.status === 'invalid' ? 'invalid' : 'missing'})`,
      });
    }
    return options;
  }, [currentProfile, profileMetadata, selectedNodeProfile]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    node: false,
    workspace: false,
    prompt: false,
  });

  const toggleSection = useCallback((id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

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
        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
          {/* ── Node section (only when a node is selected) ── */}
          {selectedNode && (
            <CollapsibleSection
              id="node"
              label={selectedAgent?.name || 'Node'}
              count={null}
              collapsed={collapsed.node}
              onToggle={toggleSection}
            >
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
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Profile runtime</span>
                  <select
                    value={selectedNodeProfile?.requestedProfileName || ''}
                    onChange={event => onPatchNode({ profileName: event.target.value || undefined })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">Use current app profile ({currentProfile})</option>
                    {profileOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {selectedNodeProfile && (
                  <NodeProfileHint
                    resolution={selectedNodeProfile}
                    profileModeActive={workspace?.defaultMode === 'profiles'}
                  />
                )}
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
            </CollapsibleSection>
          )}

          {/* ── Edge detail (when an edge is selected) ── */}
          {selectedEdgeId && workspace && (
            <EdgeDetailBlock
              edgeId={selectedEdgeId}
              workspace={workspace}
              agentsById={agentsById}
              onSelectEdge={onSelectEdge}
              onRemoveEdge={onRemoveEdge}
            />
          )}

          {/* ── Node quick select (when no node selected) ── */}
          {!selectedNode && (
            <NodeQuickSelect
              workspace={workspace}
              agentsById={agentsById}
              onSelectNode={onSelectNode}
            />
          )}

          {/* ── Workspace section ── */}
          <CollapsibleSection
            id="workspace"
            label="Workspace"
            count={null}
            collapsed={collapsed.workspace}
            onToggle={toggleSection}
          >
            <div className="space-y-3">
              <InspectorField label="Workspace name" value={workspace.name} onChange={value => onPatchWorkspace({ name: value })} />
              <InspectorField label="Description" value={workspace.description || ''} onChange={value => onPatchWorkspace({ description: value })} />
              <InspectorTextArea
                label="Pipeline brief"
                value={workspace.pipelineBrief || ''}
                onChange={value => onPatchWorkspace({ pipelineBrief: value })}
                placeholder="Describe who does what in this pipeline, then auto-configure roles and relations."
              />
              <InspectorTextArea label="Shared context" value={workspace.sharedContext} onChange={value => onPatchWorkspace({ sharedContext: value })} />
              <InspectorTextArea label="Common rules" value={workspace.commonRules} onChange={value => onPatchWorkspace({ commonRules: value })} />
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onGenerateAutoConfig}
                    disabled={!workspace.nodes.length || autoConfigBusy || !String(workspace.pipelineBrief || '').trim()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {autoConfigBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    Preview auto-config
                  </button>
                  <button
                    type="button"
                    onClick={onApplyAutoConfig}
                    disabled={!canApplyAutoConfig}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    Apply preview
                  </button>
                  <button
                    type="button"
                    onClick={onApplyAndSaveAutoConfig}
                    disabled={!canApplyAutoConfig}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                  >
                    {autoConfigSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Apply & Save
                  </button>
                  <button
                    type="button"
                    onClick={onDiscardAutoConfig}
                    disabled={!autoConfigPreview}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    Discard preview
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Uses your pipeline brief to suggest roles, relations, and workspace defaults.
                </p>
                {autoConfigPreview && (
                  <div className="space-y-3 rounded-md border border-border bg-background px-2.5 py-2 text-[11px]">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{autoConfigPreview.suggestion.summary || 'Preview ready.'}</p>
                      <p className="text-muted-foreground">
                        {autoConfigPlan?.hasChanges
                          ? `${autoConfigPlan.items.length} actionable change(s) ready to apply.`
                          : 'Preview ready, but there are no actionable changes.'}
                      </p>
                    </div>
                    {autoConfigGroups.length > 0 && (
                      <div className="space-y-3">
                        {autoConfigGroups.map(group => (
                          <div key={group.id} className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase text-muted-foreground">{group.label}</p>
                            <div className="space-y-1.5">
                              {group.items.map(item => (
                                <AutoConfigDiffRow key={item.id} item={item} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
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
          </CollapsibleSection>

          {/* ── Prompt section ── */}
          <CollapsibleSection
            id="prompt"
            label="Generated Prompt"
            count={generatedPrompt ? '1' : null}
            collapsed={collapsed.prompt}
            onToggle={toggleSection}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={onSendToChat}
                    disabled={!workspace || sendingToChat}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {sendingToChat ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {sendingToChat ? 'Sending...' : 'Send to Chat'}
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
          </CollapsibleSection>
        </div>
      )}
    </Card>
  );
}
