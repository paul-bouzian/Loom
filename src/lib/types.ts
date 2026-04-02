/* ── Enums (match Rust serde output) ── */

export type EnvironmentKind = "local" | "managedWorktree" | "permanentWorktree";
export type ThreadStatus = "active" | "archived";
export type RuntimeState = "running" | "stopped" | "exited";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type CollaborationMode = "build" | "plan";
export type ApprovalPolicy = "askToEdit" | "fullAccess";

/* ── Domain records ── */

export type ThreadOverrides = {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  collaborationMode?: CollaborationMode;
  approvalPolicy?: ApprovalPolicy;
};

export type RuntimeStatusSnapshot = {
  environmentId: string;
  state: RuntimeState;
  pid?: number;
  binaryPath?: string;
  startedAt?: string;
  lastExitCode?: number;
};

export type ThreadRecord = {
  id: string;
  environmentId: string;
  title: string;
  status: ThreadStatus;
  codexThreadId?: string;
  overrides: ThreadOverrides;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type EnvironmentRecord = {
  id: string;
  projectId: string;
  name: string;
  kind: EnvironmentKind;
  path: string;
  gitBranch?: string;
  baseBranch?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  threads: ThreadRecord[];
  runtime: RuntimeStatusSnapshot;
};

export type ProjectRecord = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
  environments: EnvironmentRecord[];
};

export type GlobalSettings = {
  defaultModel: string;
  defaultReasoningEffort: ReasoningEffort;
  defaultCollaborationMode: CollaborationMode;
  defaultApprovalPolicy: ApprovalPolicy;
  codexBinaryPath?: string;
};

export type WorkspaceSnapshot = {
  settings: GlobalSettings;
  projects: ProjectRecord[];
};

/* ── Bootstrap ── */

export type BootstrapStatus = {
  appName: string;
  appVersion: string;
  backend: string;
  platform: string;
  appDataDir: string;
  databasePath: string;
  projectCount: number;
  environmentCount: number;
  threadCount: number;
};

/* ── Command requests ── */

export type AddProjectRequest = {
  path: string;
  name?: string;
};

export type RenameProjectRequest = {
  projectId: string;
  name: string;
};

export type CreateWorktreeRequest = {
  projectId: string;
  name: string;
  branchName?: string;
  baseBranch?: string;
  permanent: boolean;
};

export type CreateThreadRequest = {
  environmentId: string;
  title?: string;
  overrides?: ThreadOverrides;
};

export type RenameThreadRequest = {
  threadId: string;
  title: string;
};

export type ArchiveThreadRequest = {
  threadId: string;
};

export type GlobalSettingsPatch = {
  defaultModel?: string;
  defaultReasoningEffort?: ReasoningEffort;
  defaultCollaborationMode?: CollaborationMode;
  defaultApprovalPolicy?: ApprovalPolicy;
  codexBinaryPath?: string | null;
};
