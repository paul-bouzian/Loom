import type { EnvironmentKind } from "../lib/types";
import "./EnvironmentKindBadge.css";

type Props = {
  kind: EnvironmentKind;
};

const labels: Record<EnvironmentKind, string> = {
  local: "Local",
  managedWorktree: "Worktree",
  permanentWorktree: "Permanent",
  chat: "Chat",
};

export function EnvironmentKindBadge({ kind }: Props) {
  return (
    <span className={`env-badge env-badge--${kind}`}>{labels[kind]}</span>
  );
}
