import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("clippy debt baseline permits known warnings but fails new warning occurrences", () => {
  const root = mkdtempSync(join(tmpdir(), "lingchat-clippy-test-"));
  try {
    const input = join(root, "diagnostics.jsonl");
    const baseline = JSON.parse(readFileSync("scripts/ci/clippy-baseline.json", "utf8"));
    const known = baseline.warnings[0];
    const message = {
      reason: "compiler-message",
      message: {
        level: "warning",
        message: known.message,
        code: { code: known.code },
        spans: [{ is_primary: true, file_name: known.file, line_start: known.line }],
      },
    };
    writeFileSync(input, JSON.stringify(message) + "\n");
    expect(() =>
      execFileSync(process.execPath, ["scripts/ci/check-clippy.mjs", "--diagnostics", input], {
        stdio: "pipe",
      })
    ).not.toThrow();
    message.message.message = "new warning not in immutable debt baseline";
    writeFileSync(input, JSON.stringify(message) + "\n");
    const result = spawnSync(
      process.execPath,
      ["scripts/ci/check-clippy.mjs", "--diagnostics", input],
      { encoding: "utf8" }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEW WARNING");
    message.message.message = known.message;
    writeFileSync(input, (JSON.stringify(message) + "\n").repeat(known.count + 1));
    const duplicate = spawnSync(
      process.execPath,
      ["scripts/ci/check-clippy.mjs", "--diagnostics", input],
      { encoding: "utf8" }
    );
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("NEW WARNING");
    message.message.level = "error";
    writeFileSync(input, JSON.stringify(message) + "\n");
    const error = spawnSync(
      process.execPath,
      ["scripts/ci/check-clippy.mjs", "--diagnostics", input],
      { encoding: "utf8" }
    );
    expect(error.status).toBe(1);
    expect(error.stdout).toContain("1 errors");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
