import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Exercise the unchanged Rust resolver body, not a hand-authored canonical path. */
export function nativeLightingAssetFixture() {
  const temp = mkdtempSync(join(tmpdir(), "lighting canonical-"));
  try {
    const dataDir = join(temp, "光影 Unicode spaces", ...Array<string>(3).fill("long-".repeat(16)));
    const assets = join(dataDir, "game_data", "lighting_assets");
    mkdirSync(assets, { recursive: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64"
    );
    const hash = createHash("sha256").update(png).digest("hex");
    writeFileSync(join(assets, `${hash}.png`), png);
    const source = readFileSync(resolve("src-tauri/src/api/scene_lighting/asset.rs"), "utf8");
    const start = source.indexOf("pub(crate) fn resolve_lighting_asset_in");
    const end = source.indexOf("#[tauri::command]", start);
    if (start < 0 || end < start) throw new Error("Native resolver source boundary changed");
    const harness = join(temp, "canonical.rs");
    const executable = join(temp, process.platform === "win32" ? "canonical.exe" : "canonical");
    writeFileSync(
      harness,
      `use std::path::{Path, PathBuf};\n${source.slice(start, end)}\nfn main() {
        let args: Vec<String> = std::env::args().collect();
        let path = resolve_lighting_asset_in(Path::new(&args[1]), &args[2]).unwrap();
        print!("{}", path.to_string_lossy());
      }`
    );
    execFileSync("rustc", ["--edition=2021", harness, "-o", executable]);
    const path = execFileSync(executable, [dataDir, hash], { encoding: "utf8" });
    // Verify the produced native path still opens the actual PNG.
    if (!readFileSync(path).equals(png)) throw new Error("Canonical PNG bytes differ");
    return { hash, path, dispose: () => rmSync(temp, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}
