# Provider Integration Map

This document maps the current provider integration points in Skein. Use it before
adding another provider such as Gemini so the new provider connects to the same
canonical product path instead of growing parallel UI or runtime behavior.

Current providers:

| Provider key | Product label | Runtime path | Primary integration |
| --- | --- | --- | --- |
| `codex` | OpenAI | Rust `RuntimeSession` | `codex app-server` JSONL protocol |
| `claude` | Anthropic | Rust `ClaudeRuntimeSession` + Electron worker | `@anthropic-ai/claude-agent-sdk` |

## Canonical Provider Model

Provider identity starts in Rust and is mirrored in TypeScript:

- `ProviderKind` is the canonical enum/string union. Existing values are `codex`
  and `claude`.
- `ConversationComposerSettings` is the single cross-provider composer contract:
  `provider`, `model`, `reasoningEffort`, `collaborationMode`,
  `approvalPolicy`, and `serviceTier`.
- `ModelOption` is the shared model capability shape: provider, model id,
  display name, default reasoning effort, supported reasoning efforts, input
  modalities, supported service tiers, `supportsThinking`, and default marker.
- `ProviderOption` and `EnvironmentCapabilitiesSnapshot` are the UI-facing
  capability bundle used by model pickers, settings, drafts, and validation.
- Thread persistence stores `provider`, `providerThreadId`, `codexThreadId`,
  `overridesJson`, and optional handoff state. `providerThreadId` is the generic
  provider session id; `codexThreadId` is retained for the app-server thread id
  and Codex-specific catalog refresh behavior.

Important anchors:

- `desktop-backend/src/domain/settings.rs`
- `desktop-backend/src/domain/conversation.rs`
- `desktop-backend/src/services/workspace.rs`
- `src/lib/types.ts`

## Capability Mapping

| Surface | OpenAI / `codex` | Anthropic / `claude` | Shared UI contract |
| --- | --- | --- | --- |
| Provider labels | `OpenAI`; assistant messages label as `Codex` | `Anthropic`; assistant messages label as `Claude` | `ProviderLogo`, provider picker, sidebar provider mark, handoff labels |
| Runtime capabilities | Read from `model/list` and `collaborationMode/list` on app-server | Hard-coded Claude capability list in Rust | `EnvironmentCapabilitiesSnapshot` |
| Model list | App-server response, hidden models filtered, fallback default `gpt-5.4` | `claude_model_options()` list, fallback default `claude-sonnet-4-6` | `ModelOption[]` drives pickers, settings, validation |
| Model ordering and fallback UI | `MODEL_ORDER_IDS`, `MODEL_FALLBACK_OPTIONS` | `CLAUDE_MODEL_FALLBACK_IDS`; 1M variants handled specially | `composerOptions.ts`, `ThreadDraftComposer.tsx` bootstrap fallbacks |
| Context window | App-server token usage can include `modelContextWindow` | Claude usage events include `modelContextWindow`; 1M context encoded by `[1m]` model suffix | `ContextWindowMeter`, `ThreadTokenUsageSnapshot` |
| Image input | Validated against app-server model modalities | Claude models advertise text and image support | `inputModalities` controls attach button and backend validation |
| Token usage | `tokenUsage` notifications from app-server | Worker normalizes Claude usage into `tokenUsage` events | `ThreadTokenUsageSnapshot` and compact work activity |
| Usage / rate limits | Environment-scoped Codex account rate limits and live usage event | Claude OAuth usage endpoint via `ProviderUsageService` | `StatusUsageBar` combines separate stores |

## Composer and Defaults

Defaults are resolved from global settings, then thread overrides:

- New threads, chat threads, managed worktrees, and drafts inherit
  `defaultProvider`, `defaultModel`, `defaultReasoningEffort`,
  `defaultCollaborationMode`, `defaultApprovalPolicy`, and
  `defaultServiceTier`.
- `default_model_for_provider()` falls back to `gpt-5.4` for Codex and
  `claude-sonnet-4-6` for Claude when global defaults point at the other
  provider.
- `default_effort_for_provider()` downgrades `max` to `high` for Codex because
  Codex currently rejects `max`; Claude keeps the selected effort.
- Thread composer persistence stores overrides only when the user diverges from
  defaults, including explicit `serviceTier` override state.

Shared UI entry points:

- Global defaults: `GeneralSettingsTab`
- Per-thread composer: `InlineComposer`
- Draft composer bootstrap/fallbacks: `ThreadDraftComposer`
- Store defaults: `draft-threads.ts`

