import { createInterface } from "node:readline";
import { readFile, stat } from "node:fs/promises";
import process from "node:process";

import {
  getSessionMessages,
  query,
  type Options,
  type PermissionMode,
  type PermissionResult,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";

type WorkerRequest<T = unknown> = {
  id: number;
  type: "open" | "send";
  payload: T;
};

type WorkerControl = {
  type: "userInputResponse";
  interactionId: string;
  answers: Record<string, string[]>;
} | {
  type: "approvalResponse";
  interactionId: string;
  approved: boolean;
} | {
  type: "interrupt";
  requestId: number;
};

type OpenPayload = {
  providerThreadId: string;
  cwd: string;
};

type SendPayload = {
  providerThreadId?: string | null;
  cwd: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  serviceTier?: "fast" | "flex" | null;
  collaborationMode: "build" | "plan";
  approvalPolicy: "askToEdit" | "fullAccess";
  claudeBinaryPath?: string | null;
  appVersion: string;
  visibleText: string;
  text: string;
  images: ImagePayload[];
};

type ImagePayload =
  | {
      type: "image";
      url: string;
    }
  | {
      type: "localImage";
      path: string;
    };

type SimpleMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type ClaudeEvent =
  | {
      kind: "session";
      providerThreadId: string;
    }
  | {
      kind: "tokenUsage";
      total: TokenUsageBreakdown;
      last: TokenUsageBreakdown;
      modelContextWindow?: number | null;
    }
  | {
      kind: "assistantDelta";
      itemId: string;
      delta: string;
    }
  | {
      kind: "toolStarted";
      itemId: string;
      toolName: string;
      title: string;
      summary?: string;
    }
  | {
      kind: "toolUpdated";
      itemId: string;
      toolName: string;
      title: string;
      summary?: string;
    }
  | {
      kind: "toolOutput";
      itemId: string;
      delta: string;
      isError?: boolean;
    }
  | {
      kind: "toolCompleted";
      itemId: string;
      isError?: boolean;
    }
  | {
      kind: "reasoning";
      itemId: string;
      delta: string;
    }
  | {
      kind: "planReady";
      itemId?: string;
      markdown: string;
    }
  | {
      kind: "userInputRequest";
      interactionId: string;
      itemId: string;
      questions: UserInputQuestion[];
    }
  | {
      kind: "approvalRequest";
      interactionId: string;
      itemId: string;
      toolName: string;
      title: string;
      summary?: string;
      command?: string;
      reason?: string;
    };

type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
};

type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

type InFlightTool = {
  itemId: string;
  toolName: string;
  title: string;
  summary?: string;
  partialInputJson: string;
  lastInputFingerprint?: string;
};

type ActiveQuery = {
  abortController: AbortController;
  interrupted: boolean;
  planMarkdown: string | null;
};

type ImageContentBlock = {
  block: ContentBlockParam;
  localByteSize: number;
};

type ReadMessagesResult = {
  messages: SimpleMessage[];
  fallbackUsed: boolean;
};

type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

const pendingUserInputs = new Map<
  string,
  (answers: Record<string, string[]>) => void
>();
const pendingApprovals = new Map<string, (approved: boolean) => void>();
const activeQueries = new Map<number, ActiveQuery>();
const MAX_LOCAL_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_LOCAL_IMAGE_BYTES = 50 * 1024 * 1024;

function write(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeEvent(id: number, event: ClaudeEvent) {
  write({ type: "event", id, event });
}

function writeResponse(id: number, result: unknown) {
  write({ type: "response", id, ok: true, result });
}

function writeError(id: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  write({ type: "response", id, ok: false, error: { message } });
}

const READ_ONLY_PLAN_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
]);

const SAFE_BUILD_TOOLS = new Set([
  ...READ_ONLY_PLAN_TOOLS,
]);

function permissionMode(payload: SendPayload): PermissionMode {
  if (payload.collaborationMode === "plan") return "plan";
  if (payload.approvalPolicy === "fullAccess") return "bypassPermissions";
  return "default";
}

