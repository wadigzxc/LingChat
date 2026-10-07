import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("fresh capture and inspect reject non-loopback endpoints before any page execution", () => {
  for (const command of ["capture", "inspect"]) {
    const run = spawnSync(
      process.execPath,
      [cli, command, "--endpoint", "http://example.com:9223"],
      { encoding: "utf8" }
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /loopback/);
  }
});

const cli = fileURLToPath(new URL("../benchmark-scene-lighting.mjs", import.meta.url));

test("CLI help advertises explicit capture, offline report, inspect and comparison without pretending acceptance", () => {
  const run = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /capture/);
  assert.match(run.stdout, /offline/);
  assert.match(run.stdout, /inspect/);
  assert.match(run.stdout, /compare/);
  assert.match(run.stdout, /pending/);
});

test("offline CLI preserves raw synthetic unit evidence, emits labeled files and refuses overwrite", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scene-benchmark-unit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, "UNIT-ONLY.raw.json");
  const env = { width: 1920, height: 1080, dpr: 1 };
  const raw = JSON.stringify({
    schemaVersion: 1,
    kind: "fresh-capture",
    metadata: { mode: "full", scene: "normal" },
    proof: {},
    sample: {
      timestamps: [0, 10, 20],
      environmentStart: env,
      environmentEnd: env,
      events: [],
      longTasks: { status: "unsupported", entries: [] },
    },
  });
  writeFileSync(input, raw);
  const args = [cli, "report", "--input", input, "--out", join(dir, "UNIT-ONLY-reanalysis")];
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(input, "utf8"), raw);
  const result = JSON.parse(readFileSync(join(dir, "UNIT-ONLY-reanalysis.json"), "utf8"));
  assert.equal(result.kind, "offline-analysis");
  assert.equal(result.measurementStatus, "invalid-or-incomplete");
  assert.equal(result.metrics.elapsedMs, 20);
  assert.equal(result.performance.longTasks.count, null);
  assert.match(readFileSync(join(dir, "UNIT-ONLY-reanalysis.md"), "utf8"), /offline-analysis/);
  assert.notEqual(spawnSync(process.execPath, args).status, 0);
});

test("fresh capture command rejects failed build records without making up raw samples", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "scene-benchmark-unit-blocked-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const metadata = join(dir, "unit-machine.json");
  const build = join(dir, "unit-failed-build.json");
  writeFileSync(metadata, JSON.stringify({ mode: "full", scene: "normal" }));
  writeFileSync(build, JSON.stringify({ exitCode: 1, production: false }));
  const run = spawnSync(
    process.execPath,
    [
      cli,
      "capture",
      "--endpoint",
      "http://127.0.0.1:9223",
      "--target",
      "unit",
      "--host-pid",
      "42",
      "--metadata",
      metadata,
      "--build-record",
      build,
      "--out",
      join(dir, "unit-blocked"),
    ],
    { encoding: "utf8" }
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Invalid.*build/);
  assert.throws(() => readFileSync(join(dir, "unit-blocked.raw.json")), /ENOENT/);
});
