import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";

export function allowClaudeTool(
  input: Record<string, unknown>,
  updatedPermissions?: PermissionUpdate[],
): PermissionResult {
  const result: PermissionResult = {
    behavior: "allow",
    updatedInput: normalizePermissionInput(input),
  };
  if (updatedPermissions?.length) {
    result.updatedPermissions = updatedPermissions;
  }
  return result;
}

function normalizePermissionInput(input: Record<string, unknown>): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}