function optionsFor(
  payload: SendPayload,
  requestId: number,
  abortController: AbortController,
): Options {
  const mode = permissionMode(payload);
  return {
    abortController,
    cwd: payload.cwd,
    model: payload.model,
    resume: payload.providerThreadId?.trim() || undefined,
    permissionMode: mode,
    allowDangerouslySkipPermissions: mode === "bypassPermissions" ? true : undefined,
    pathToClaudeCodeExecutable: payload.claudeBinaryPath?.trim() || undefined,
    effort: payload.effort,
    thinking: { type: "adaptive" },
    systemPrompt: { type: "preset", preset: "claude_code" },
    tools: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],
    settings:
      payload.serviceTier === "fast"
        ? { fastMode: true, fastModePerSessionOptIn: true }
        : undefined,
    canUseTool: (toolName, input, options) =>
      approveToolUse(requestId, payload, toolName, input, options),
    includePartialMessages: false,
    promptSuggestions: false,
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: `skein/${payload.appVersion || "dev"}`,
    },
  };
}

async function approveToolUse(
  requestId: number,
  payload: SendPayload,
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string },
): Promise<PermissionResult> {
  if (toolName === "AskUserQuestion") {
    return askUserQuestion(requestId, input, options);
  }
  if (toolName === "ExitPlanMode") {
    const plan = extractPlanFromInput(input);
    if (plan) {
      emitPlanReady(requestId, activeQueries.get(requestId), options.toolUseID, plan);
    }
    return {
      behavior: "deny",
      message:
        "Skein captured this proposed plan. Stop here and wait for the user's approval or refinement.",
    };
  }
  if (READ_ONLY_PLAN_TOOLS.has(toolName)) {
    return { behavior: "allow" as const };
  }
  if (payload.collaborationMode === "plan") {
    return {
      behavior: "deny",
      message:
        "Skein plan mode allows read-only tools only. Use Read, Glob, Grep, LS, WebFetch, WebSearch, TodoWrite, or ExitPlanMode instead of write or shell tools.",
    };
  }
  if (payload.approvalPolicy === "fullAccess") {
    return { behavior: "allow", updatedInput: input };
  }
  if (SAFE_BUILD_TOOLS.has(toolName)) {
    return { behavior: "allow" as const };
  }
  return requestToolApproval(requestId, toolName, input, options);
}

async function requestToolApproval(
  requestId: number,
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string },
): Promise<PermissionResult> {
  const interactionId = `claude-approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeEvent(requestId, {
    kind: "approvalRequest",
    interactionId,
    itemId: options.toolUseID,
    toolName,
    title: approvalTitleForTool(toolName),
    summary: summarizeTool(toolName, input),
    command: toolName === "Bash" ? stringFromUnknown(input.command) : undefined,
    reason: "Claude wants to use this tool.",
  });
  const approved = await new Promise<boolean>((resolve) => {
    const cleanup = () => pendingApprovals.delete(interactionId);
    const onAbort = () => {
      cleanup();
      resolve(false);
    };
    pendingApprovals.set(interactionId, (value) => {
      options.signal.removeEventListener("abort", onAbort);
      cleanup();
      resolve(value);
    });
    options.signal.addEventListener("abort", onAbort, { once: true });
  });
  if (!approved) {
    return {
      behavior: "deny",
      message: `The user declined ${toolName}.`,
    };
  }
  return { behavior: "allow", updatedInput: input };
}

async function askUserQuestion(
  requestId: number,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string },
): Promise<PermissionResult> {
  const interactionId = `claude-input-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const questions = parseAskUserQuestions(input);
  writeEvent(requestId, {
    kind: "userInputRequest",
    interactionId,
    itemId: options.toolUseID,
    questions,
  });

  const answers = await new Promise<Record<string, string[]>>((resolve) => {
    const cleanup = () => pendingUserInputs.delete(interactionId);
    const onAbort = () => {
      cleanup();
      resolve({});
    };
    pendingUserInputs.set(interactionId, (value) => {
      options.signal.removeEventListener("abort", onAbort);
      cleanup();
      resolve(value);
    });
    options.signal.addEventListener("abort", onAbort, { once: true });
  });

  if (Object.keys(answers).length === 0) {
    return { behavior: "deny", message: "The user did not answer the question." };
  }

  return {
    behavior: "allow",
    updatedInput: {
      ...input,
      answers: flattenAnswersForClaude(questions, answers),
    },
  };
}

