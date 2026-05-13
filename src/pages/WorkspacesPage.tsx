import { motion } from 'framer-motion';
import { AgentStudioWorkspaces } from './agent-studio/AgentStudioWorkspaces';

export function WorkspacesPage() {
  return (
    <motion.div
      key="workspaces"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto max-w-7xl space-y-5"
    >
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Workspaces</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Multi-agent compositions built from templates.</p>
      </div>
      <AgentStudioWorkspaces />
    </motion.div>
  );
}
