import { useMemo } from "react";

import type { OpenTarget } from "../../lib/types";
import { resolveOpenTargetIcon } from "./openTargetIcons";

export function resetOpenAppIconCacheForTests() {
  return undefined;
}

export function useOpenAppIcons(targets: OpenTarget[]) {
  return useMemo(
    () =>
      Object.fromEntries(
        targets.flatMap((target) => {
          const icon = resolveOpenTargetIcon(target);
          return icon ? [[target.id, icon]] : [];
        }),
      ),
    [targets],
  );
}
