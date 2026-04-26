import { describe, expect, it } from "vitest";

import { allowClaudeTool } from "./claude-agent-permissions";

describe("allowClaudeTool", () => {
  it("returns a concrete updatedInput record for allow decisions", () => {
    const input = { query: "weather Bordeaux tomorrow" };

    expect(allowClaudeTool(input)).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
  });

  it("carries permission updates when Claude provides session suggestions", () => {
    const updatedPermissions = [{
      type: "addRules" as const,
      rules: [{ toolName: "WebSearch" }],
      behavior: "allow" as const,
      destination: "session" as const,
    }];

    expect(allowClaudeTool({ query: "forecast" }, updatedPermissions)).toEqual({
      behavior: "allow",
      updatedInput: { query: "forecast" },
      updatedPermissions,
    });
  });
});
