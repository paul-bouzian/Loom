import type { OpenTarget } from "../../lib/types";
import { FolderIcon, OpenInIcon } from "../../shared/Icons";
import { resolveOpenTargetIcon } from "./openTargetIcons";

type Props = {
  target: OpenTarget;
  iconUrl?: string | null;
  size?: number;
  className?: string;
};

export function OpenTargetIcon({
  target,
  iconUrl,
  size = 16,
  className,
}: Props) {
  const resolvedIconUrl = iconUrl ?? resolveOpenTargetIcon(target);

  if (resolvedIconUrl) {
    return (
      <img
        src={resolvedIconUrl}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={className}
      />
    );
  }

  if (target.kind === "fileManager") {
    return <FolderIcon size={size} className={className} />;
  }

  return <OpenInIcon size={size} className={className} />;
}
