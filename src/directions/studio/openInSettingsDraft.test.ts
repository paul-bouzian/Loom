import { describe, expect, it } from "vitest";

import type { OpenTarget } from "../../lib/types";
import {
  buildDraftState,
  matchesPersistedTargets,
  moveDraftTarget,
  persistDraftTargets,
} from "./openInSettingsDraft";

const TARGETS: OpenTarget[] = [
  {
    id: "cursor",
    label: "Cursor",
    kind: "app",
    appName: "Cursor",
  },
  {
    id: "zed",
    label: "Zed",
    kind: "app",
    appName: "Zed",
  },
  {
    id: "file-manager",
    label: "Finder",
    kind: "fileManager",
    appName: null,
  },
];

describe("openInSettingsDraft", () => {
  it("persists reordered targets with the selected default", () => {
    const initialState = buildDraftState(TARGETS, "file-manager");
    const movedTargets = moveDraftTarget(
      initialState.targets,
      initialState.targets[0]!.draftKey,
      1,
    );

    expect(
      persistDraftTargets({
        targets: movedTargets,
        defaultDraftKey: movedTargets[1]!.draftKey,
      }),
    ).toEqual({
      openTargets: [TARGETS[1], TARGETS[0], TARGETS[2]],
      defaultOpenTargetId: "cursor",
    });
  });

  it("treats equivalent ordered targets as unchanged", () => {
    const draftState = buildDraftState(TARGETS.map((target) => ({ ...target })), "file-manager");

    expect(
      matchesPersistedTargets(
        draftState.targets,
        draftState.defaultDraftKey,
        TARGETS,
        "file-manager",
      ),
    ).toBe(true);
  });
});
