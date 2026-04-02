# ThreadEx Engineering Standards

## Purpose

This document defines the coding and architecture standards for ThreadEx so the app can grow like a real production desktop product instead of a prototype that becomes hard to change.

These standards are based on the official documentation for:

- Tauri v2
- React 19
- Rust and Cargo
- Rust API Guidelines

## Architectural Baseline

### Desktop boundary

- The Tauri core process is the only layer with full operating system access.
- The React frontend is the presentation layer, not the authority layer.
- Business-sensitive logic, filesystem access, Git operations, process supervision, and Codex runtime orchestration belong in Rust unless there is a strong reason not to.
- Frontend-to-backend communication must use explicit typed command contracts.

### Product shape

- Model the app as `Project -> Environment -> Thread`.
- Treat a worktree as an environment, not as a thread.
- Prefer one long-lived Codex runtime per environment over one per thread.
- Make Git state, terminal state, and Codex runtime state environment-scoped.

### Persistence and versioning

- Persisted data is part of the product contract and must be versioned deliberately.
- Settings, projects, environments, and thread metadata must use explicit schema versions.
- Schema migrations must be forward-planned before data is stored in multiple places.
- Do not let UI components invent their own storage formats for the same concept.

## Tauri v2 Standards

### Security and permissions

- Follow least privilege everywhere.
- Do not rely on broad default permissions once real features land.
- Move to explicit capabilities in `src-tauri/capabilities/` and enable only the capabilities actually needed by each window.
- Keep permissions split into small, well-named capability files instead of bloating `tauri.conf.json`.
- Use window labels, not titles, as the security boundary reference.
- Do not enable remote API access unless there is a reviewed product need for it.

### Shell, process, and external execution

- Never expose unrestricted shell execution to the frontend.
- When using Tauri shell/process features, use explicit allowlists and validated arguments.
- Prefer Rust-owned process orchestration for Codex, Git, and terminal sessions.
- If the frontend needs to start a system action, route it through a reviewed Rust command or a tightly scoped plugin permission.
- Any command that can touch the filesystem, spawn processes, or reach the network must be scoped and auditable.

### State ownership

- Global app state belongs in Rust when it coordinates windows, services, or sensitive resources.
- UI-only state belongs in React.
- Shared mutable Rust state must be managed through Tauri state APIs and synchronization primitives deliberately chosen for the access pattern.
- Prefer `std::sync::Mutex` for short synchronous critical sections.
- Use async synchronization only when state must remain locked across `.await` boundaries.

### Tauri command design

- Commands must be small, typed, and domain-oriented.
- Commands must validate inputs at the boundary and fail fast.
- Commands must return structured results, not ad hoc strings.
- Commands must not leak raw system errors directly to the UI without mapping or context.
- Commands must not panic in normal runtime paths.

### Windows and features

- Every new window or privileged webview gets its own capability review.
- Do not expose window creation or high-privilege features from low-privilege windows by default.
- Prefer adding plugins only when the capability is first-class and necessary.
- Each plugin added to the repo should be accompanied by a short justification in the PR or implementation notes.

### Observability

- Prefer `tracing` spans and structured logs over `println!` debugging.
- Long-lived services such as Codex runtime supervision, Git/worktree operations, terminal sessions, and persistence should emit actionable logs with domain context.
- Logs must help answer what failed, in which environment/thread, and whether the failure is safe to retry.

## React Standards

### Rendering model

- Components must stay pure during render.
- Rendering must never mutate preexisting variables, objects, or shared module state.
- Side effects belong in event handlers first, then in Effects only when synchronizing with an external system.
- Keep `React.StrictMode` enabled in development.

### State modeling

- Group related state that changes together.
- Avoid contradictory, redundant, duplicated, or deeply nested state.
- Compute derived values during render instead of mirroring them into state.
- Use local component state by default.
- Lift state only when multiple siblings truly need a shared source of truth.
- Use a store only for app-level UI coordination, never as a shortcut for poor state design.

### Effects

- Do not use Effects to derive render data from props or state.
- Do not use Effects for user actions that can run directly in event handlers.
- Every Effect must synchronize with a real external system: timers, DOM APIs, subscriptions, network, desktop runtime, or persistence.
- Effect dependencies must match the code.
- Never silence dependency warnings to force behavior.
- If dependencies feel wrong, change the code structure, not the dependency list.
- Split unrelated effects instead of combining multiple concerns into one hook.

### Performance and responsiveness

- Keep component trees shallow and responsibilities narrow.
- Extract repeated JSX and mixed responsibilities into dedicated components before the file gets dense.
- Use `startTransition` for non-urgent updates that should not block interaction.
- Use `useDeferredValue` when expensive rendering should lag behind user typing or primary interaction.
- Do not add memoization by reflex.
- Add memoization only after identifying an actual unstable dependency or expensive render path.

### Frontend code organization

- Keep domain state, UI primitives, and feature modules separate.
- Prefer feature folders over dumping all logic into `src/`.
- Keep desktop bridge calls in focused modules instead of scattering `invoke()` across components.
- Create typed frontend adapters for every command boundary.
- Frontend components should consume domain helpers, not know transport details.

