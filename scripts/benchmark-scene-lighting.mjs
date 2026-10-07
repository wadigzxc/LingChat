#!/usr/bin/env node
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { captureProduction } from "./scene-lighting-benchmark/capture.mjs";
const run = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  makeReport,
  renderMarkdown,
  compareCaptures,
} from "./scene-lighting-benchmark/metrics.mjs";
import {
  nativeSnapshot,
  validateNativeSnapshot,
  validateBuildRecord,
  validateProductionStatus,
} from "./scene-lighting-benchmark/native.mjs";
function endpointUrl(value) {
  const endpoint = new URL(value ?? "http://invalid");
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Only explicit http://127.0.0.1:PORT loopback endpoints are allowed");
  return endpoint;
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function load(path) {
  if (!path) throw new Error("Required input path missing");
  const bytes = await readFile(path);
  return { data: JSON.parse(bytes), source: { path: resolve(path), sha256: hash(bytes) } };
}
async function save(prefix, report, rawText) {
  if (!prefix) throw new Error("--out is required");
  for (const suffix of [".json", ".md", ".raw.json"]) {
    try {
      await access(prefix + suffix);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`Refusing overwrite: ${prefix + suffix}`);
  }
  await mkdir(dirname(resolve(prefix)), { recursive: true });
  if (rawText) await writeFile(prefix + ".raw.json", rawText, { flag: "wx" });
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await writeFile(
    prefix + ".md",
    report.kind === "offline-comparison"
      ? `# Offline comparison\n\nTask19 acceptance remains pending.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`
      : renderMarkdown(report),
    { flag: "wx" }
  );
}
const HELP = `Scene lighting benchmark (Node >=22, Windows native WebView2)
Usage:
  node scripts/benchmark-scene-lighting.mjs capture --endpoint http://127.0.0.1:9223 --target ID --host-pid PID --metadata machine.json --build-record build.json --out evidence/run
  node scripts/benchmark-scene-lighting.mjs inspect --endpoint http://127.0.0.1:9223 --host-pid PID --executable C:/path/ling_chat.exe
  node scripts/benchmark-scene-lighting.mjs report --input evidence/run.raw.json --out evidence/reanalysis
  node scripts/benchmark-scene-lighting.mjs compare --full evidence/full.raw.json --simplified evidence/simplified.raw.json --out evidence/pair

capture: fixed 5s RAF warmup + 60s sample; never changes scene/mode/UI/config.
report/compare: offline reanalysis, NOT fresh capture. Raw JSON remains unchanged.
inspect: read-only listener/process ownership check, never launches the app.
Outputs are exclusive-create; use a new prefix for retries.
RAF is not present cadence. Task19 remains pending PresentMon/ETW, visual review and paired runs.
See docs/performance/scene-lighting-template.md for required records and user-operated setup.
`;
try {
  const options = Object.fromEntries(
    [
      "input",
      "out",
      "full",
      "simplified",
      "endpoint",
      "target",
      "host-pid",
      "metadata",
      "build-record",
      "executable",
    ].map((key) => [key, { type: "string" }])
  );
  const { values, positionals } = parseArgs({
    options: { ...options, help: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.help) console.log(HELP);
  else if (positionals[0] === "report") {
    const input = await load(values.input);
    const report = makeReport(input.data, "offline-analysis", input.source);
    await save(values.out, report);
    console.log(`offline-analysis: ${report.measurementStatus}; Task19 pending`);
  } else if (["capture", "inspect"].includes(positionals[0])) {
    const endpoint = endpointUrl(values.endpoint);
    if (positionals[0] === "capture") {
      if (!values.out || !values.target || !/^[1-9][0-9]*$/.test(values["host-pid"] ?? ""))
        throw new Error("Capture requires --out, --target and positive --host-pid");
      const metadata = (await load(values.metadata)).data;
      const buildRecord = (await load(values["build-record"])).data;
      const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: repository });
      const head = stdout.trim();
      validateBuildRecord(buildRecord, head, buildRecord.executableSha256);
      const { stdout: sourceStatus } = await run(
        "git",
        [
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--",
          "src",
          "src-tauri",
          "package.json",
          "pnpm-lock.yaml",
          "vite.config.ts",
        ],
        { cwd: repository, maxBuffer: 8 * 1024 * 1024 }
      );
      validateProductionStatus(sourceStatus);
      const executableSha256 = hash(await readFile(buildRecord.executablePath));
      validateBuildRecord(buildRecord, head, executableSha256);
      for (const suffix of [".raw.json", ".json", ".md"]) {
        try {
          await access(values.out + suffix);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        throw new Error("Capture output already exists; choose a fresh prefix");
      }
      console.log(
        "Keep the existing application foreground until completion (~93s). No scene/mode changes are performed."
      );
      const raw = await captureProduction({
        endpoint,
        hostPid: Number(values["host-pid"]),
        targetId: values.target,
        metadata,
        buildRecord,
        executableSha256,
        head,
      });
      if (hash(await readFile(buildRecord.executablePath)) !== executableSha256)
        raw.sample.events.push({ type: "executable-changed-during-capture" });
      const rawText = JSON.stringify(raw, null, 2) + "\n";
      const report = makeReport(raw, "fresh-capture", {
        path: resolve(values.out + ".raw.json"),
        sha256: hash(rawText),
      });
      await save(values.out, report, rawText);
      console.log(
        `fresh-capture: ${report.measurementStatus}; numeric=${report.performance.status}; Task19 pending`
      );
    } else {
      const snapshot = await nativeSnapshot(Number(endpoint.port));
      validateNativeSnapshot(snapshot, Number(values["host-pid"]), values.executable);
      console.log(
        JSON.stringify({ kind: "read-only-inspection", snapshot, acceptance: "pending" }, null, 2)
      );
    }
  } else if (positionals[0] === "compare") {
    const full = await load(values.full);
    const simplified = await load(values.simplified);
    const report = {
      ...compareCaptures(full.data, simplified.data),
      sources: [full.source, simplified.source],
    };
    await save(values.out, report);
    console.log(`offline-comparison: comparable=${report.comparable}; Task19 pending`);
  } else throw new Error("Choose a command; use --help");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
