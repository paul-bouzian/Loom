import { useRef, type PointerEvent } from "react";

import {
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
} from "../../stores/workspace-store";

type Props = {
  orientation: "row" | "column";
  onCommit: (ratio: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
};

type DragSession = {
  pointerStart: number;
  startRatio: number;
  containerSize: number;
  grid: HTMLElement | null;
  varName: "--studio-row-ratio" | "--studio-col-ratio";
  lastRatio: number;
};

export function PaneSplitter({
  orientation,
  onCommit,
  onDraggingChange,
}: Props) {
  const sessionRef = useRef<DragSession | null>(null);
  const isRow = orientation === "row";

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (session) onCommit(session.lastRatio);
    sessionRef.current = null;
    onDraggingChange?.(false);
  }

  return (
    <div
      className={
        "studio-main__pane-splitter" +
        (isRow
          ? " studio-main__pane-splitter--row"
          : " studio-main__pane-splitter--column")
      }
      role="separator"
      aria-orientation={isRow ? "vertical" : "horizontal"}
      aria-label="Resize split"
      onPointerDown={(event) => {
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const container = handle.parentElement;
        const rect = container?.getBoundingClientRect();
        const containerSize = rect ? (isRow ? rect.width : rect.height) : 0;
        const grid = handle.closest<HTMLElement>(".studio-main__grid");
        const varName = isRow ? "--studio-col-ratio" : "--studio-row-ratio";
        const startRatio = readCssRatio(grid, varName);
        sessionRef.current = {
          pointerStart: isRow ? event.clientX : event.clientY,
          startRatio,
          containerSize,
          grid,
          varName,
          lastRatio: startRatio,
        };
        onDraggingChange?.(true);
      }}
      onPointerMove={(event) => {
        const session = sessionRef.current;
        if (!session || session.containerSize === 0) return;
        const pointer = isRow ? event.clientX : event.clientY;
        const delta = (pointer - session.pointerStart) / session.containerSize;
        const next = Math.min(
          SPLIT_RATIO_MAX,
          Math.max(SPLIT_RATIO_MIN, session.startRatio + delta),
        );
        session.lastRatio = next;
        // Write the CSS variable directly — no React re-render needed; the
        // flex-basis `calc(var(...) * 100%)` picks up the new value at paint.
        session.grid?.style.setProperty(session.varName, String(next));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

function readCssRatio(
  grid: HTMLElement | null,
  varName: "--studio-row-ratio" | "--studio-col-ratio",
): number {
  if (!grid) return 0.5;
  const raw = getComputedStyle(grid).getPropertyValue(varName).trim();
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) {
    return parsed;
  }
  return 0.5;
}
