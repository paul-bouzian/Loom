import type { RuntimeState } from "../lib/types";
import "./RuntimeIndicator.css";

type Props = {
  state: RuntimeState;
  size?: "sm" | "md";
  label?: boolean;
};

const labels: Record<RuntimeState, string> = {
  running: "Running",
  stopped: "Stopped",
  exited: "Exited",
};

export function RuntimeIndicator({ state, size = "sm", label = false }: Props) {
  return (
    <span className={`runtime-indicator runtime-indicator--${size}`}>
      <span className={`runtime-indicator__dot runtime-indicator__dot--${state}`} />
      {label && (
        <span className="runtime-indicator__label">{labels[state]}</span>
      )}
    </span>
  );
}
