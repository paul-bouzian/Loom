import { useEffect } from "react";

import {
  codexUsagePercent,
  formatCodexUsageResetLabel,
} from "../../lib/codex-usage";
import type {
  CodexRateLimitSnapshot,
  CodexRateLimitWindow,
  ProviderKind,
  ProviderRateLimitSnapshot,
  ProviderRateLimitWindow,
  WorkspaceSnapshot,
} from "../../lib/types";
import { ReloadIcon } from "../../shared/Icons";
import { ProviderLogo } from "../../shared/ProviderLogo";
import { useClaudeUsageStore } from "../../stores/claude-usage-store";
import { useCodexUsageStore } from "../../stores/codex-usage-store";
import {
  selectEffectiveEnvironmentId,
  useWorkspaceStore,
} from "../../stores/workspace-store";
import "./StatusUsageBar.css";

const PROVIDER_USAGE_REFRESH_MS = 5 * 60 * 1000;

type CompactProviderUsage = {
  provider: ProviderKind;
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
  status: "idle" | "loading" | "ok" | "error" | "unavailable";
  error: string | null;
};

type UsageWindow = {
  usedPercent: number | null;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
};

export function StatusUsageBar() {
  const workspaceSnapshot = useWorkspaceStore((state) => state.snapshot);
  const selectedEnvironmentId = useWorkspaceStore(selectEffectiveEnvironmentId);
  const codexSnapshot = useCodexUsageStore((state) => state.snapshot);
  const codexLoading = useCodexUsageStore((state) => state.loading);
  const codexError = useCodexUsageStore((state) => state.error);
  const ensureCodexUsage = useCodexUsageStore((state) => state.ensureAccountUsage);
  const refreshCodexUsage = useCodexUsageStore((state) => state.refreshAccountUsage);
  const claudeSnapshot = useClaudeUsageStore((state) => state.snapshot);
  const claudeLoading = useClaudeUsageStore((state) => state.loading);
  const claudeError = useClaudeUsageStore((state) => state.error);
  const ensureClaudeUsage = useClaudeUsageStore((state) => state.ensureClaudeUsage);
  const refreshClaudeUsage = useClaudeUsageStore((state) => state.refreshClaudeUsage);
  const sourceEnvironmentId = resolveUsageSourceEnvironmentId(
    workspaceSnapshot,
    selectedEnvironmentId,
  );

  useEffect(() => {
    void ensureCodexUsage(sourceEnvironmentId);
  }, [ensureCodexUsage, sourceEnvironmentId]);

  useEffect(() => {
    void ensureClaudeUsage();
    const refreshInterval = window.setInterval(() => {
      void ensureClaudeUsage();
    }, PROVIDER_USAGE_REFRESH_MS);

    return () => window.clearInterval(refreshInterval);
  }, [ensureClaudeUsage]);

  const codexUsage = mapCodexUsage(
    codexSnapshot,
    codexLoading,
    codexError,
    sourceEnvironmentId !== null,
  );
  const claudeUsage = mapClaudeUsage(claudeSnapshot, claudeLoading, claudeError);
  const refreshDisabled = claudeLoading || codexLoading;

  return (
    <div className="status-usage" aria-label="Provider usage">
      <ProviderUsageSegment usage={claudeUsage} />
      <ProviderUsageSegment usage={codexUsage} />
      <button
        type="button"
        className="status-usage__refresh"
        title="Refresh usage"
        aria-label="Refresh provider usage"
        disabled={refreshDisabled}
        onClick={() => {
          void refreshClaudeUsage({ silent: claudeSnapshot !== null });
          if (sourceEnvironmentId) {
            void refreshCodexUsage(sourceEnvironmentId, {
              silent: codexSnapshot !== null,
            });
          }
        }}
      >
        <ReloadIcon size={11} />
      </button>
    </div>
  );
}

