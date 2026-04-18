// Elenchus GUI - Agent Tree Component
// Displays the hierarchical agent unit tree with state indicators.

import { useState } from "react";
import type { AgentTreeNode, UnitState } from "../../lib/types";

interface AgentTreeProps {
  tree: AgentTreeNode | null;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string) => void;
}

function stateDotClass(state: UnitState): string {
  switch (state) {
    case "turn-a":
    case "turn-b":
      return "bg-stone-500 animate-pulse";
    case "executing":
      return "bg-stone-700 animate-pulse";
    case "idle":
    case "terminated":
    default:
      return "bg-stone-300";
  }
}

function stateLabel(state: UnitState): string {
  if (state === "terminated") return "idle";
  return state;
}

function TreeNode({ node, selectedUnitId, onSelectUnit, depth }: {
  node: AgentTreeNode;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.unitId === selectedUnitId;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-stone-50 rounded text-sm ${
          isSelected ? "bg-stone-100 text-gray-800" : "text-gray-700"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelectUnit(node.unitId)}
      >
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center text-stone-400 hover:text-stone-600"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${stateDotClass(node.state)}`} />
        <span className="font-medium">{node.level}</span>
        <span className="text-gray-400 truncate">{node.unitId.replace(/^(L\d+-)/, "")}</span>
        <span className="text-xs text-gray-400 ml-auto">{stateLabel(node.state)}</span>
      </div>
      {expanded && hasChildren && node.children.map((child) => (
        <TreeNode
          key={child.unitId}
          node={child}
          selectedUnitId={selectedUnitId}
          onSelectUnit={onSelectUnit}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function AgentTree({ tree, selectedUnitId, onSelectUnit }: AgentTreeProps) {
  if (!tree) {
    return (
      <div className="p-3 text-sm text-gray-400">
        <div className="font-semibold text-gray-600 mb-2">Agents</div>
        No active session
      </div>
    );
  }

  return (
    <div className="p-2">
      <div className="font-semibold text-gray-600 text-xs uppercase tracking-wider px-2 mb-1">Agents</div>
      <TreeNode node={tree} selectedUnitId={selectedUnitId} onSelectUnit={onSelectUnit} depth={0} />
    </div>
  );
}
