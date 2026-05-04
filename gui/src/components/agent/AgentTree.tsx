// Elenchus GUI - Agent Tree Component
// Displays the hierarchical agent unit tree with state indicators.

import React, { useState } from "react";
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
      return "bg-[var(--color-accent)] animate-pulse";
    case "executing":
      return "bg-[var(--color-text-secondary)] animate-pulse";
    case "idle":
    case "terminated":
    default:
      return "bg-[var(--color-border-strong)]";
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
        className={`sidebar-row cursor-pointer text-sm ${
          isSelected ? "is-active" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelectUnit(node.unitId)}
      >
        {hasChildren ? (
          <button
            className="sidebar-disclosure"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className={`sidebar-state-dot ${stateDotClass(node.state)}`} />
        <span className="font-medium text-[13px] text-[var(--color-text-secondary)]">{node.level}</span>
        <span className="sidebar-secondary-label truncate">{node.unitId.replace(/^(L\d+-)/, "")}</span>
        <span className="sidebar-row-meta ml-auto">{stateLabel(node.state)}</span>
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

function AgentTreeInner({ tree, selectedUnitId, onSelectUnit }: AgentTreeProps) {
  if (!tree) {
    return (
      <div className="flex flex-col h-full">
        <div className="sidebar-section-header">
          <div className="sidebar-section-title">Agents</div>
        </div>
        <div className="px-4 py-3 text-sm text-[var(--color-text-quaternary)]">
          No active session
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="sidebar-section-header">
        <div className="sidebar-section-title">Agents</div>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        <TreeNode node={tree} selectedUnitId={selectedUnitId} onSelectUnit={onSelectUnit} depth={0} />
      </div>
    </div>
  );
}

export const AgentTree = React.memo(AgentTreeInner);
