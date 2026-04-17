import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
} from "../../stores/side-panel-store";
import { SidePanelResizer } from "./SidePanelResizer";

describe("SidePanelResizer", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--tx-side-panel-width");
  });

  function renderAt(width = 420) {
    const onResize = vi.fn();
    const onDraggingChange = vi.fn();
    const utils = render(
      <SidePanelResizer
        width={width}
        onResize={onResize}
        onDraggingChange={onDraggingChange}
      />,
    );
    const handle = utils.container.querySelector(
      ".side-panel-resizer",
    ) as HTMLDivElement;
    return { handle, onResize, onDraggingChange };
  }

  it("renders a separator with aria attributes", () => {
    const { handle } = renderAt(420);
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
    expect(handle.getAttribute("aria-valuemin")).toBe(String(SIDE_PANEL_MIN_WIDTH));
    expect(handle.getAttribute("aria-valuemax")).toBe(String(SIDE_PANEL_MAX_WIDTH));
  });

  it("pointer drag left grows the panel and commits on pointer up", () => {
    const { handle, onResize, onDraggingChange } = renderAt(420);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1000 });
    expect(onDraggingChange).toHaveBeenLastCalledWith(true);

    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 });
    // No commit yet during drag.
    expect(onResize).not.toHaveBeenCalled();
    // CSS var updated.
    expect(
      document.documentElement.style.getPropertyValue("--tx-side-panel-width"),
    ).toBe("520px");

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 900 });
    expect(onResize).toHaveBeenCalledWith(520);
    expect(onDraggingChange).toHaveBeenLastCalledWith(false);
  });

  it("clamps drag to max width", () => {
    const { handle, onResize } = renderAt(500);
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 1000 });
    // Drag far to the left.
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0 });
    expect(onResize).toHaveBeenCalledWith(SIDE_PANEL_MAX_WIDTH);
  });

  it("keyboard ArrowLeft grows panel", () => {
    const { handle, onResize } = renderAt(420);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenCalledWith(436);
  });

  it("keyboard ArrowRight shrinks panel", () => {
    const { handle, onResize } = renderAt(420);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenCalledWith(404);
  });

  it("keyboard Home snaps to max", () => {
    const { handle, onResize } = renderAt(420);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onResize).toHaveBeenCalledWith(SIDE_PANEL_MAX_WIDTH);
  });

  it("keyboard End snaps to min", () => {
    const { handle, onResize } = renderAt(420);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onResize).toHaveBeenCalledWith(SIDE_PANEL_MIN_WIDTH);
  });
});
