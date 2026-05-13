import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTemplatesLibrary } from '../../features/templates/hooks/useTemplatesLibrary';
import { cn } from '../../lib/utils';
import { WorkspaceEditorPanel } from './components/WorkspaceEditorPanel';
import { WorkspaceInterfacePanel } from './components/WorkspaceInterfacePanel';
import { WorkspaceListPanel } from './components/WorkspaceListPanel';
import { WorkspaceRunPanel } from './components/WorkspaceRunPanel';
import { WorkspaceTemplatePanel } from './components/WorkspaceTemplatePanel';
import { useWorkspaceCrud } from './hooks/useWorkspaceCrud';
import { useWorkspaceExecution } from './hooks/useWorkspaceExecution';

type WorkspaceTab = 'canvas' | 'interface' | 'runs';

export function AgentStudioWorkspaces() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('canvas');
  const resetExecutionStateRef = useRef<() => void>(() => {});

  const {
    templates: agents,
    query,
    setQuery,
    sourceFilter,
    setSourceFilter,
    divisionFilter,
    setDivisionFilter,
    importValue,
    setImportValue,
    importSummary,
    importing,
    error: libraryError,
    clearError: clearLibraryError,
    sources,
    divisions,
    groupedTemplates: groupedAgents,
    loadTemplates,
    loadBundledAgencyCatalog,
    syncDefaultAgencyRepo,
    importAgencySource,
  } = useTemplatesLibrary({ autoLoad: false });

  const handleWorkspaceContextReset = useCallback(() => {
    resetExecutionStateRef.current();
    setActiveTab('canvas');
  }, []);

  const {
    workspaces,
    activeWorkspaceId,
    selectedNodeId,
    loading,
    saving,
    error,
    setError,
    activeWorkspace,
    selectedNode,
    setSelectedNodeId,
    load,
    selectWorkspace,
    createWorkspace,
    saveWorkspace,
    deleteWorkspace,
    patchActiveWorkspace,
    patchSelectedNode,
    removeNode,
    addEdge,
    removeEdge,
    handleDragEnd: handleWorkspaceDragEnd,
  } = useWorkspaceCrud({
    loadTemplates,
    clearLibraryError,
    onWorkspaceContextReset: handleWorkspaceContextReset,
  });

  useEffect(() => {
    void load();
  }, [load]);

  const {
    generatedPrompt,
    executionResult,
    generating,
    executing,
    copied,
    resetExecutionState,
    generatePrompt,
    copyPrompt,
    sendPromptToChat,
    executeWorkspace,
  } = useWorkspaceExecution({
    activeWorkspace,
    saveWorkspace,
    clearLibraryError,
    onError: message => setError(message),
    onNavigateToChat: () => navigate('/chat'),
    onAfterExecute: () => setActiveTab('runs'),
  });

  useEffect(() => {
    resetExecutionStateRef.current = resetExecutionState;
  }, [resetExecutionState]);

  const agentsById = useMemo(
    () => new Map(agents.map(agent => [agent.id, agent] as const)),
    [agents],
  );
  const displayError = error || libraryError;

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    handleWorkspaceDragEnd(event, agentsById, canvasRef);
  }, [agentsById, handleWorkspaceDragEnd]);

  const templatePanelProps = {
    title: 'Templates',
    templates: agents,
    groupedTemplates: groupedAgents,
    query,
    sourceFilter,
    divisionFilter,
    sources,
    divisions,
    importValue,
    importSummary,
    importing,
    onQueryChange: setQuery,
    onSourceFilterChange: setSourceFilter,
    onDivisionFilterChange: setDivisionFilter,
    onImportValueChange: setImportValue,
    onImportBundled: () => {
      void loadBundledAgencyCatalog();
    },
    onImportDefault: () => {
      void syncDefaultAgencyRepo();
    },
    onImportSource: () => {
      void importAgencySource();
    },
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <DndContext onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
      <div className="space-y-4">
        <WorkspaceListPanel
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          saving={saving}
          generating={generating}
          hasActiveWorkspace={Boolean(activeWorkspace)}
          onSelectWorkspace={selectWorkspace}
          onCreateWorkspace={() => {
            void createWorkspace();
          }}
          onSaveWorkspace={() => {
            void saveWorkspace();
          }}
          onGeneratePrompt={() => {
            void generatePrompt();
          }}
          onOpenInterface={() => setActiveTab('interface')}
          onDeleteWorkspace={() => {
            void deleteWorkspace();
          }}
        />

        {displayError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {displayError}
          </div>
        )}

        <WorkspaceTabs
          activeTab={activeTab}
          onChange={setActiveTab}

          nodeCount={activeWorkspace?.nodes.length || 0}
          hasGeneratedPrompt={Boolean(generatedPrompt)}
        />

        {activeTab === 'canvas' && (
          <div className="grid min-h-[680px] grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
            <WorkspaceTemplatePanel {...templatePanelProps} />
            <WorkspaceEditorPanel
              canvasRef={canvasRef}
              workspace={activeWorkspace}
              agentsById={agentsById}
              selectedNodeId={selectedNodeId}
              selectedNode={selectedNode}
              generatedPrompt={generatedPrompt}
              copied={copied}
              onSelectNode={setSelectedNodeId}
              onRemoveNode={removeNode}
              onAddEdge={addEdge}
              onRemoveEdge={removeEdge}
              onPatchWorkspace={patchActiveWorkspace}
              onPatchNode={patchSelectedNode}
              onCopyPrompt={() => {
                void copyPrompt();
              }}
              onSendToChat={() => {
                void sendPromptToChat();
              }}
            />
          </div>
        )}

        {activeTab === 'interface' && (
          <WorkspaceInterfacePanel
            workspace={activeWorkspace}
            agentsById={agentsById}
            saveWorkspace={saveWorkspace}
            onError={message => setError(message)}
          />
        )}

        {activeTab === 'runs' && (
          <WorkspaceRunPanel
            workspace={activeWorkspace}
            generatedPrompt={generatedPrompt}
            copied={copied}
            generating={generating}
            executing={executing}
            executionResult={executionResult}
            onGeneratePrompt={() => {
              void generatePrompt();
            }}
            onCopyPrompt={() => {
              void copyPrompt();
            }}
            onSendToChat={() => {
              void sendPromptToChat();
            }}
            onExecuteWorkspace={() => {
              void executeWorkspace();
            }}
          />
        )}
      </div>
    </DndContext>
  );
}

function WorkspaceTabs({
  activeTab,
  onChange,
  nodeCount,
  hasGeneratedPrompt,
}: {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
  nodeCount: number;
  hasGeneratedPrompt: boolean;
}) {
  const tabs: Array<{ id: WorkspaceTab; label: string; description: string; count?: string }> = [
    { id: 'canvas', label: 'Canvas', description: 'Compose & edit', count: String(nodeCount) },
    { id: 'interface', label: 'Interface', description: 'Workspace chat', count: String(nodeCount) },
    { id: 'runs', label: 'Runs', description: 'Execution outputs', count: hasGeneratedPrompt ? '1' : '0' },
  ];

  return (
    <div className="flex flex-wrap gap-2 border-b border-border">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'group -mb-px flex items-center gap-3 border-b-2 px-4 py-3 text-left transition-colors',
            activeTab === tab.id
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <span>
            <span className="block text-sm font-medium">{tab.label}</span>
            <span className="block text-[11px] text-muted-foreground">{tab.description}</span>
          </span>
          {tab.count && (
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold',
              activeTab === tab.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