function parseAskUserQuestions(input: Record<string, unknown>): UserInputQuestion[] {
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  const usedIds = new Set<string>();
  return rawQuestions.map((value, index) => {
    const question = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const header = stringFromUnknown(question.header) || `Question ${index + 1}`;
    const questionText = stringFromUnknown(question.question);
    const id = uniqueFieldKey(
      stringFromUnknown(question.id) || questionText || header,
      `question-${index + 1}`,
      usedIds,
    );
    const options = Array.isArray(question.options)
      ? question.options.map((option) => {
          const entry = option && typeof option === "object" ? option as Record<string, unknown> : {};
          return {
            label: stringFromUnknown(entry.label),
            description: stringFromUnknown(entry.description),
          };
        }).filter((option) => option.label)
      : [];
    return {
      id,
      header,
      question: questionText,
      options,
    };
  });
}

function flattenAnswersForClaude(
  questions: UserInputQuestion[],
  answers: Record<string, string[]>,
) {
  const flattened: Record<string, string> = {};
  const usedKeys = new Set<string>();
  for (const question of questions) {
    const selected =
      answers[question.id] ??
      answers[question.question] ??
      answers[question.header] ??
      [];
    const key = uniqueFieldKey(question.id || question.question || question.header, question.id, usedKeys);
    flattened[key] = selected.filter((value) => value.trim()).join(", ");
  }
  return flattened;
}

function uniqueFieldKey(candidate: string, fallback: string, used: Set<string>) {
  const base = (candidate || fallback).trim() || fallback;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  const unique = `${base}-${index}`;
  used.add(unique);
  return unique;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : "";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string") {
      parts.push(entry.text);
    }
  }
  return parts.join("\n\n");
}

function planFromContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const entry = block as Record<string, unknown>;
    if (entry.type !== "tool_use" || entry.name !== "ExitPlanMode") continue;
    const input = entry.input;
    if (!input || typeof input !== "object") continue;
    const plan = (input as Record<string, unknown>).plan;
    if (typeof plan === "string" && plan.trim()) return plan;
  }
  return null;
}

function extractPlanFromInput(input: Record<string, unknown>): string | null {
  const plan = input.plan;
  return typeof plan === "string" && plan.trim() ? plan.trim() : null;
}

function messageToSimple(message: {
  type: string;
  uuid?: string;
  message?: unknown;
}): SimpleMessage | null {
  if (message.type !== "user" && message.type !== "assistant") return null;
  const payload =
    message.message && typeof message.message === "object"
      ? (message.message as { content?: unknown })
      : undefined;
  const text = textFromContent(payload?.content).trim();
  if (!text) return null;
  return {
    id: message.uuid ?? `claude-message-${Date.now()}`,
    role: message.type,
    text,
  };
}

function summarizeTool(toolName: string, input: Record<string, unknown>) {
  const readPath = stringFromUnknown(input.file_path) || stringFromUnknown(input.path);
  switch (toolName) {
    case "Bash":
      return stringFromUnknown(input.description) || stringFromUnknown(input.command);
    case "Read":
    case "Edit":
    case "MultiEdit":
    case "Write":
      return readPath;
    case "Grep":
      return [stringFromUnknown(input.pattern), stringFromUnknown(input.path)]
        .filter(Boolean)
        .join(" in ");
    case "Glob":
      return [stringFromUnknown(input.pattern), stringFromUnknown(input.path)]
        .filter(Boolean)
        .join(" in ");
    case "LS":
      return readPath;
    case "WebSearch":
      return stringFromUnknown(input.query);
    case "WebFetch":
      return stringFromUnknown(input.url);
    case "TodoWrite":
      return "Task list";
    case "AskUserQuestion":
      return "User question";
    case "ExitPlanMode":
      return "Proposed plan";
    default:
      return readPath || compactJson(input);
  }
}

