import { describe, expect, it } from "vitest";

import { resolveOpenTargetIcon } from "./openTargetIcons";

describe("resolveOpenTargetIcon", () => {
  it("returns the Finder icon only for Finder-labelled file managers", () => {
    const finderIcon = resolveOpenTargetIcon({
      id: "file-manager",
      label: "Finder",
      kind: "fileManager",
      appName: null,
    });
    const genericIcon = resolveOpenTargetIcon({
      id: "file-manager",
      label: "File Manager",
      kind: "fileManager",
      appName: null,
    });

    expect(finderIcon).not.toBeNull();
    expect(genericIcon).toBeNull();
  });
});
