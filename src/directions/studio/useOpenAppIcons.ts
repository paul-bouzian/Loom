import { useMemo } from "react";

import type { OpenTarget } from "../../lib/types";
import { getKnownOpenTargetIcon } from "./openTargetIcons";

export function resetOpenAppIconCacheForTests() {
  return undefined;
}

export function useOpenAppIcons(targets: OpenTarget[]) {
  return useMemo(
    () =>
      Object.fromEntries(
        targets.flatMap((target) => {
          const icon = getKnownOpenTargetIcon(target.id, target.appName);
          return icon ? [[target.id, icon]] : [];
        }),
      ),
    [targets],
  );
}
