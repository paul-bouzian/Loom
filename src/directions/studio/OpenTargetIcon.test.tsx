import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OpenTarget } from "../../lib/types";
import { OpenTargetIcon } from "./OpenTargetIcon";

describe("OpenTargetIcon", () => {
  it("uses the bundled Finder icon only for Finder-labelled file managers", () => {
    const finderTarget: OpenTarget = {
      id: "file-manager",
      label: "Finder",
      kind: "fileManager",
      appName: null,
    };
    const genericTarget: OpenTarget = {
      id: "file-manager",
      label: "File Manager",
      kind: "fileManager",
      appName: null,
    };

    const finderRender = render(<OpenTargetIcon target={finderTarget} />);
    expect(finderRender.container.querySelector("img")).not.toBeNull();
    finderRender.unmount();

    const genericRender = render(<OpenTargetIcon target={genericTarget} />);
    expect(genericRender.container.querySelector("img")).toBeNull();
    expect(genericRender.container.querySelector("svg")).not.toBeNull();
  });
});
