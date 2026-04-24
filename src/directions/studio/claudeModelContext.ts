import type { ModelOption, ProviderKind } from "../../lib/types";

const CLAUDE_ONE_MILLION_SUFFIX = "[1m]";
const CLAUDE_DEFAULT_CONTEXT_TOKENS = 200_000;
const CLAUDE_ONE_MILLION_CONTEXT_TOKENS = 1_000_000;

export function claudeBaseModelId(modelId: string): string {
  return modelId.endsWith(CLAUDE_ONE_MILLION_SUFFIX)
    ? modelId.slice(0, -CLAUDE_ONE_MILLION_SUFFIX.length)
    : modelId;
}

export function claudeUsesOneMillionContext(modelId: string): boolean {
  return modelId.endsWith(CLAUDE_ONE_MILLION_SUFFIX);
}

export function claudeOneMillionModelId(modelId: string): string {
  return `${claudeBaseModelId(modelId)}${CLAUDE_ONE_MILLION_SUFFIX}`;
}

export function claudeModelSupportsOneMillionContext(
  modelId: string,
  models: ModelOption[],
): boolean {
  const oneMillionId = claudeOneMillionModelId(modelId);
  return models.some(
    (model) =>
      (model.provider ?? "codex") === "claude" && model.id === oneMillionId,
  );
}

export function claudeModelContextTokens(
  provider: ProviderKind,
  modelId: string,
): number | null {
  if (provider !== "claude") return null;
  return claudeUsesOneMillionContext(modelId)
    ? CLAUDE_ONE_MILLION_CONTEXT_TOKENS
    : CLAUDE_DEFAULT_CONTEXT_TOKENS;
}

export function stripClaudeContextSuffix(label: string): string {
  return label.replace(/\s+1M$/i, "");
}

export function stripClaudeModelLabelPrefix(label: string): string {
  return label.replace(/^Claude\s+/i, "");
}

export function claudeModelPickerLabel(label: string): string {
  return stripClaudeModelLabelPrefix(stripClaudeContextSuffix(label));
}

export function resolveClaudeModelForContext(
  modelId: string,
  useOneMillionContext: boolean,
  models: ModelOption[],
): string {
  const baseModelId = claudeBaseModelId(modelId);
  const targetModelId = useOneMillionContext
    ? claudeOneMillionModelId(baseModelId)
    : baseModelId;
  const targetExists = models.some(
    (model) =>
      (model.provider ?? "codex") === "claude" && model.id === targetModelId,
  );
  if (targetExists) return targetModelId;
  const baseExists = models.some(
    (model) =>
      (model.provider ?? "codex") === "claude" && model.id === baseModelId,
  );
  return baseExists ? baseModelId : modelId;
}

export function resolveClaudeModelForSelection(
  selectedModelId: string,
  currentModelId: string,
  models: ModelOption[],
): string {
  return resolveClaudeModelForContext(
    selectedModelId,
    claudeUsesOneMillionContext(currentModelId),
    models,
  );
}
