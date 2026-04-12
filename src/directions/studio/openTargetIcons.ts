import antigravityIcon from "../../assets/open-target-icons/antigravity.png";
import cursorIcon from "../../assets/open-target-icons/cursor.png";
import finderIcon from "../../assets/open-target-icons/finder.png";
import ghosttyIcon from "../../assets/open-target-icons/ghostty.png";
import intellijIdeaIcon from "../../assets/open-target-icons/intellij-idea.svg";
import iterm2Icon from "../../assets/open-target-icons/iterm2.png";
import terminalIcon from "../../assets/open-target-icons/terminal.png";
import vscodeIcon from "../../assets/open-target-icons/vscode.png";
import zedIcon from "../../assets/open-target-icons/zed.png";

const KNOWN_OPEN_TARGET_ICONS: Record<string, string> = {
  antigravity: antigravityIcon,
  cursor: cursorIcon,
  "file-manager": finderIcon,
  ghostty: ghosttyIcon,
  idea: intellijIdeaIcon,
  iterm2: iterm2Icon,
  terminal: terminalIcon,
  vscode: vscodeIcon,
  zed: zedIcon,
};

const KNOWN_OPEN_TARGET_ICONS_BY_APP_NAME: Record<string, string> = {
  Antigravity: antigravityIcon,
  Cursor: cursorIcon,
  Ghostty: ghosttyIcon,
  "IntelliJ IDEA": intellijIdeaIcon,
  iTerm: iterm2Icon,
  Terminal: terminalIcon,
  "Visual Studio Code": vscodeIcon,
  Zed: zedIcon,
};

export function getKnownOpenTargetIcon(targetId: string, appName?: string | null) {
  return (
    KNOWN_OPEN_TARGET_ICONS[targetId] ??
    (appName ? KNOWN_OPEN_TARGET_ICONS_BY_APP_NAME[appName.trim()] : null) ??
    null
  );
}
