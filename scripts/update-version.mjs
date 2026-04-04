#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const version = normalizeVersion(process.argv[2] ?? "");
validateVersion(version);

const packageJsonPath = resolve("package.json");
const tauriConfigPath = resolve("src-tauri/tauri.conf.json");
const cargoTomlPath = resolve("src-tauri/Cargo.toml");

const [packageJsonRaw, tauriConfigRaw, cargoTomlRaw] = await Promise.all([
  readFile(packageJsonPath, "utf8"),
  readFile(tauriConfigPath, "utf8"),
  readFile(cargoTomlPath, "utf8"),
]);

const packageJson = JSON.parse(packageJsonRaw);
const tauriConfig = JSON.parse(tauriConfigRaw);

packageJson.version = version;
tauriConfig.version = version;

const nextCargoToml = updateCargoPackageVersion(cargoTomlRaw, version);

await Promise.all([
  writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`),
  writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`),
  writeFile(cargoTomlPath, nextCargoToml),
]);

function normalizeVersion(input) {
  return input.startsWith("v") ? input.slice(1) : input;
}

function validateVersion(candidate) {
  if (!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(candidate)) {
    throw new Error(`Invalid release version: ${candidate}`);
  }
}

function updateCargoPackageVersion(cargoToml, nextVersion) {
  const lines = cargoToml.split("\n");
  let insidePackage = false;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.trim() === "[package]") {
      insidePackage = true;
      return line;
    }

    if (insidePackage && line.startsWith("[")) {
      insidePackage = false;
    }

    if (insidePackage && line.startsWith("version = ")) {
      replaced = true;
      return `version = "${nextVersion}"`;
    }

    return line;
  });

  if (!replaced) {
    throw new Error("Failed to locate package version in src-tauri/Cargo.toml");
  }

  return `${nextLines.join("\n").replace(/\n?$/, "\n")}`;
}
