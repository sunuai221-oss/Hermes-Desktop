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
      <AgentStudioWorkspaces />
    </motion.div>
  );
}