## Reasoning and Thinking

| Surface | OpenAI / `codex` | Anthropic / `claude` |
| --- | --- | --- |
| Reasoning values | `low`, `medium`, `high`, `xhigh`; `max` rejected in settings validation | Per-model support can include `max`; Haiku supports only `low` |
| Runtime payload | Sent inside `collaborationMode.settings.reasoning_effort` to app-server | Sent as `effort` to the Claude worker; worker passes `effort` to SDK |
| Thinking support | `supportsThinking` is false for app-server models today | `supportsThinking` controls SDK `thinking: { type: "adaptive", display: "summarized" }` |
| Picker display | 4 reasoning bars | 5 reasoning bars and optional 1M context section |

The UI must derive available reasoning options from the selected `ModelOption`.
Do not add provider-specific reasoning controls outside `ReasoningContextPicker`
unless the capability shape changes.

## Collaboration Modes and Plans

| Surface | OpenAI / `codex` | Anthropic / `claude` |
| --- | --- | --- |
| Build mode | `CollaborationMode::Build` maps to app-server mode `default` | Worker sends `collaborationMode: "build"` and Claude SDK uses normal tool policy |
| Plan mode | `CollaborationMode::Plan` maps to app-server mode `plan` | Worker uses SDK permission mode `plan`, allows read-only tools and captures `ExitPlanMode` |
| Plan output | App-server plan items normalize to `ProposedPlanSnapshot` | Worker emits `planReady`, Rust converts to `ProposedPlanSnapshot` |
| Plan approval | Hidden message `Plan approved. Begin implementing...`; composer switches to Build | Same approval message; `accept_plan_markdown` disabled for the hidden follow-up |
| Plan refine | Sends user feedback in Plan mode and supersedes prior plan | Same shared UI action, sent through Claude runtime |
| Task progress | App-server task plans normalize from plan items/updates | Claude `TodoWrite` normalizes to `TaskPlanUpdated` |

The UI renders proposed plans through `ConversationPlanCard` and active task
progress through `ConversationActiveTasksPanel`. New providers should emit the
same `ProposedPlanSnapshot` and `ConversationTaskSnapshot` shapes.

## Access, Approvals, and Permissions

Skein exposes one approval policy picker:

| UI access option | OpenAI / `codex` app-server mapping | Anthropic / `claude` SDK mapping |
| --- | --- | --- |
| `askToEdit` | `approvalPolicy: "on-request"`, `approvalsReviewer: "user"`, sandbox `workspaceWrite` | SDK `permissionMode: "default"`; read-only tools are allowed, mutating tools request approval |
| `autoReview` | `approvalPolicy: "on-request"`, `approvalsReviewer: "auto_review"`, sandbox `workspaceWrite` | SDK `permissionMode: "auto"` |
| `fullAccess` | `approvalPolicy: "never"`, `approvalsReviewer: "user"`, sandbox `dangerFullAccess` | SDK `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true` |
| Plan mode override | App-server `collaborationMode: "plan"` | SDK `permissionMode: "plan"` regardless of access option |

