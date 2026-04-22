export interface LauncherBuildArgs {
  frameworksDirectory: string;
  launcherPath: string;
  launcherSourcePath: string;
}

export interface AfterPackContext {
  appOutDir: string;
  electronPlatformName: string;
  packager: {
    appInfo: {
      productFilename: string;
    };
  };
}

export function createLauncherSource(fontationsDisableFlag: string): string;
export function createLauncherBuildArgs(args: LauncherBuildArgs): string[];

export default function afterPack(context: AfterPackContext): Promise<void>;
