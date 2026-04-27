import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return false;
    },
  },
}));

const temporaryDirectories: string[] = [];

async function createTempDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "skein-backend-client-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("resolveNodeExecutablePath", () => {
  it("uses the real Electron binary beside the packaged launcher", async () => {
    const { resolveNodeExecutablePath } = await import("./backend-client.js");
    const directory = await createTempDirectory();
    const launcherPath = join(directory, "Skein");
    const electronPath = join(directory, "Skein-electron");
    await writeFile(electronPath, "");

    expect(
      resolveNodeExecutablePath({
        isPackaged: true,
        executablePath: launcherPath,
      }),
    ).toBe(electronPath);
  });

  it("falls back to the current executable when no packaged sibling exists", async () => {
    const { resolveNodeExecutablePath } = await import("./backend-client.js");
    const directory = await createTempDirectory();
    const launcherPath = join(directory, "Skein");

    expect(
      resolveNodeExecutablePath({
        isPackaged: true,
        executablePath: launcherPath,
      }),
    ).toBe(launcherPath);
  });

  it("keeps process.execPath in development", async () => {
    const { resolveNodeExecutablePath } = await import("./backend-client.js");
    const executablePath = "/Applications/Electron.app/Contents/MacOS/Electron";

    expect(
      resolveNodeExecutablePath({
        isPackaged: false,
        executablePath,
      }),
    ).toBe(executablePath);
  });
});