function titleForTool(toolName: string) {
  switch (toolName) {
    case "Bash":
      return "Command";
    case "Read":
    case "LS":
    case "Glob":
    case "Grep":
      return "Search";
    case "Edit":
    case "MultiEdit":
    case "Write":
      return "File change";
    case "WebSearch":
    case "WebFetch":
      return "Web";
    case "TodoWrite":
      return "Task plan";
    case "AskUserQuestion":
      return "Question";
    case "ExitPlanMode":
      return "Plan";
    default:
      return toolName;
  }
}

function approvalTitleForTool(toolName: string) {
  switch (toolName) {
    case "Bash":
      return "Command approval";
    case "Edit":
    case "MultiEdit":
    case "Write":
      return "File change approval";
    default:
      return "Permission approval";
  }
}

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function toolResultText(block: Record<string, unknown>) {
  return textFromContent(block.content).trim();
}

function processUserToolResults(
  requestId: number,
  message: { message?: unknown },
  toolsById: Map<string, InFlightTool>,
) {
  const payload =
    message.message && typeof message.message === "object"
      ? (message.message as { content?: unknown })
      : undefined;
  const content = payload?.content;
  if (!Array.isArray(content)) return;
  for (const entry of content) {
    if (!entry || typeof entry !== "object") continue;
    const block = entry as Record<string, unknown>;
    if (block.type !== "tool_result") continue;
    const toolUseId = stringFromUnknown(block.tool_use_id);
    const tool = toolsById.get(toolUseId);
    if (!tool) continue;
    const output = toolResultText(block);
    const isError = block.is_error === true;
    if (output) {
      writeEvent(requestId, {
        kind: "toolOutput",
        itemId: tool.itemId,
        delta: output,
        isError,
      });
    }
    writeEvent(requestId, {
      kind: "toolCompleted",
      itemId: tool.itemId,
      isError,
    });
    toolsById.delete(toolUseId);
  }
}

function processStreamEvent(
  requestId: number,
  activeQuery: ActiveQuery,
  itemPrefix: string,
  message: { event?: unknown },
  toolsByIndex: Map<number, InFlightTool>,
  toolsById: Map<string, InFlightTool>,
) {
  const event = message.event && typeof message.event === "object"
    ? message.event as Record<string, unknown>
    : null;
  if (!event) return;
  const index = typeof event.index === "number" ? event.index : null;
  if (event.type === "content_block_start") {
    const block = event.content_block && typeof event.content_block === "object"
      ? event.content_block as Record<string, unknown>
      : null;
    if (!block) return;
    if (block.type === "text") {
      const text = stringFromUnknown(block.text);
      if (text) {
        writeEvent(requestId, {
          kind: "assistantDelta",
          itemId: `${itemPrefix}-assistant-${index ?? 0}`,
          delta: text,
        });
      }
      return;
    }
    if (block.type !== "tool_use" && block.type !== "server_tool_use" && block.type !== "mcp_tool_use") {
      return;
    }
    const toolName = stringFromUnknown(block.name) || "Tool";
    const input = block.input && typeof block.input === "object"
      ? block.input as Record<string, unknown>
      : {};
    const itemId = stringFromUnknown(block.id) || `${itemPrefix}-tool-${index ?? 0}`;
    if (toolName === "ExitPlanMode") {
      const plan = extractPlanFromInput(input);
      if (plan) {
        emitPlanReady(requestId, activeQuery, itemId, plan);
      }
      return;
    }
    const tool: InFlightTool = {
      itemId,
      toolName,
      title: titleForTool(toolName),
      summary: summarizeTool(toolName, input),
      partialInputJson: "",
      lastInputFingerprint: Object.keys(input).length ? compactJson(input) : undefined,
    };
    if (index !== null) toolsByIndex.set(index, tool);
    toolsById.set(itemId, tool);
    writeEvent(requestId, {
      kind: "toolStarted",
      itemId,
      toolName,
      title: tool.title,
      summary: tool.summary,
    });
    return;
  }

  if (event.type === "content_block_delta") {
    const delta = event.delta && typeof event.delta === "object"
      ? event.delta as Record<string, unknown>
      : null;
    if (!delta) return;
    if (delta.type === "text_delta") {
      const text = stringFromUnknown(delta.text);
      if (text) {
        writeEvent(requestId, {
          kind: "assistantDelta",
          itemId: `${itemPrefix}-assistant-${index ?? 0}`,
          delta: text,
        });
      }
      return;
    }
    if (delta.type !== "input_json_delta" || index === null) return;
    const tool = toolsByIndex.get(index);
    const partial = stringFromUnknown(delta.partial_json);
    if (!tool || !partial) return;
    tool.partialInputJson += partial;
    const parsed = parsePartialJson(tool.partialInputJson);
    if (!parsed) return;
    const fingerprint = compactJson(parsed);
    if (!fingerprint || fingerprint === tool.lastInputFingerprint) return;
    tool.lastInputFingerprint = fingerprint;
    tool.summary = summarizeTool(tool.toolName, parsed);
    writeEvent(requestId, {
      kind: "toolUpdated",
      itemId: tool.itemId,
      toolName: tool.toolName,
      title: tool.title,
      summary: tool.summary,
    });
  }
}

function parsePartialJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function readMessages(sessionId: string, cwd: string): Promise<SimpleMessage[]> {
  const messages = await getSessionMessages(sessionId, { dir: cwd });
  return messages
    .map((message) => messageToSimple(message))
    .filter((message): message is SimpleMessage => message !== null);
}

async function readMessagesWithFallback(
  sessionId: string,
  cwd: string,
  fallback: SimpleMessage[],
): Promise<ReadMessagesResult> {
  const timeoutMs = 5000;
  try {
    return await Promise.race([
      readMessages(sessionId, cwd).then((messages) => ({
        messages,
        fallbackUsed: false,
      })),
      new Promise<ReadMessagesResult>((resolve) =>
        setTimeout(() => resolve({ messages: fallback, fallbackUsed: true }), timeoutMs),
      ),
    ]);
  } catch {
    return { messages: fallback, fallbackUsed: true };
  }
}

async function promptFor(payload: SendPayload): Promise<string | AsyncIterable<SDKUserMessage>> {
  const images = payload.images ?? [];
  if (images.length === 0) return payload.text;
  const content: ContentBlockParam[] = [{
    type: "text",
    text: payload.text,
  }];
  let remainingLocalImageBytes = MAX_TOTAL_LOCAL_IMAGE_BYTES;
  for (const image of images) {
    const result = await imageToContentBlock(image, remainingLocalImageBytes);
    remainingLocalImageBytes -= result.localByteSize;
    content.push(result.block);
  }
  const message: SDKUserMessage = {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content,
    },
  };
  return (async function* () {
    yield message;
  })();
}

async function imageToContentBlock(
  image: ImagePayload,
  remainingLocalImageBytes: number,
): Promise<ImageContentBlock> {
  if (image.type === "image") {
    return {
      block: {
        type: "image",
        source: {
          type: "url",
          url: image.url,
        },
      },
      localByteSize: 0,
    };
  }
  const file = await stat(image.path);
  if (!file.isFile()) {
    throw new Error("Local image attachment must be a file.");
  }
  if (file.size > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error("Local image attachment exceeds the 25 MiB limit.");
  }
  if (file.size > remainingLocalImageBytes) {
    throw new Error("Local image attachments exceed the 50 MiB total limit.");
  }
  const bytes = await readFile(image.path);
  const mediaType = mediaTypeForBytes(bytes);
  if (!mediaType) {
    throw new Error("Local attachment is not a supported image file.");
  }
  return {
    block: {
      type: "image",
      source: {
        type: "base64",
        data: bytes.toString("base64"),
        media_type: mediaType,
      },
    },
    localByteSize: file.size,
  };
}

function mediaTypeForBytes(bytes: Uint8Array): SupportedImageMediaType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function handleOpen(payload: OpenPayload) {
  const messages = await readMessages(payload.providerThreadId, payload.cwd);
  return {
    providerThreadId: payload.providerThreadId,
    messages,
  };
}

