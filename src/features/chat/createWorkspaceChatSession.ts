function timestampLabel(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function workspaceSessionTitle(workspaceName: unknown) {
  const name = String(workspaceName || 'Workspace').trim() || 'Workspace';
  return `${name} workspace ${timestampLabel()}`.slice(0, 100);
}

type WorkspaceSessionPayload = {
  source: 'agent-studio-workspace';
  model: string;
  title?: string;
  workspace_id?: string;
  workspace_name?: string;
};

interface CreateWorkspaceChatSessionOptions {
  model: string;
  workspaceId?: string;
  workspaceName?: string;
  createSession: (payload: WorkspaceSessionPayload) => Promise<{ id?: string | number } | null>;
  hydrateSession: (sessionId: string) => Promise<void>;
  handleNewChat: () => void;
}

export async function createWorkspaceChatSession({
  model,
  workspaceId,
  workspaceName,
  createSession,
  hydrateSession,
  handleNewChat,
}: CreateWorkspaceChatSessionOptions): Promise<string | null> {
  const basePayload: WorkspaceSessionPayload = {
    source: 'agent-studio-workspace',
    model,
    workspace_id: workspaceId,
    workspace_name: workspaceName,
  };

  try {
    const created = await createSession({
      ...basePayload,
      title: workspaceSessionTitle(workspaceName),
    });
    if (created?.id) {
      const sessionId = String(created.id);
      await hydrateSession(sessionId);
      return sessionId;
    }
  } catch {
    // Fallback to untitled session creation while preserving workspace isolation.
  }

  try {
    const created = await createSession(basePayload);
    if (created?.id) {
      const sessionId = String(created.id);
      await hydrateSession(sessionId);
      return sessionId;
    }
  } catch {
    // Fall through to local reset; prompt should still avoid previous chat bleed.
  }

  handleNewChat();
  return null;
}
