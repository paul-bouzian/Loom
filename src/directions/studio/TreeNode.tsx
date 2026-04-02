import { type ReactNode, useState } from "react";
import { ChevronRightIcon } from "../../shared/Icons";
import "./TreeNode.css";

type Props = {
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  defaultExpanded?: boolean;
  depth?: number;
  onClick?: () => void;
  children?: ReactNode;
};

export function TreeNode({
  label,
  icon,
  badge,
  trailing,
  selected = false,
  defaultExpanded = false,
  depth = 0,
  onClick,
  children,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = !!children;

  function handleClick() {
    onClick?.();
    if (hasChildren) setExpanded((v) => !v);
  }

  return (
    <div className="tree-node">
      <button
        className={`tree-node__row ${selected ? "tree-node__row--selected" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
      >
        {hasChildren && (
          <span className={`tree-node__chevron ${expanded ? "tree-node__chevron--open" : ""}`}>
            <ChevronRightIcon size={10} />
          </span>
        )}
        {!hasChildren && <span className="tree-node__spacer" />}
        {icon && <span className="tree-node__icon">{icon}</span>}
        <span className="tree-node__label">{label}</span>
        {badge && <span className="tree-node__badge">{badge}</span>}
        {trailing && <span className="tree-node__trailing">{trailing}</span>}
      </button>
      {expanded && hasChildren && (
        <div className="tree-node__children">{children}</div>
      )}
    </div>
  );
}
