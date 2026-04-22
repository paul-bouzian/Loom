#!/usr/bin/env node

import { execFile } from "node:child_process";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const FONTATIONS_DISABLE_FLAG = "--disable-features=FontationsFontBackend";
const WRAPPED_EXECUTABLE_SUFFIX = "-electron";
const LAUNCHER_SOURCE_FILE = "skein-electron-launcher.c";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appBundleDirectory = join(context.appOutDir, `${appName}.app`);
  const macOsDirectory = join(appBundleDirectory, "Contents", "MacOS");
  const frameworksDirectory = join(appBundleDirectory, "Contents", "Frameworks");
  const launcherPath = join(macOsDirectory, appName);
  const wrappedExecutableName = `${appName}${WRAPPED_EXECUTABLE_SUFFIX}`;
  const wrappedExecutablePath = join(macOsDirectory, wrappedExecutableName);
  const launcherSourcePath = join(macOsDirectory, LAUNCHER_SOURCE_FILE);

  await rename(launcherPath, wrappedExecutablePath);
  await writeFile(
    launcherSourcePath,
    createLauncherSource(FONTATIONS_DISABLE_FLAG),
  );
  try {
    await buildNativeLauncher({
      frameworksDirectory,
      launcherPath,
      launcherSourcePath,
    });
  } finally {
    await unlink(launcherSourcePath).catch(() => {});
  }
  await chmod(launcherPath, 0o755);
}

export function createLauncherSource(fontationsDisableFlag) {
  return `#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

int ElectronMain(int argc, char* argv[]);

static bool argument_disables_fontations(const char* argument) {
  const char* prefix = "--disable-features=";
  size_t prefix_length = strlen(prefix);

  if (strncmp(argument, prefix, prefix_length) != 0) {
    return false;
  }

  return strstr(argument + prefix_length, "FontationsFontBackend") != NULL;
}

int main(int argc, char* argv[]) {
  for (int index = 1; index < argc; index += 1) {
    if (argument_disables_fontations(argv[index])) {
      return ElectronMain(argc, argv);
    }
  }

  char** patched_argv = calloc((size_t)argc + 2, sizeof(char*));
  if (patched_argv == NULL) {
    return EXIT_FAILURE;
  }

  patched_argv[0] = argv[0];
  patched_argv[1] = "${fontationsDisableFlag}";
  memcpy(&patched_argv[2], &argv[1], (size_t)argc * sizeof(char*));

  int result = ElectronMain(argc + 1, patched_argv);
  free(patched_argv);
  return result;
}
`;
}

export function createLauncherBuildArgs({
  frameworksDirectory,
  launcherPath,
  launcherSourcePath,
}) {
  return [
    "clang",
    launcherSourcePath,
    "-F",
    frameworksDirectory,
    "-framework",
    "Electron Framework",
    "-Wl,-rpath,@executable_path/../Frameworks",
    "-o",
    launcherPath,
  ];
}

async function buildNativeLauncher({
  frameworksDirectory,
  launcherPath,
  launcherSourcePath,
}) {
  await execFileAsync(
    "xcrun",
    createLauncherBuildArgs({
      frameworksDirectory,
      launcherPath,
      launcherSourcePath,
    }),
  );
}
