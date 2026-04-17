import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import {
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  clampSidePanelWidth,
} from "../../stores/side-panel-store";

const KEYBOARD_STEP = 16;
const CSS_VAR = "--tx-side-panel-width";

type Props = {
  width: number;
  onResize: (width: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  ariaLabel?: string;
};

type DragSession = {
  pointerStart: number;
  startWidth: number;
  lastWidth: number;
};

export function SidePanelResizer({
  width,
  onResize,
  onDraggingChange,
  ariaLabel = "Resize side panel",
}: Props) {
  const sessionRef = useRef<DragSession | null>(null);

  function writeCssVar(value: number) {
    document.documentElement.style.setProperty(CSS_VAR, `${value}px`);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (session) {
      onResize(session.lastWidth);
    }
    sessionRef.current = null;
    onDraggingChange?.(false);
  }

  function adjustByKeyboard(
    event: KeyboardEvent<HTMLDivElement>,
    delta: number | "min" | "max",
  ) {
    event.preventDefault();
    const next =
      delta === "min"
        ? SIDE_PANEL_MIN_WIDTH
        : delta === "max"
          ? SIDE_PANEL_MAX_WIDTH
          : clampSidePanelWidth(width + delta);
    writeCssVar(next);
    onResize(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") return adjustByKeyboard(event, KEYBOARD_STEP);
    if (event.key === "ArrowRight") return adjustByKeyboard(event, -KEYBOARD_STEP);
    if (event.key === "Home") return adjustByKeyboard(event, "max");
    if (event.key === "End") return adjustByKeyboard(event, "min");
  }

  return (
    <div
      className="side-panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={width}
      aria-valuemin={SIDE_PANEL_MIN_WIDTH}
      aria-valuemax={SIDE_PANEL_MAX_WIDTH}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        sessionRef.current = {
          pointerStart: event.clientX,
          startWidth: width,
          lastWidth: width,
        };
        onDraggingChange?.(true);
      }}
      onPointerMove={(event) => {
        const session = sessionRef.current;
        if (!session) return;
        // Dragging the handle to the LEFT should grow the panel (the panel is
        // anchored to the right edge of the window). So we subtract delta.
        const delta = event.clientX - session.pointerStart;
        const next = clampSidePanelWidth(session.startWidth - delta);
        session.lastWidth = next;
        writeCssVar(next);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
