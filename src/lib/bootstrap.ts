import { invoke } from "@tauri-apps/api/core";

export type BootstrapStatus = {
  appName: string;
  appVersion: string;
  backend: string;
  platform: string;
};

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  return invoke<BootstrapStatus>("get_bootstrap_status");
}
