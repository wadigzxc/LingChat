// Synthetic timestamps are unit fixtures, never performance acceptance evidence.
import test from "node:test";
import assert from "node:assert/strict";
import * as metrics from "./metrics.mjs";
const { summarizeFrames } = metrics;
function unitCapture() {
  const env = {
    width: 1920,
    height: 1080,
    dpr: 1,
    visible: true,
    focused: true,
    tauri: true,
    hmr: false,
    href: "http://tauri.localhost/",
    userAgent: "unit-fixture",
  };
  return {
    schemaVersion: 1,
    kind: "fresh-capture",
    capturedAt: "2026-01-01T00:00:00.000Z",
    metadata: {
      mode: "full",
      scene: "normal",
      machineId: "unit-only",
      gpu: "unit-gpu",
      driver: "unit-driver",
      webview2: "unit-version",
      dpi: "96",
      hdr: "off",
      power: "unit-power",
      commit: "a".repeat(40),
      buildEvidence: "unit-only, not a real build",
      sceneEvidence: "unit-only",
      devtoolsClosed: true,
    },
    proof: {
      nativeWebView: true,
      executablePath: "unit.exe",
      executableSha256: "b".repeat(64),
      hostPid: 42,
      listenerPid: 43,
      gpuHardwareVerified: true,
      foregroundEvents: [],
      foregroundMonitor: { elapsedMs: 92000, intervalMs: 250 },
      powerUnchanged: true,
    },
    sample: {
      warmupRequestedMs: 5000,
      sampleRequestedMs: 60000,
      warmupElapsedMs: 5000,
      timeOrigin: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      timestamps: Array.from({ length: 3601 }, (_, i) => i * (1000 / 60)),
      environmentStart: env,
      environmentEnd: { ...env },
      events: [],
      longTasks: { status: "supported", entries: [] },
    },
  };
}

test("derives elapsed, FPS and percent units from original RAF timestamps", () => {
  const result = summarizeFrames([100, 110, 130, 160]);
  assert.equal(result.elapsedMs, 60);
  assert.equal(result.avgFPS, 50);
  assert.equal(result.p95FrameMs, 30);
  assert.equal(result.p99FrameMs, 30);
  assert.equal(result.maxFrameMs, 30);
  assert.equal(result.missedFramePercent, (2 / 3) * 100);
  assert.equal(result.intervalCount, 3);
});

test("refuses missing, nonfinite, duplicate or reversed timing evidence", () => {
  for (const samples of [[], [0], [0, NaN], [0, Infinity], [1, 1], [2, 1], ["0", 1]]) {
    assert.throws(() => summarizeFrames(samples), /timestamps/);
  }
});

test("uses scene-specific numeric gates and keeps unsupported Long Tasks unknown", () => {
  const values = { avgFPS: 59, p95FrameMs: 20, missedFramePercent: 5 };
  assert.equal(
    metrics.performanceGate(values, "normal", { status: "supported", entries: [] }).status,
    "pass"
  );
  assert.equal(
    metrics.performanceGate(values, "normal", { status: "supported", entries: [{ duration: 100 }] })
      .status,
    "fail"
  );
  assert.equal(
    metrics.performanceGate(values, "normal", { status: "unsupported", entries: [] }).status,
    "unknown"
  );
  const edge = { avgFPS: 55, p95FrameMs: 25, missedFramePercent: 10 };
  assert.equal(
    metrics.performanceGate(edge, "eight_png", { status: "supported", entries: [] }).status,
    "pass"
  );
  assert.equal(
    metrics.performanceGate(edge, "normal", { status: "supported", entries: [] }).status,
    "fail"
  );
  assert.throws(
    () => metrics.performanceGate(values, "typo", { status: "supported", entries: [] }),
    /scene/
  );
});

test("validates actual timing and conditions without granting overall acceptance", () => {
  const capture = unitCapture();
  assert.equal(metrics.analyzeCapture(capture).measurementStatus, "valid");
  assert.equal(
    metrics.analyzeCapture(capture).acceptance,
    "pending-present-visual-and-paired-runs"
  );
  for (const mutate of [
    (c) => {
      delete c.metadata.gpu;
    },
    (c) => {
      c.metadata.power = "unknown";
    },
    (c) => {
      c.proof.gpuHardwareVerified = false;
    },
    (c) => {
      c.sample.timestamps = [0, 16];
    },
    (c) => {
      c.sample.environmentEnd.width = 1500;
    },
    (c) => {
      c.sample.environmentStart.hmr = true;
    },
    (c) => {
      c.sample.events.push({ type: "visibilitychange", timestamp: 100 });
    },
    (c) => {
      c.proof.foregroundEvents.push({ timestamp: 100, pid: 99 });
    },
    (c) => {
      c.sample.longTasks.status = "unsupported";
    },
    (c) => {
      c.sample.warmupElapsedMs = NaN;
    },
    (c) => {
      c.sample.longTasks.entries = [{ duration: null }];
    },
    (c) => {
      c.proof.foregroundMonitor = { elapsedMs: 100 };
    },
  ]) {
    const modified = structuredClone(capture);
    mutate(modified);
    assert.notEqual(metrics.analyzeCapture(modified).measurementStatus, "valid");
    assert.ok(metrics.analyzeCapture(modified).reasons.length > 0);
  }
});

test("offline analysis is labeled and paired modes reject different measurement conditions", () => {
  const full = unitCapture();
  const simplified = structuredClone(full);
  simplified.metadata.mode = "simplified";
  const report = metrics.makeReport(full, "offline-analysis", {
    path: "unit-only.json",
    sha256: "c".repeat(64),
  });
  assert.equal(report.kind, "offline-analysis");
  assert.match(metrics.renderMarkdown(report), /offline-analysis/);
  assert.match(metrics.renderMarkdown(report), /Long Tasks/);
  assert.equal(metrics.compareCaptures(full, simplified).comparable, true);
  for (const key of [
    "machineId",
    "power",
    "commit",
    "hdr",
    "dpi",
    "scene",
    "gpu",
    "driver",
    "webview2",
    "sceneEvidence",
  ]) {
    const changed = structuredClone(simplified);
    changed.metadata[key] = "different";
    assert.equal(metrics.compareCaptures(full, changed).comparable, false, key);
  }
  simplified.proof.executableSha256 = "d".repeat(64);
  assert.equal(metrics.compareCaptures(full, simplified).comparable, false);
});

test("watchdog or dropped/incomplete RAF evidence gets explicit unknown metrics, never invented zero", () => {
  const raw = unitCapture();
  raw.sample.timestamps = [];
  raw.sample.warmupElapsedMs = null;
  raw.sample.events.push({ type: "watchdog-timeout-incomplete", timestamp: 90000 });
  const report = metrics.makeReport(raw, "fresh-capture", { path: "UNIT-ONLY.raw.json" });
  assert.equal(report.measurementStatus, "invalid-or-incomplete");
  assert.equal(report.metrics.elapsedMs, null);
  assert.equal(report.metrics.avgFPS, null);
  assert.equal(report.performance.status, "unknown");
  assert.match(metrics.renderMarkdown(report), /unknown/);
});
