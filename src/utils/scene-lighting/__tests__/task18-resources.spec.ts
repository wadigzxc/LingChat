import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("resource preparation in staging-only mode never overwrites user data manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "lingchat-resource-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "data/third_party"), { recursive: true });
    copyFileSync(
      "scripts/prepare-desktop-resources.mjs",
      join(root, "scripts/prepare-desktop-resources.mjs")
    );
    writeFileSync(join(root, "data/data_manifest.json"), "user-data-sentinel");
    execFileSync(
      process.execPath,
      [join(root, "scripts/prepare-desktop-resources.mjs"), "--staging-only"],
      {
        cwd: root,
        env: { ...process.env, GIT_DIR: resolve(".git"), GIT_WORK_TREE: root },
        stdio: "pipe",
      }
    );
    expect(readFileSync(join(root, "data/data_manifest.json"), "utf8")).toBe("user-data-sentinel");
    expect(existsSync(join(root, "src-tauri/.bundled_resources/data_manifest.json"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("resource preparation creates Tauri resource directories for an empty checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "lingchat-empty-resource-test-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "data/.official/game_data"), { recursive: true });
    mkdirSync(join(root, "data/third_party"), { recursive: true });
    copyFileSync(
      "scripts/prepare-desktop-resources.mjs",
      join(root, "scripts/prepare-desktop-resources.mjs")
    );
    execFileSync(
      process.execPath,
      [join(root, "scripts/prepare-desktop-resources.mjs"), "--staging-only"],
      {
        cwd: root,
        env: { ...process.env, GIT_DIR: resolve(".git"), GIT_WORK_TREE: root },
        stdio: "pipe",
      }
    );
    expect(existsSync(join(root, "src-tauri/.bundled_resources/game_data"))).toBe(true);
    expect(existsSync(join(root, "src-tauri/.bundled_resources/third_party"))).toBe(true);
    expect(existsSync(join(root, "data/data_manifest.json"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