function ProviderUsageSegment({ usage }: { usage: CompactProviderUsage }) {
  const title = usageTitle(usage);
  if (usage.status === "idle" || (usage.status === "loading" && !usage.primary)) {
    return (
      <span className="status-usage__provider" title={title}>
        <ProviderLogo provider={usage.provider} size={14} decorative />
        <span className="status-usage__loading" aria-hidden="true">
          ...
        </span>
      </span>
    );
  }

  if (usage.status === "unavailable" && !usage.primary && !usage.secondary) {
    return (
      <span
        className="status-usage__provider status-usage__provider--muted"
        title={title}
      >
        <ProviderLogo provider={usage.provider} size={14} decorative />
        <span className="status-usage__empty">--</span>
      </span>
    );
  }

  return (
    <span className="status-usage__provider" title={title}>
      <ProviderLogo provider={usage.provider} size={14} decorative />
      {usage.primary ? <MiniUsageBar window={usage.primary} /> : null}
      {usage.primary ? (
        <UsageWindowLabel window={usage.primary} label="5h" />
      ) : null}
      {usage.primary && usage.secondary ? (
        <span className="status-usage__separator" aria-hidden="true">
          ·
        </span>
      ) : null}
      {usage.secondary ? (
        <UsageWindowLabel window={usage.secondary} label="wk" />
      ) : null}
      {usage.status === "error" ? (
        <span className="status-usage__warning" aria-hidden="true">
          !
        </span>
      ) : null}
    </span>
  );
}

function MiniUsageBar({ window }: { window: UsageWindow }) {
  const remainingPercent = usageRemainingPercent(window);
  return (
    <span className="status-usage__bar" aria-hidden="true">
      <span
        className="status-usage__fill"
        style={{ width: `${remainingPercent ?? 0}%` }}
      />
    </span>
  );
}

function UsageWindowLabel({
  window,
  label,
}: {
  window: UsageWindow;
  label: "5h" | "wk";
}) {
  const remainingPercent = usageRemainingPercent(window);
  return (
    <span className="status-usage__label">
      {remainingPercent === null ? "--" : `${remainingPercent}%`} {label}
    </span>
  );
}

function mapCodexUsage(
  snapshot: CodexRateLimitSnapshot | null,
  loading: boolean,
  error: string | null,
  hasSourceEnvironment: boolean,
): CompactProviderUsage {
  return {
    provider: "codex",
    primary: mapCodexWindow(snapshot?.primary),
    secondary: mapCodexWindow(snapshot?.secondary),
    status: snapshot
      ? error
        ? "error"
        : "ok"
      : loading
        ? "loading"
        : hasSourceEnvironment
          ? "idle"
          : "unavailable",
    error,
  };
}

function mapClaudeUsage(
  snapshot: ProviderRateLimitSnapshot | null,
  loading: boolean,
  error: string | null,
): CompactProviderUsage {
  return {
    provider: "claude",
    primary: mapProviderWindow(snapshot?.primary),
    secondary: mapProviderWindow(snapshot?.secondary),
    status: snapshot
      ? snapshot.status
      : loading
        ? "loading"
        : "idle",
    error: error ?? snapshot?.error ?? null,
  };
}

function mapCodexWindow(
  window: CodexRateLimitWindow | null | undefined,
): UsageWindow | null {
  if (!window) return null;
  return {
    usedPercent: codexUsagePercent(window),
    resetsAt: window.resetsAt,
    windowDurationMins: window.windowDurationMins,
  };
}

function mapProviderWindow(
  window: ProviderRateLimitWindow | null | undefined,
): UsageWindow | null {
  if (!window) return null;
  return {
    usedPercent: codexUsagePercent(window),
    resetsAt: window.resetsAt,
    windowDurationMins: window.windowDurationMins,
  };
}

function usageRemainingPercent(window: UsageWindow): number | null {
  if (window.usedPercent === null) return null;
  return Math.min(Math.max(Math.round(100 - window.usedPercent), 0), 100);
}

function usageTitle(usage: CompactProviderUsage) {
  const providerLabel = usage.provider === "claude" ? "Claude" : "OpenAI";
  if (usage.error) {
    return `${providerLabel}: ${usage.error}`;
  }
  const resetLabels = [usage.primary, usage.secondary]
    .map((window) => formatCodexUsageResetLabel(window?.resetsAt))
    .filter(Boolean);
  return resetLabels.length > 0
    ? `${providerLabel}: ${resetLabels.join(" · ")}`
    : `${providerLabel} usage`;
}

function resolveUsageSourceEnvironmentId(
  snapshot: WorkspaceSnapshot | null,
  selectedEnvironmentId: string | null,
) {
  if (!snapshot) {
    return null;
  }

  const selectedEnvironment = [
    ...snapshot.projects.flatMap((project) => project.environments),
    ...snapshot.chat.environments,
  ].find((environment) => environment.id === selectedEnvironmentId) ?? null;

  return selectedEnvironment?.id ?? null;
}
