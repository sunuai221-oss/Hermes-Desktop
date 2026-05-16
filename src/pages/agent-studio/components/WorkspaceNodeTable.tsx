import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { AgentDefinition, AgentWorkspace } from '../../../types';

type SortKey = 'label' | 'role' | 'agent' | 'profileName' | 'modelOverride';

type WorkspaceNodeTableProps = {
  workspace: AgentWorkspace;
  agentsById: Map<string, AgentDefinition>;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
};

export function WorkspaceNodeTable({
  workspace,
  agentsById,
  selectedNodeId,
  onSelectNode,
}: WorkspaceNodeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('label');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedNodes = useMemo(() => {
    const nodes = [...workspace.nodes];
    nodes.sort((a, b) => {
      const aAgent = agentsById.get(a.agentId);
      const bAgent = agentsById.get(b.agentId);
      let cmp = 0;
      switch (sortKey) {
        case 'label':
          cmp = (a.label || aAgent?.name || a.id).localeCompare(b.label || bAgent?.name || b.id);
          break;
        case 'role':
          cmp = a.role.localeCompare(b.role);
          break;
        case 'agent':
          cmp = (aAgent?.name || '').localeCompare(bAgent?.name || '');
          break;
        case 'profileName':
          cmp = (a.profileName || '').localeCompare(b.profileName || '');
          break;
        case 'modelOverride':
          cmp = (a.modelOverride || '').localeCompare(b.modelOverride || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return nodes;
  }, [workspace.nodes, agentsById, sortKey, sortDir]);

  const columns: Array<{ key: SortKey; label: string; className?: string }> = [
    { key: 'label', label: 'Name', className: 'min-w-[140px]' },
    { key: 'role', label: 'Role', className: 'w-[100px]' },
    { key: 'agent', label: 'Agent', className: 'min-w-[120px]' },
    { key: 'profileName', label: 'Profile', className: 'w-[120px]' },
    { key: 'modelOverride', label: 'Model', className: 'min-w-[100px]' },
  ];

  if (workspace.nodes.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground italic">
        No nodes in this workspace. Drag agents from the template library to add them.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {columns.map(col => (
              <th
                key={col.key}
                className={cn(
                  'cursor-pointer select-none px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground',
                  col.className,
                )}
                onClick={() => handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key ? (
                    sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                  ) : (
                    <ArrowUpDown size={12} className="opacity-30" />
                  )}
                </span>
              </th>
            ))}
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Skills
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Toolsets
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedNodes.map(node => {
            const agent = agentsById.get(node.agentId);
            const isSelected = node.id === selectedNodeId;
            return (
              <tr
                key={node.id}
                onClick={() => onSelectNode(node.id)}
                className={cn(
                  'cursor-pointer border-b border-border/40 transition-colors last:border-0 hover:bg-muted/40',
                  isSelected && 'bg-primary/8',
                )}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {agent?.emoji && <span className="text-sm">{agent.emoji}</span>}
                    <span className="font-medium text-foreground">
                      {node.label || agent?.name || '—'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground uppercase">
                    {node.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {agent?.name || '—'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {node.profileName || '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {node.modelOverride || '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <MultiBadge items={node.skills} limit={2} />
                </td>
                <td className="px-4 py-3 text-right">
                  <MultiBadge items={node.toolsets} limit={2} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MultiBadge({ items, limit }: { items?: string[]; limit: number }) {
  if (!items || items.length === 0) return <span className="text-xs text-muted-foreground/50">—</span>;
  const visible = items.slice(0, limit);
  const remaining = items.length - limit;
  return (
    <span className="inline-flex items-center gap-1">
      {visible.map(item => (
        <span
          key={item}
          className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {item}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[10px] text-muted-foreground/50">+{remaining}</span>
      )}
    </span>
  );
}