OpenAI approval requests arrive as app-server server requests:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`

Claude approval requests are generated by the worker `canUseTool` callback:

- `Bash` becomes `ConversationApprovalKind::CommandExecution`
- `Edit`, `MultiEdit`, and `Write` become `FileChange`
- Other tools become `Permissions`
- `AskUserQuestion` becomes a `PendingUserInputRequest`

Both providers must normalize pending interactions into
`ConversationInteraction` so `ConversationInteractionPanel` can render and
respond without provider-specific UI branches.

## Fast Mode and Service Tier

`ServiceTier` is the shared speed-mode contract. The UI shows `Normal`/`Fast`
from `SPEED_MODE_OPTIONS`.

- Codex forwards supported values as `serviceTier` to `thread/start` and
  `turn/start`. Unsupported fast mode is silently cleared by capability
  validation.
- Claude forwards supported fast mode to the worker, and the worker maps it to
  SDK settings `{ fastMode: true, fastModePerSessionOptIn: true }`.
- Support is per model through `supportedServiceTiers`. The composer disables
  the fast toggle when the selected model does not support `fast`.

New providers should not add a separate speed flag. Populate
`supportedServiceTiers` and map `ServiceTier::Fast` inside the provider runtime.

## Tool Use, Work Activity, and Subagents

All providers must project tool and work events into the shared conversation
items:

- Assistant text: `ConversationMessageItem`
- Reasoning/thinking: `ConversationReasoningItem`
- Tool lifecycle: `ConversationToolItem`
- Task progress: `ConversationTaskSnapshot`
- Background agents: `SubagentThreadSnapshot`

OpenAI source:

- App-server item notifications and deltas are normalized in
  `runtime/protocol.rs`.
- Subagents are detected from app-server thread metadata and thread spawn
  sources.
- A multi-agent nudge can append hidden text to the outgoing user input when the
  setting is enabled.

Claude source:

- Electron worker normalizes SDK stream events in `claude-agent-events.ts`.
- `thinking_delta` becomes reasoning.
- Tool use blocks become tool started/updated/output/completed events.
- `TodoWrite` becomes task progress.
- Subagent tool use becomes `SubagentStarted`/`SubagentCompleted`.

UI rendering:

- Compact work rows render in `ConversationWorkActivityGroup` and show
  `Working for {duration}` while active.
- Expanded active work renders in `ConversationActiveTasksPanel`, including
  `Background agents`.
- Individual item labels still use the snapshot provider, so new providers need
  provider labels before their events are visible.

## Composer Catalogs and Mentions

| Surface | OpenAI / `codex` | Anthropic / `claude` |
| --- | --- | --- |
| Slash commands | `/prompts:name` from `.codex/prompts` | `/command` from `.claude/commands` |
| Skills | Native skill payloads from `.codex/skills` and global skills | `$skill` expands inline from `.claude/skills` |
| Apps/connectors | `$app` mentions become native app mention payloads | No app mentions today |
| Text resolution | `resolve_composer_text()` returns visible text, expanded text, text elements, skills, mentions | `resolve_claude_composer_text()` expands Claude commands and skills into plain text |
| Autocomplete | Codex suggestions include prompts, skills, apps, and file mentions | Claude suggestions include commands and skills |

New providers must decide whether their composer artifacts are native payload
items, text expansions, or unsupported. The UI should continue consuming
`ThreadComposerCatalog` and `ComposerMentionBindingInput`.

## Thread Lifecycle, Persistence, and Handoff

### Provider Lock and Thread Creation

- Provider selection is fixed for an existing thread. `send_thread_message` and
  `submit_plan_decision` reject composer settings whose provider differs from
  the persisted thread provider.
- Changing provider requires `create_thread_handoff`, not editing the existing
  thread in place.
- New threads are created through the workspace path, then opened through
  `open_thread_conversation`. Runtime code receives a `ThreadRuntimeContext`
  containing environment path, provider ids, composer settings, handoff state,
  defaults, and provider-specific binary paths.

### Open, Restore, and Resume

| Surface | OpenAI / `codex` | Anthropic / `claude` | Shared invariant |
| --- | --- | --- | --- |
| Cached open | `RuntimeSession::open_thread` returns a cached snapshot when available and reconciles composer/provider ids | `ClaudeRuntimeSession::open_thread` returns a cached snapshot when available and reconciles composer/provider ids | Reopen should be instant when a live snapshot exists |
| Persisted snapshot fallback | `get_thread_conversation_snapshot` loads `snapshot_store` if no live runtime snapshot exists | Same `snapshot_store` fallback | UI can render recently opened threads without restarting provider runtime |
| Provider resume | If `codexThreadId` exists, app-server `thread/read(includeTurns: true)` reconstructs history, then `thread/resume` binds the environment | If `providerThreadId` exists, the Claude worker `open` call resumes SDK history and returns normalized messages | Provider-owned history is authoritative, then local-only items are merged |
| Empty open | Creates an empty provider snapshot, plus imported handoff items when present | Same | Empty UI state is still provider-specific and has a valid composer |
| Local item merge | Merges persisted local items from `item_store` after app-server history | Merges persisted Claude items and hidden provider markers after SDK history | Local tool/reasoning/system metadata survives provider history reloads |

`snapshot_store` is the durable local conversation projection used for fast
restore and UI continuity. `item_store` persists local metadata that providers
do not reliably preserve, including tool events, reasoning, system messages,
auto-approval reviews, and provider-missing activity. Provider-owned user
messages are not duplicated in `item_store`.

### Send, Save, and Draft Cleanup

- `send_thread_message` validates the provider lock, validates selected model
  and image support, resolves composer text/mentions, applies hidden handoff
  bootstrap context, and starts the provider turn.
- Successful sends persist the generic `providerThreadId` when the provider
  returns a new session id. Codex also persists `codexThreadId` for app-server
  thread reads and catalog behavior.
- Successful sends persist composer settings and clear the thread composer
  draft. Draft-only saves use `save_thread_composer_draft`.
- Failed sends preserve rollback semantics. Claude removes persisted local
  items for the failed turn and marks the snapshot failed. Codex relies on the
  app-server final/error event path and local snapshot reconciliation.
- First-prompt auto rename is provider-sensitive: Claude renames before send;
  Codex renames after provider start so already-started app-server threads do
  not hit startup hazards.
- Handoff bootstrap is completed only after a send or plan decision that does
  not end interrupted or failed.

Claude has one extra persistence rule: hidden provider messages used for plan
approval and handoff bootstrap are tracked by provider message id when possible,
or by message text until the resumed SDK history exposes the id. Those markers
prevent hidden control text from reappearing as visible user messages.

### Refresh, Interrupt, Stop, and Runtime Status

| Surface | OpenAI / `codex` | Anthropic / `claude` |
| --- | --- | --- |
| Explicit runtime start | `start_environment_runtime` starts or reuses the environment-scoped app-server process | Returns a stopped runtime status because Claude is request/worker scoped |
| Explicit runtime stop | `stop_environment_runtime` kills the app-server session, aborts IO tasks, drains pending server requests, and clears runtime maps | No long-lived environment runtime to stop |
| Runtime touch / idle eviction | `touch_environment_runtime` and supervisor idle eviction apply to app-server sessions; pending requests and active work keep them alive | Not applicable except per-turn worker lifetime |
| Archive side effect | Archiving the last active thread can stop the environment runtime | Claude has no environment runtime to stop |
| Refresh | `refresh_thread` asks the open app-server session to refresh/reconcile the snapshot | Returns active snapshot during a turn, otherwise reloads from Claude history |
| Interrupt | Sends app-server `turn/interrupt`, clears active turn/subagents, pending interactions, streaming flags, and emits interrupted status | Sends a worker control `Interrupt`, clears active turn, pending interactions, streaming flags, and persists current turn items |
| Process failure | Supervisor detects exited app-server sessions and marks runtime status exited | Worker failures are scoped to the current open/send call |

Any new provider must declare whether it is an environment-scoped runtime like
Codex or a request-scoped worker like Claude. That decision affects start/stop
buttons, idle eviction, archive cleanup, pending-interaction draining, process
failure reporting, and resume behavior.

### Handoff

- Handoff creates a new thread in the same environment with the target provider,
  imports completed visible messages, and blocks nested handoff until the new
  thread sends one message.
- Sidebar provider marks show single-provider threads and source-to-target
  handoffs.
- Runtime routing happens in `RuntimeSupervisor`: Claude goes to
  `ClaudeRuntimeSession`; Codex goes through the environment-scoped app-server
  `RuntimeSession`.

For a third provider, replace the binary two-way handoff UI assumption with a
provider selection menu or deterministic target selection before enabling
handoff from the UI.

## Provider-Specific Runtime Responsibilities

Every provider runtime must implement the same product responsibilities:

- Open or restore a thread and return `ThreadConversationOpenResponse`.
- Define lifecycle class: environment-scoped runtime, request-scoped worker, or
  another explicit model. Wire start, stop, touch, idle eviction, and archive
  behavior accordingly.
- Validate selected model and image support before starting a turn.
- Resolve the composer text and mention bindings into the provider input shape.
- Apply hidden handoff bootstrap context and multi-agent guidance when relevant.
- Start a turn with model, reasoning, collaboration mode, approval policy, and
  optional service tier.
- Resume provider history from the persisted generic `providerThreadId` and
  merge local-only `snapshot_store`/`item_store` records without duplicating
  provider-owned messages.
- Persist composer settings, clear composer drafts, and persist new provider
  thread ids only after successful provider progress.
- Implement refresh, interrupt, pending approval response, pending user input
  response, plan approval/refine, failed turn rollback, and process failure
  reporting.
- Normalize streaming text, reasoning, tool calls, tool output, task plans,
  subagents, token usage, approvals, user input, errors, interrupts, and final
  status into `ThreadConversationSnapshot`.
- Persist provider thread ids and snapshots through the existing workspace and
  runtime store paths.
- Define composer catalog/file search support. If unsupported, return a typed
  validation error while keeping the shared UI contract.

## Current Binary Branches to Generalize

The current product only has two providers, so several branches are intentionally
binary today. Adding Gemini requires converting these to capability/provider
metadata lookups or explicit three-way matches instead of keeping
`claude ? ... : codex` assumptions.

Frontend display branches:

- `ProviderLogo` chooses Anthropic vs OpenAI artwork.
- `SidebarThreadRow`, `ConversationItemRow`, and `StatusUsageBar` choose
  provider and assistant labels.
- `GeneralSettingsTab`, `ThreadConversation`, `ThreadDraftComposer`,
  `draft-threads`, and `composerOptions` choose default provider/model
  fallbacks and provider-specific model presentation.
- `ReasoningContextPicker`, `ProviderModelPicker`, and `composer-model`
  adjust reasoning bars, 1M context grouping, provider token display, and
  provider-specific autocomplete behavior.
- `ConversationInteractionPanel` has provider-specific interaction wording for
  Claude.

Backend binary branches:

- `workspace.rs` maps provider strings, provider defaults, reasoning defaults,
  thread context, provider thread ids, and handoff state.
- `settings.rs` validates provider-specific default reasoning limits.
- `conversation.rs` controls first-prompt rename timing, provider labels,
  provider lock validation, send persistence, and handoff bootstrap completion.
- `RuntimeSupervisor` routes open/send/refresh/interrupt/approval/user-input/
  plan decisions and provider-specific composer catalog/file search behavior.
- `RuntimeSession` remains Codex-specific despite sharing the runtime namespace;
  additional providers should get a first-class runtime path rather than being
  folded into the Codex app-server session type.

## Gemini Onboarding Checklist

Before implementation:

- Confirm Gemini's first-class agent/runtime integration, model ids, reasoning
  controls, tool approval hooks, plan mode equivalent, fast mode equivalent,
  image support, usage limits, and session resume semantics from current docs.
- Decide the provider key, product label, logo, default model, binary/API
  settings, and auth surface.
- Decide whether Gemini runs as an environment-scoped daemon, a per-turn worker,
  or a managed remote session. This must be settled before UI start/stop status,
  archive cleanup, idle eviction, interrupt, and resume behavior are wired.

Implementation connectors:

- Add `ProviderKind::Gemini` and TS `ProviderKind = "gemini"` with persistence
  mapping in `provider_value()` and `provider_from_str()`.
- Extend `GlobalSettings`, settings patches, advanced settings, defaults, draft
  bootstrap fallbacks, provider picker labels, `ProviderLogo`, assistant labels,
  sidebar labels, status usage labels, and tests.
- Populate `ProviderOption` and `ModelOption` capabilities, including reasoning
  support, `supportsThinking`, input modalities, service tiers, and default
  model.
- Add runtime routing in `RuntimeSupervisor` and implement a Gemini runtime that
  returns the same open/send/refresh/interrupt/approval/user-input/plan-decision
  behavior as Codex and Claude.
- Implement open/restore from live cache, `snapshot_store`, provider history,
  empty provider snapshot, and handoff imported messages.
- Implement provider thread id persistence, resume/read-history semantics,
  local item merge, failed-turn rollback, and successful draft cleanup.
- Wire explicit start/stop/touch/archive semantics if Gemini has a long-lived
  runtime. If it is request-scoped, return a truthful stopped/non-running status
  like Claude instead of faking an environment process.
- Map Skein `CollaborationMode`, `ApprovalPolicy`, `ReasoningEffort`, and
  `ServiceTier` to Gemini-native request parameters.
- Normalize Gemini stream events into the shared conversation snapshot types.
- Implement composer catalog behavior for Gemini commands/skills/apps, or
  explicitly document unsupported catalog sections while keeping the shared UI
  contract intact.
- Add usage/auth/binary settings only through typed bridge commands and provider
  stores; avoid raw frontend provider calls.
- Update handoff target selection so more than two providers are supported.

Required regression coverage:

- Provider defaults and settings validation.
- Model picker, settings picker, reasoning picker, fast toggle, image attach
  enablement, and provider logo/labels.
- Runtime send payload mapping for build, plan, all approval policies, reasoning
  values, and fast mode.
- Plan approval/refine, pending approval, pending user input, task progress,
  reasoning, tool output, subagents, token usage, interrupt, and error handling.
- Thread creation, provider lock, cached open, provider resume, snapshot restore,
  provider thread id persistence, composer draft save/clear, refresh, explicit
  runtime start/stop or request-scoped status, archive cleanup, idle eviction,
  failed-turn rollback, first-prompt auto rename timing, and handoff.
