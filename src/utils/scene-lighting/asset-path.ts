import type { ResolvedLightingAsset } from "@/types/scene-lighting";

/** Only for native resolver DTOs: canonical root containment remains a Rust responsibility. */
export function resolvedLightingAssetPath(
  result: ResolvedLightingAsset | null,
  expectedHash: string
): string | null {
  if (result?.hash !== expectedHash || !result.supported || result.warning) return null;
  let path = result.asset_protocol_path;
  if (!path) return null;
  // Rust canonicalize on Windows returns a verbatim drive path, not a URL or UNC path.
  if (/^\\\\\?\\[A-Za-z]:\\/.test(path)) path = path.slice(4);
  const drivePath = /^[A-Za-z]:[\\/]/.test(path);
  if (!drivePath && !/^\/(?!\/)/.test(path)) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  if (drivePath) path = path.replace(/\\/g, "/");
  const segments = path.slice(drivePath ? 3 : 1).split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) return null;
  if (
    drivePath &&
    segments.some(
      (part) =>
        /[<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
  ) {
    return null;
  }
  // Backslash-bearing Unix DTOs are ambiguous across desktop protocol implementations.
  return !drivePath && path.includes("\\") ? null : path;
}
