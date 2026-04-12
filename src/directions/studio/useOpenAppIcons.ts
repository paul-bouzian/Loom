import { useDeferredValue, useEffect, useMemo, useState } from "react";

import * as bridge from "../../lib/bridge";
import type { OpenTarget } from "../../lib/types";

const iconCache = new Map<string, Promise<string | null>>();

export function resetOpenAppIconCacheForTests() {
  iconCache.clear();
}

function loadOpenAppIcon(appName: string) {
  if (!iconCache.has(appName)) {
    iconCache.set(
      appName,
      bridge.getOpenAppIcon(appName).catch(() => null),
    );
  }
  return iconCache.get(appName)!;
}

type ResolvedAppTarget = {
  id: string;
  appName: string;
};

export function useOpenAppIcons(targets: OpenTarget[]) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const resolvedTargets = useMemo<ResolvedAppTarget[]>(
    () => {
      const byId = new Map<string, ResolvedAppTarget>();
      for (const target of targets) {
        if (target.kind !== "app" || typeof target.appName !== "string") {
          continue;
        }
        const appName = target.appName.trim();
        if (!appName) {
          continue;
        }

        byId.set(target.id, { id: target.id, appName });
      }
      return Array.from(byId.values());
    },
    [targets],
  );
  const deferredTargets = useDeferredValue(resolvedTargets);

  useEffect(() => {
    let cancelled = false;
    if (deferredTargets.length === 0) {
      setIcons({});
      return undefined;
    }

    void Promise.all(
      deferredTargets.map(async ({ id, appName }) => [id, await loadOpenAppIcon(appName)] as const),
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setIcons(
        Object.fromEntries(
          entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
        ),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [deferredTargets]);

  return icons;
}
