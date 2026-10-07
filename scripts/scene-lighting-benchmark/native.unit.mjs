// Process records below are synthetic contract fixtures, not machine evidence.
import test from "node:test";
import assert from "node:assert/strict";
import * as native from "./native.mjs";

test("production source guard rejects tracked, staged and untracked files", () => {
  assert.equal(typeof native.validateProductionStatus, "function");
  assert.doesNotThrow(() => native.validateProductionStatus(""));
  for (const status of [" M package.json\n", "M  src/App.vue\n", "?? src-tauri/src/new.rs\n"]) {
    assert.throws(() => native.validateProductionStatus(status), /Production source/);
  }
});

test("requires native WebView2 listener ancestry and rejects Chrome / wrong executable / software GPU flags", () => {
  const snapshot = {
    listenerAddress: "127.0.0.1",
    chain: [
      {
        Name: "msedgewebview2.exe",
        ProcessId: 43,
        ParentProcessId: 42,
        ExecutablePath: "C:/WebView/msedgewebview2.exe",
        CommandLine: "--embedded-browser-webview=1",
      },
      { Name: "ling_chat.exe", ProcessId: 42, ExecutablePath: "G:/release/ling_chat.exe" },
    ],
  };
  assert.doesNotThrow(() =>
    native.validateNativeSnapshot(snapshot, 42, "G:/release/ling_chat.exe")
  );
  for (const mutate of [
    (s) => {
      s.chain[0].Name = "chrome.exe";
    },
    (s) => {
      s.chain[1].ProcessId = 99;
    },
    (s) => {
      s.chain[1].ExecutablePath = "G:/debug/ling_chat.exe";
    },
    (s) => {
      s.chain[0].CommandLine += " --disable-gpu";
    },
    (s) => {
      s.listenerAddress = "0.0.0.0";
    },
  ]) {
    const bad = structuredClone(snapshot);
    mutate(bad);
    assert.throws(() => native.validateNativeSnapshot(bad, 42, "G:/release/ling_chat.exe"));
  }
});

test("rejects mismatched or bypassed build provenance instead of assuming release acceptance", () => {
  const record = {
    exitCode: 0,
    production: true,
    commit: "a".repeat(40),
    executableSha256: "b".repeat(64),
    executablePath: "G:/release/ling_chat.exe",
    command: "pnpm run tauri build --no-bundle",
    builtAt: "2026-01-01T00:00:00Z",
  };
  assert.doesNotThrow(() =>
    native.validateBuildRecord(record, record.commit, record.executableSha256)
  );
  for (const mutate of [
    (r) => {
      r.exitCode = 1;
    },
    (r) => {
      r.production = false;
    },
    (r) => {
      r.command += " --ignore-version-mismatches";
    },
    (r) => {
      r.command = "cargo build --release";
    },
    (r) => {
      r.executableSha256 = "wrong";
    },
    (r) => {
      r.commit = "different";
    },
  ]) {
    const bad = structuredClone(record);
    mutate(bad);
    assert.throws(
      () => native.validateBuildRecord(bad, record.commit, record.executableSha256),
      /build/
    );
  }
});

test(
  "native foreground monitor signals readiness before sampling (read-only Windows API smoke)",
  { skip: process.platform !== "win32" },
  async () => {
    const monitor = native.monitorForeground(process.pid, undefined, 500);
    assert.ok(monitor.ready instanceof Promise);
    await monitor.ready;
    const result = await monitor.result;
    assert.equal(result.intervalMs, 250);
    assert.ok(result.elapsedMs >= 500);
    assert.ok(Array.isArray(result.events));
  }
);