## Rust Standards

### Error handling

- Use `Result` for recoverable failures.
- Reserve panics for unrecoverable bugs or impossible invariants.
- Do not use `unwrap` or `expect` in runtime paths unless the invariant is genuinely impossible and documented.
- Add context to system and IO failures so logs are actionable.
- Differentiate between user-facing errors, operational errors, and programmer bugs.

### Module design

- Split code into modules by domain and responsibility as the backend grows.
- Hide implementation details behind small public interfaces.
- Keep command entry points thin and delegate real work to services.
- Move shared contracts and domain types into dedicated modules rather than duplicating request or response shapes.
- Introduce more crates or a Cargo workspace when multiple backend domains need independent compilation, testing, or reuse.

### Concurrency and runtime behavior

- Avoid long blocking work on paths that affect UI responsiveness.
- Use background tasks or dedicated services for long-running process supervision, streaming IO, and filesystem watching.
- Keep lock durations short.
- Never hold a lock while doing unrelated IO if it can be avoided.
- Prefer message passing or task orchestration when shared mutable state becomes complex.

### API design and maintainability

- Favor predictable names, explicit types, and narrow interfaces.
- Keep constructors and factory functions obvious about required inputs.
- Avoid boolean argument ambiguity in public APIs.
- Write code so future crates and modules can integrate without depending on internals.
- Treat the Rust API Guidelines checklist as a review aid for public or reusable Rust modules.

### Code quality gates

- Rust code should stay warning-free under `cargo clippy`.
- Formatting should remain machine-enforced instead of subjective.
- Thin command modules and explicit domain services are preferred over large catch-all files.
- Blocking or privileged code paths need tests earlier than cosmetic UI paths because they define the product's reliability envelope.

## Repository and Scaling Rules

### Package management

- Bun is the JavaScript package manager and script runner for this repository.
- Rust dependencies are managed through Cargo.
- When adding dependencies, prefer stable, maintained packages with clear ecosystem adoption.

### Repository structure

- `src/` is for frontend UI and typed desktop bridge consumers.
- `src-tauri/src/commands/` is for Tauri command entry points only.
- Backend services should move to dedicated Rust modules such as `services/`, `domain/`, `runtime/`, and `git/` as they appear.
- Docs that define project standards should live in `docs/` and stay concise enough to review.

### Validation and CI expectations

- Every meaningful change should pass:
  - `bun run lint`
  - `bun run typecheck`
  - `bun run build`
  - `cargo check --manifest-path src-tauri/Cargo.toml`
- Backend-heavy or cross-boundary changes should also pass:
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- Tauri bundle builds should be used periodically to catch packaging drift, especially after plugin or config changes.

### Benchmark references

These are not the source of truth for correctness, but they are useful implementation references for product behavior and UX framing:

- `Dimillian/CodexMonitor` for native Codex UX and Tauri desktop patterns
- `coollabsio/jean` for project/worktree/session modeling
- `pingdotgg/t3code` for Codex-first session brokering and structured runtime/event handling
- `21st-dev/1code` for broader desktop UX ideas

## Immediate Rules For This Project

- Keep the frontend shell minimal until the runtime and domain model are in place.
- Do not introduce a backend adapter layer that mirrors Codex unnecessarily.
- Do not scrape terminal output for state that Codex app-server already exposes structurally.
- Codex integration should be implemented as a first-class runtime service in Rust.
- Git/worktree operations should live in a dedicated Rust service early, because they are central to the product.
- Settings must have a single source of truth and clear precedence rules: global defaults, then project overrides, then thread-specific overrides where needed.

## Sources

- Tauri Process Model: https://v2.tauri.app/concept/process-model/
- Tauri Capabilities: https://v2.tauri.app/security/capabilities/
- Tauri Permissions: https://v2.tauri.app/security/permissions/
- Tauri Command Scopes: https://v2.tauri.app/security/scope/
- Tauri State Management: https://v2.tauri.app/develop/state-management/
- Tauri Shell Plugin: https://v2.tauri.app/plugin/shell/
- React Keeping Components Pure: https://react.dev/learn/keeping-components-pure
- React Choosing the State Structure: https://react.dev/learn/choosing-the-state-structure
- React You Might Not Need an Effect: https://react.dev/learn/you-might-not-need-an-effect
- React Removing Effect Dependencies: https://react.dev/learn/removing-effect-dependencies
- React useTransition: https://react.dev/reference/react/useTransition
- React useDeferredValue: https://react.dev/reference/react/useDeferredValue
- Rust Packages, Crates, and Modules: https://doc.rust-lang.org/book/ch07-00-managing-growing-projects-with-packages-crates-and-modules.html
- Rust Error Handling: https://doc.rust-lang.org/book/ch09-00-error-handling.html
- Cargo Workspaces: https://doc.rust-lang.org/cargo/reference/workspaces.html
- Rust API Guidelines: https://rust-lang.github.io/api-guidelines/
