import { normalizeLighting } from "../normalize";
import type { LightingRoute } from "./types";

/** Single route for all producers; target/capability misses cannot re-enable legacy. */
export function resolveLightingRoute(snapshot: unknown, compareBypass = false): LightingRoute {
  const lighting = normalizeLighting(snapshot);
  if (compareBypass || !lighting.enabled || lighting.master_intensity === 0)
    return {
      kind: "identity",
      legacyAllowed: false,
      reason: compareBypass ? "compare-bypass" : !lighting.enabled ? "disabled" : "zero-master",
    };
  if (!lighting.relighting?.enabled) return { kind: "legacy", legacyAllowed: true };
  return {
    kind: "relighting",
    legacyAllowed: false,
    master: lighting.master_intensity,
    params: lighting.relighting,
  };
}
