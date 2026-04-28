#!/usr/bin/env node

import { execFile } from "node:child_process";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APP_UPDATE_CONFIG_FILE = "app-update.yml";
const FONTATIONS_DISABLE_FLAG = "--disable-features=FontationsFontBackend";
const JITLESS_FLAG = "--js-flags=--jitless";
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
  const resourcesDirectory = join(appBundleDirectory, "Contents", "Resources");
  const launcherPath = join(macOsDirectory, appName);
  const wrappedExecutableName = `${appName}${WRAPPED_EXECUTABLE_SUFFIX}`;
  const wrappedExecutablePath = join(macOsDirectory, wrappedExecutableName);
  const launcherSourcePath = join(macOsDirectory, LAUNCHER_SOURCE_FILE);

  await writeAppUpdateConfig({
    appId: context.packager.appInfo.id,
    publish: context.packager.config.publish,
    resourcesDirectory,
  });
  await rename(launcherPath, wrappedExecutablePath);
  await writeFile(
    launcherSourcePath,
    createLauncherSource({
      fontationsDisableFlag: FONTATIONS_DISABLE_FLAG,
      jitlessFlag: JITLESS_FLAG,
    }),
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

export async function writeAppUpdateConfig({
  appId,
  publish,
  resourcesDirectory,
}) {
  const source = createAppUpdateConfigSource(
    resolveMacAppUpdateConfig({ appId, publish }),
  );
  await writeFile(join(resourcesDirectory, APP_UPDATE_CONFIG_FILE), source);
}

export function resolveMacAppUpdateConfig({ appId, publish }) {
  assertNonEmptyString(appId, "appId");

  const publishConfig = Array.isArray(publish) ? publish[0] : publish;
  if (
    !publishConfig ||
    publishConfig.provider !== "github" ||
    typeof publishConfig.owner !== "string" ||
    typeof publishConfig.repo !== "string"
  ) {
    throw new Error(
      "Skein macOS auto-update requires a GitHub publish configuration.",
    );
  }

  return {
    provider: "github",
    owner: publishConfig.owner,
    repo: publishConfig.repo,
    channel:
      typeof publishConfig.channel === "string" ? publishConfig.channel : "latest",
    updaterCacheDirName: `${appId}-updater`,
  };
}

export function createAppUpdateConfigSource({
  provider,
  owner,
  repo,
  channel,
  updaterCacheDirName,
}) {
  const values = {
    provider,
    owner,
    repo,
    channel,
    updaterCacheDirName,
  };

  return Object.entries(values)
    .map(([key, value]) => {
      assertNonEmptyString(value, key);
      return `${key}: ${formatYamlScalar(value)}`;
    })
    .join("\n")
    .concat("\n");
}

export function createLauncherSource({
  fontationsDisableFlag,
  jitlessFlag,
}) {
  return `#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>
#include <unistd.h>

int ElectronMain(int argc, char* argv[]);

static bool argument_equals(const char* argument, const char* expected) {
  return strcmp(argument, expected) == 0;
}

static bool argument_disables_fontations(const char* argument) {
  const char* prefix = "--disable-features=";
  size_t prefix_length = strlen(prefix);

  if (strncmp(argument, prefix, prefix_length) != 0) {
    return false;
  }

  return strstr(argument + prefix_length, "FontationsFontBackend") != NULL;
}

static bool current_macos_requires_jitless(void) {
  char version[32];
  size_t version_length = sizeof(version);

  if (sysctlbyname("kern.osproductversion", version, &version_length, NULL, 0) != 0) {
    return false;
  }

  version[sizeof(version) - 1] = '\\0';
  return strtol(version, NULL, 10) >= 26;
}

int main(int argc, char* argv[]) {
  unsetenv("ELECTRON_RUN_AS_NODE");

  bool has_fontations_disable_flag = false;
  bool has_jitless_flag = false;

  for (int index = 1; index < argc; index += 1) {
    if (argument_disables_fontations(argv[index])) {
      has_fontations_disable_flag = true;
      continue;
    }

    if (argument_equals(argv[index], "${jitlessFlag}")) {
      has_jitless_flag = true;
    }
  }

  size_t injected_argument_count = 0;
  bool should_add_fontations_disable_flag = !has_fontations_disable_flag;
  bool should_add_jitless_flag = current_macos_requires_jitless() && !has_jitless_flag;

  if (should_add_fontations_disable_flag) {
    injected_argument_count += 1;
  }

  if (should_add_jitless_flag) {
    injected_argument_count += 1;
  }

  if (injected_argument_count == 0) {
    return ElectronMain(argc, argv);
  }

  char** patched_argv = calloc((size_t)argc + injected_argument_count + 1, sizeof(char*));
  if (patched_argv == NULL) {
    return EXIT_FAILURE;
  }

  size_t next_argument_index = 1;
  patched_argv[0] = argv[0];

  if (should_add_fontations_disable_flag) {
    patched_argv[next_argument_index] = "${fontationsDisableFlag}";
    next_argument_index += 1;
  }

  if (should_add_jitless_flag) {
    patched_argv[next_argument_index] = "${jitlessFlag}";
    next_argument_index += 1;
  }

  memcpy(&patched_argv[next_argument_index], &argv[1], (size_t)argc * sizeof(char*));

  int result = ElectronMain((int)((size_t)argc + injected_argument_count), patched_argv);
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

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected ${label} to be a non-empty string.`);
  }
}

function formatYamlScalar(value) {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}
