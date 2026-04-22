import type {
  DesktopDialogOpenOptions,
  DesktopDialogOptions,
  DesktopNotification,
  DesktopNotificationPermission,
  DesktopUpdate,
  DesktopWindowDragDropEvent,
  HostUnlistenFn,
} from "./desktop-types";
import { requireDesktopApi } from "./desktop-host";

function requireDesktopShell() {
  return requireDesktopApi(
    "Desktop shell is unavailable. Launch Skein with `bun run electron:dev`.",
  );
}

export const dialog = {
  confirm(
    message: string,
    options?: DesktopDialogOptions,
  ): Promise<boolean> {
    return requireDesktopShell().dialog.confirm(message, options);
  },

  message(message: string, options?: DesktopDialogOptions): Promise<void> {
    return requireDesktopShell().dialog.message(message, options);
  },

  open(
    options?: DesktopDialogOpenOptions,
  ): Promise<string | string[] | null> {
    return requireDesktopShell().dialog.open(options);
  },
};

export function openExternalUrl(url: string): Promise<void> {
  return requireDesktopShell().shell.openExternal(url);
}

export const notifications = {
  getPermissionState(): Promise<DesktopNotificationPermission> {
    return requireDesktopShell().notifications.getPermissionState();
  },

  requestPermission(): Promise<"granted" | "denied"> {
    return requireDesktopShell().notifications.requestPermission();
  },

  send(notification: DesktopNotification): Promise<void> {
    return requireDesktopShell().notifications.send(notification);
  },
};

export const updater = {
  check(): Promise<DesktopUpdate | null> {
    return requireDesktopShell().updater.check();
  },
};

export const windowShell = {
  getPathForFile(file: File): string | null {
    return requireDesktopShell().window.getPathForFile(file);
  },

  onDragDropEvent(
    handler: (event: DesktopWindowDragDropEvent) => void,
  ): Promise<HostUnlistenFn> {
    return Promise.resolve(requireDesktopShell().window.onDragDropEvent?.(handler)).then(
      (unlisten) => unlisten ?? (() => undefined),
    );
  },
};
