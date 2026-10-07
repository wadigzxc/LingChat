// Known debt is visible; compiler failures and any new warning are hard failures.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baseline = JSON.parse(
  readFileSync(new URL("./clippy-baseline.json", import.meta.url), "utf8")
);
function key(warning) {
  return JSON.stringify([
    warning.file.replaceAll("\\", "/"),
    warning.line,
    warning.code,
    warning.message,
  ]);
}
const remaining = new Map(baseline.warnings.map((warning) => [key(warning), warning.count]));
let output;
if (process.argv[2] === "--diagnostics") {
  output = readFileSync(process.argv[3], "utf8");
} else {
  const result = spawnSync(
    "cargo",
    ["clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--message-format=json"],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    }
  );
  process.stderr.write(result.stderr ?? "");
  output = result.stdout ?? "";
  if (result.error || result.status !== 0) {
    process.stderr.write(String(result.error ?? `cargo exited ${result.status}`) + "\n");
    process.exit(1);
  }
}
let warnings = 0;
let newWarnings = 0;
let errors = 0;
for (const line of output.split(/\r?\n/).filter(Boolean)) {
  const item = JSON.parse(line);
  if (item.reason !== "compiler-message") continue;
  const message = item.message;
  if (message.level === "error") errors++;
  if (message.level !== "warning") continue;
  warnings++;
  const span = message.spans.find((span) => span.is_primary);
  const warning = {
    file: span?.file_name ?? "",
    line: span?.line_start ?? 0,
    code: message.code?.code ?? "",
    message: message.message,
  };
  const signature = key(warning);
  const count = remaining.get(signature) ?? 0;
  if (count > 0) remaining.set(signature, count - 1);
  else {
    newWarnings++;
    process.stderr.write(`NEW WARNING ${signature}\n`);
  }
  process.stdout.write(`WARNING ${signature}\n`);
}
console.log(
  `Clippy: ${warnings} warnings (${newWarnings} new), ${errors} errors; debt baseline ${baseline.sourceCommit}.`
);
if (newWarnings || errors) process.exit(1);
