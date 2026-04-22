#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

import { normalizeVersion, validateVersion } from "./lib/release-version.mjs";

const version = normalizeVersion(process.argv[2] ?? "");
validateVersion(version);

const releaseTag = process.env.RELEASE_TAG ?? `v${version}`;
const repository = process.env.GITHUB_REPOSITORY ?? "paul-bouzian/Skein";
const privateKey = process.env.LEGACY_UPDATER_PRIVATE_KEY ?? "";
const privateKeyPassword = process.env.LEGACY_UPDATER_PRIVATE_KEY_PASSWORD ?? "";

if (!privateKey.trim()) {
  throw new Error("LEGACY_UPDATER_PRIVATE_KEY is required to generate transition updater artifacts.");
}

const appPath = resolve(
  process.env.LEGACY_TRANSITION_APP_PATH ??
    "release-artifacts/electron/mac-arm64/Skein.app",
);
const outputDir = resolve(
  process.env.LEGACY_TRANSITION_OUTPUT_DIR ?? "release-artifacts/release",
);
const notesFilePath = resolve(
  process.env.LEGACY_TRANSITION_NOTES_FILE ?? "release-artifacts/release-notes.md",
);

await mkdir(outputDir, { recursive: true });
const archivePath = join(outputDir, `${basename(appPath)}.tar.gz`);
const signaturePath = `${archivePath}.sig`;
const manifestPath = join(outputDir, "latest.json");
const releaseNotes = await readOptionalText(notesFilePath);
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "skein-legacy-updater-"),
);
const privateKeyPath = join(temporaryDirectory, "private.key");
const stagedAppPath = join(temporaryDirectory, basename(appPath));

try {
  const signerKeyPath = await materializePrivateKey(privateKey, privateKeyPath);
  await stageLegacyTransitionApp(appPath, stagedAppPath);
  await run("tar", [
    "-czf",
    archivePath,
    "-C",
    dirname(stagedAppPath),
    basename(stagedAppPath),
  ]);
  await signLegacyUpdateArchive(archivePath, signerKeyPath, privateKeyPassword);

  const signature = (await readFile(signaturePath, "utf8")).trim();
  const manifest = {
    version,
    notes: releaseNotes || "",
    pub_date: new Date().toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature,
        url: `https://github.com/${repository}/releases/download/${releaseTag}/${basename(archivePath)}`,
      },
    },
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function readOptionalText(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (isFileMissing(error)) {
      return "";
    }
    throw error;
  }
}

function isFileMissing(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function materializePrivateKey(privateKey, destinationPath) {
  const normalizedPrivateKey = privateKey.trim();
  if (await fileExists(normalizedPrivateKey)) {
    return resolve(normalizedPrivateKey);
  }

  await writeFile(destinationPath, normalizedPrivateKey, {
    encoding: "utf8",
    mode: 0o600,
  });
  return destinationPath;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isFileMissing(error) || isInvalidPath(error)) {
      return false;
    }
    throw error;
  }
}

function isInvalidPath(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENAMETOOLONG" || error.code === "EINVAL")
  );
}

async function signLegacyUpdateArchive(archivePath, signerKeyPath, password) {
  // Pre-Electron installs still validate Tauri updater signatures, so the
  // transition archive must be signed with the same legacy signer contract.
  await run("bunx", [
    "@tauri-apps/cli@2.10.1",
    "signer",
    "sign",
    "-f",
    signerKeyPath,
    archivePath,
  ], {
    env: password
      ? {
          ...process.env,
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
        }
      : process.env,
  });
}

async function stageLegacyTransitionApp(sourceAppPath, destinationAppPath) {
  await run("ditto", [sourceAppPath, destinationAppPath]);
  // The legacy Tauri updater path mishandles macOS copyfile metadata during
  // extraction and can materialize AppleDouble `._*` files inside the bundle,
  // which breaks the Electron code signature. Stage a clean copy first.
  await run("xattr", ["-cr", destinationAppPath]);
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
        COPY_EXTENDED_ATTRIBUTES_DISABLE: "1",
        ...(options.env ?? {}),
      },
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`),
      );
    });
  });
}
