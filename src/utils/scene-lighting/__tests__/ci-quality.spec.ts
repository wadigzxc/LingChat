import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as prettier from "prettier";

// Parse with the already-installed YAML parser; do not regex-parse workflows.
function decode(node: any): any {
  if (node.type === "mapping" || node.type === "flowMapping") {
    return Object.fromEntries(node.children.map((entry: any) => entry.children.map(decode)));
  }
  if (node.type === "sequence" || node.type === "flowSequence") {
    return node.children.map(decode);
  }
  if ("value" in node) return node.value;
  const children = node.children?.filter((child: any) => child.type !== "documentHead") ?? [];
  return children.length === 1 ? decode(children[0]) : children.map(decode);
}
async function workflow(name: string) {
  const source = readFileSync(`.github/workflows/${name}`, "utf8");
  const { ast } = await (prettier as any).__debug.parse(source, { parser: "yaml" });
  return decode(ast);
}
describe("desktop quality gate", () => {
  it.each([
    { outcomes: ["success", "success"], release: true },
    { outcomes: ["failure", "success"], release: false },
    { outcomes: ["success", "failure"], release: false },
    { outcomes: ["cancelled", "success"], release: false },
    { outcomes: ["success", "cancelled"], release: false },
    { outcomes: ["skipped", "success"], release: false },
  ])("release dependency contract for quality=$outcomes", async ({ outcomes, release }) => {
    for (const name of ["dev-build.yml", "dev-build-full.yml"]) {
      const config = await workflow(name);
      expect(config.permissions).toEqual({ contents: "read" });
      expect(config.jobs.build.needs).toBe("quality");
      // GitHub's default job/step condition is success(); no override may bypass needs.
      expect(config.jobs.build.if).toBeUndefined();
      expect(config.jobs.quality.if).toBeUndefined();
      for (const job of Object.values(config.jobs) as any[]) {
        expect(job["continue-on-error"]).toBeUndefined();
        for (const step of job.steps) {
          expect(step["continue-on-error"]).toBeUndefined();
          if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
          expect(step.if ?? "").not.toMatch(/always\(|failure\(|cancelled\(/);
        }
      }
      const dependencies: Record<string, string[]> = { quality: outcomes };
      const needs = [config.jobs.build.needs].flat();
      const enabledByDefaultCondition = needs.every((name) =>
        dependencies[name].every((state) => state === "success")
      );
      expect(enabledByDefaultCondition).toBe(release);
    }
  });
  it("keeps clippy diagnostics without suppressing new warnings", async () => {
    const config = await workflow("dev-build.yml");
    expect(
      config.jobs.quality.steps.some((step: any) => step.run === "node scripts/ci/check-clippy.mjs")
    ).toBe(true);
  });
  it("runs Rust and archive safety on Windows and Linux before the desktop matrix", async () => {
    const config = await workflow("dev-build.yml");
    const job = config.jobs.quality;
    expect(job.strategy?.matrix?.os).toEqual(["ubuntu-latest", "windows-latest"]);
    expect(job["runs-on"]).toBe("${{ matrix.os }}");
    const commands = job.steps.map((step: any) => step.run ?? "").join("\n");
    for (const command of [
      "pnpm install --frozen-lockfile",
      "pnpm test",
      "pnpm typecheck",
      "pnpm build",
      "node scripts/prepare-desktop-resources.mjs --staging-only",
      "cargo test --manifest-path src-tauri/Cargo.toml --lib",
    ]) {
      expect(commands).toContain(command);
    }
    expect(job.env).toMatchObject({
      CARGO_BUILD_JOBS: "1",
      CARGO_PROFILE_TEST_DEBUG: "0",
      CARGO_INCREMENTAL: "1",
    });
    expect(config.jobs.build.needs).toBe("quality");
  });
  it("gates full release artifacts with the same quality matrix and read-only token", async () => {
    const normal = await workflow("dev-build.yml");
    const full = await workflow("dev-build-full.yml");
    expect(full.jobs.quality).toEqual(normal.jobs.quality);
    expect(full.jobs.build.needs).toBe("quality");
    expect(full.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(full.jobs) as any[]) {
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
    expect(
      full.jobs.build.steps.some((step: any) => step.run === "pnpm install --frozen-lockfile")
    ).toBe(true);
  });
});
