import { create } from "zustand";

import * as bridge from "../lib/bridge";
import type { FirstPromptRenameFailureEventPayload } from "../lib/types";

type FirstPromptRenameState = {
  latestFailure: FirstPromptRenameFailureEventPayload | null;
  listenerReady: boolean;
  initializeListener: () => Promise<void>;
  dismissLatestFailure: () => void;
};

let unlistenFirstPromptRenameFailures: null | (() => void) = null;
let listenerInitialization: Promise<void> | null = null;
let listenerGeneration = 0;

export const useFirstPromptRenameStore = create<FirstPromptRenameState>(
  (set, get) => ({
    latestFailure: null,
    listenerReady: false,

    initializeListener: async () => {
      if (get().listenerReady) return;
      if (listenerInitialization) {
        await listenerInitialization;
        return;
      }

      const generation = listenerGeneration;
      const initialization = bridge
        .listenToFirstPromptRenameFailures((payload) => {
          set({ latestFailure: payload });
        })
        .then((unlisten) => {
          if (generation !== listenerGeneration) {
            unlisten();
            return;
          }

          unlistenFirstPromptRenameFailures = unlisten;
          set({ listenerReady: true });
        });
      listenerInitialization = initialization;

      try {
        await initialization;
      } finally {
        if (listenerInitialization === initialization) {
          listenerInitialization = null;
        }
      }
    },

    dismissLatestFailure: () => set({ latestFailure: null }),
  }),
);

export function teardownFirstPromptRenameListener() {
  listenerGeneration += 1;
  unlistenFirstPromptRenameFailures?.();
  unlistenFirstPromptRenameFailures = null;
  listenerInitialization = null;
  useFirstPromptRenameStore.setState({
    listenerReady: false,
    latestFailure: null,
  });
}