async function handleSend(requestId: number, payload: SendPayload) {
  let providerThreadId = payload.providerThreadId?.trim() || null;
  let resultError: string | null = null;
  let resultUsage: unknown = null;
  let resultModelUsage: unknown = null;
  const activeQuery: ActiveQuery = {
    abortController: new AbortController(),
    interrupted: false,
    planMarkdown: null,
  };
  const itemPrefix = `claude-turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const toolsByIndex = new Map<number, InFlightTool>();
  const toolsById = new Map<string, InFlightTool>();
  const streamedMessages: SimpleMessage[] = [
    {
      id: `local-user-${Date.now()}`,
      role: "user",
      text: payload.visibleText,
    },
  ];
  activeQueries.set(requestId, activeQuery);

  let conversation: ReturnType<typeof query> | null = null;
  try {
    conversation = query({
      prompt: await promptFor(payload),
      options: optionsFor(payload, requestId, activeQuery.abortController),
    });

    for await (const message of conversation) {
      const sessionId = "session_id" in message ? message.session_id : null;
      if (typeof sessionId === "string" && sessionId) {
        providerThreadId = sessionId;
        writeEvent(requestId, { kind: "session", providerThreadId });
      }
      if (message.type === "stream_event") {
        processStreamEvent(
          requestId,
          activeQuery,
          itemPrefix,
          message,
          toolsByIndex,
          toolsById,
        );
      }
      if (message.type === "user") {
        processUserToolResults(requestId, message, toolsById);
      }
      if (message.type === "assistant") {
        const discoveredPlan = planFromContent(message.message.content);
        if (discoveredPlan) {
          emitPlanReady(requestId, activeQuery, undefined, discoveredPlan);
        }
        const simple = messageToSimple(message);
        if (simple) streamedMessages.push(simple);
      }
      if (message.type === "tool_use_summary") {
        writeEvent(requestId, {
          kind: "reasoning",
          itemId: message.uuid ?? `summary-${Date.now()}`,
          delta: message.summary,
        });
      }
      if (message.type === "result" && message.is_error) {
        resultError =
          "errors" in message && Array.isArray(message.errors)
            ? message.errors.join("\n")
            : message.stop_reason ?? "Claude failed to complete the turn.";
      }
      if (message.type === "result") {
        resultUsage = "usage" in message ? message.usage : null;
        resultModelUsage = "modelUsage" in message ? message.modelUsage : null;
      }
    }
  } catch (error) {
    if (activeQuery.interrupted) {
      throw new Error("Claude turn was interrupted.");
    }
    throw error;
  } finally {
    activeQueries.delete(requestId);
    if (activeQuery.interrupted) {
      conversation?.close();
    }
  }

  if (resultError) {
    throw new Error(resultError);
  }
  if (!providerThreadId) {
    throw new Error("Claude did not return a session id.");
  }

  const tokenUsage = await tokenUsageEventFor(
    conversation,
    payload.model,
    resultUsage,
    resultModelUsage,
  );
  if (tokenUsage) {
    writeEvent(requestId, tokenUsage);
  }

  const messageResult = await readMessagesWithFallback(
    providerThreadId,
    payload.cwd,
    streamedMessages,
  );
  return {
    providerThreadId,
    messages: messageResult.messages,
    messagesAuthoritative: !messageResult.fallbackUsed,
    planMarkdown: activeQuery.planMarkdown,
  };
}

function emitPlanReady(
  requestId: number,
  activeQuery: ActiveQuery | undefined,
  itemId: string | undefined,
  markdown: string,
) {
  const plan = markdown.trim();
  if (!plan || activeQuery?.planMarkdown === plan) {
    return;
  }
  if (activeQuery) {
    activeQuery.planMarkdown = plan;
  }
  writeEvent(requestId, { kind: "planReady", itemId, markdown: plan });
}

async function tokenUsageEventFor(
  conversation: { getContextUsage?: () => Promise<unknown> },
  model: string,
  resultUsage: unknown,
  resultModelUsage: unknown,
): Promise<ClaudeEvent | null> {
  const contextUsage =
    typeof conversation.getContextUsage === "function"
      ? await conversation.getContextUsage().catch(() => null)
      : null;
  const contextBreakdown = tokenUsageBreakdownFromContextUsage(contextUsage);
  const totalBreakdown =
    tokenUsageBreakdownFromUsage(resultUsage) ?? contextBreakdown;
  const lastBreakdown = contextBreakdown ?? totalBreakdown;
  const modelContextWindow =
    numberField(contextUsage, "rawMaxTokens", "raw_max_tokens") ??
    numberField(contextUsage, "maxTokens", "max_tokens") ??
    modelUsageContextWindow(resultModelUsage, model) ??
    claudeContextWindowForModel(model);

  if (!totalBreakdown || !lastBreakdown) {
    return null;
  }

  return {
    kind: "tokenUsage",
    total: totalBreakdown,
    last: lastBreakdown,
    modelContextWindow,
  };
}

function tokenUsageBreakdownFromContextUsage(
  value: unknown,
): TokenUsageBreakdown | null {
  const totalTokens = numberField(value, "totalTokens", "total_tokens");
  if (!totalTokens || totalTokens <= 0) return null;
  return {
    totalTokens,
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function tokenUsageBreakdownFromUsage(value: unknown): TokenUsageBreakdown | null {
  const inputTokens = numberField(value, "input_tokens", "inputTokens") ?? 0;
  const cacheReadInputTokens =
    numberField(value, "cache_read_input_tokens", "cacheReadInputTokens") ?? 0;
  const cacheCreationInputTokens =
    numberField(
      value,
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
    ) ?? 0;
  const outputTokens = numberField(value, "output_tokens", "outputTokens") ?? 0;
  const totalTokens =
    inputTokens + cacheReadInputTokens + cacheCreationInputTokens + outputTokens;
  if (totalTokens <= 0) return null;
  return {
    totalTokens,
    inputTokens,
    cachedInputTokens: cacheReadInputTokens + cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
  };
}

function modelUsageContextWindow(value: unknown, model: string): number | null {
  if (!value || typeof value !== "object") return null;
  const usageByModel = value as Record<string, unknown>;
  const direct = numberField(usageByModel[model], "contextWindow", "context_window");
  if (direct) return direct;
  for (const entry of Object.values(usageByModel)) {
    const contextWindow = numberField(entry, "contextWindow", "context_window");
    if (contextWindow) return contextWindow;
  }
  return null;
}

function claudeContextWindowForModel(model: string): number {
  return model.endsWith("[1m]") ? 1_000_000 : 200_000;
}

function numberField(value: unknown, ...keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

async function handleRequest(request: WorkerRequest) {
  switch (request.type) {
    case "open":
      return handleOpen(request.payload as OpenPayload);
    case "send":
      return handleSend(request.id, request.payload as SendPayload);
    default:
      throw new Error(`Unsupported Claude worker command: ${request.type}`);
  }
}

function handleControl(control: WorkerControl) {
  if (control.type === "interrupt") {
    const active = activeQueries.get(control.requestId);
    if (!active) return;
    active.interrupted = true;
    active.abortController.abort();
    return;
  }
  if (control.type === "userInputResponse") {
    const resolve = pendingUserInputs.get(control.interactionId);
    if (!resolve) return;
    resolve(control.answers ?? {});
    return;
  }
  const resolve = pendingApprovals.get(control.interactionId);
  if (!resolve) return;
  resolve(control.approved);
}

async function main() {
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let message: WorkerRequest | WorkerControl;
    try {
      message = JSON.parse(trimmed) as WorkerRequest | WorkerControl;
    } catch (error) {
      writeError(0, error);
      continue;
    }
    if (
      message.type === "userInputResponse" ||
      message.type === "approvalResponse" ||
      message.type === "interrupt"
    ) {
      handleControl(message);
      continue;
    }
    void handleRequest(message)
      .then((result) => writeResponse(message.id, result))
      .catch((error) => writeError(message.id, error));
  }
}

void main();
