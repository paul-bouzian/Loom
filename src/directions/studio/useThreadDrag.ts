import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import { resolvePaneDrop } from "../../stores/pane-drop-resolver";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useThreadDragStore } from "./useThreadDragStore";

const ACTIVATION_DISTANCE = 8;

type Session = {
  pointerId: number;
  startX: number;
  startY: number;
  activated: boolean;
};

export type ThreadDragHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
};

export function useThreadDrag(
  threadId: string,
  threadTitle: string,
  onClick?: () => void,
): ThreadDragHandlers {
  const sessionRef = useRef<Session | null>(null);
  const suppressClickRef = useRef(false);

  function releaseCapture(event: ReactPointerEvent<HTMLElement>) {
    const element = event.currentTarget;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      activated: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    if (!session.activated) {
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      if (Math.hypot(dx, dy) < ACTIVATION_DISTANCE) return;
      session.activated = true;
      suppressClickRef.current = true;
      useThreadDragStore
        .getState()
        .start(threadId, threadTitle, event.clientX, event.clientY);
    }

    const plan = computeDropPlanAt(event.clientX, event.clientY);
    useThreadDragStore
      .getState()
      .updatePointer(event.clientX, event.clientY, plan);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLElement>) {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    sessionRef.current = null;
    releaseCapture(event);

    if (!session.activated) {
      return;
    }

    const plan = useThreadDragStore.getState().dropPlan;
    useThreadDragStore.getState().end();
    if (plan) {
      useWorkspaceStore.getState().applyDropPlan(plan, threadId);
    }
  }

  function handleClick() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClick?.();
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onClick: handleClick,
  };
}

function computeDropPlanAt(x: number, y: number) {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;
  const container = element.closest<HTMLElement>(
    '[data-drop-zone="container"]',
  );
  if (!container) return null;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const relX = (x - rect.left) / rect.width;
  const relY = (y - rect.top) / rect.height;
  const { slots, rowRatio, colRatio } = useWorkspaceStore.getState().layout;
  return resolvePaneDrop(slots, rowRatio, colRatio, relX, relY);
}
