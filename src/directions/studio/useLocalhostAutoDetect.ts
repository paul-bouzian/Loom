import { useEffect } from "react";

import { subscribeToTerminalOutput } from "../../lib/terminal-output-bus";
import { scanForLocalhostUrls } from "../../lib/localhost-detector";
import { useBrowserStore } from "../../stores/browser-store";
import { useTerminalStore } from "../../stores/terminal-store";

function selectPtyIdsKey(state: ReturnType<typeof useTerminalStore.getState>) {
  const ids: string[] = [];
  for (const slot of Object.values(state.byEnv)) {
    for (const tab of slot.tabs) {
      ids.push(tab.ptyId);
    }
  }
  ids.sort();
  return ids.join("\u0000");
}

// Subscribes to every live PTY (across all environments) and pushes any
// localhost URL that appears in the terminal output to the browser store's
// detectedUrls list. Designed to run for the whole studio lifetime so URLs
// appear as suggestions even before the user opens the browser panel.
export function useLocalhostAutoDetect() {
  const ptyIdsKey = useTerminalStore(selectPtyIdsKey);

  useEffect(() => {
    if (!ptyIdsKey) return;
    const ptyIds = ptyIdsKey.split("\u0000").filter(Boolean);
    const decoder = new TextDecoder();
    const reportDetectedUrl = useBrowserStore.getState().reportDetectedUrl;
    const tails = new Map<string, string>();

    const unsubs = ptyIds.map((ptyId) =>
      subscribeToTerminalOutput(ptyId, (bytes) => {
        const previous = tails.get(ptyId) ?? "";
        const chunk = previous + decoder.decode(bytes, { stream: true });
        const { urls, remainder } = scanForLocalhostUrls(chunk);
        tails.set(ptyId, remainder);
        for (const url of urls) {
          reportDetectedUrl(url);
        }
      }),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [ptyIdsKey]);
}
