import type { LightingAssetLayer, LightingParams } from "@/types/scene-lighting";
import { createNeutralLighting } from "./defaults";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Mirror lighting/normalize.rs. Missing fields keep serde defaults; non-finite
// values use the Rust normalization fallback (not necessarily the field default).
function number(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
function color(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(text)
    ? text.toLowerCase()
    : fallback;
}

const enums: Record<string, readonly string[]> = {
  shape: ["radial", "linear"],
  target: ["character", "background", "both"],
  blend_mode: ["normal", "screen", "add", "overlay", "soft_light", "multiply"],
  placement: ["behind", "front"],
  fit: ["cover", "contain", "stretch"],
};
function enumeration<T extends string>(value: unknown, key: string, fallback: T): T {
  return typeof value === "string" && enums[key].includes(value) ? (value as T) : fallback;
}

/** Defensive V2 rendering copy; legacy migration remains Rust's responsibility. */
export function normalizeLighting(input: unknown): LightingParams {
  const source = record(input);
  const result = createNeutralLighting();
  result.enabled = source.enabled === true;
  result.link_character_background =
    typeof source.link_character_background === "boolean" ? source.link_character_background : true;
  result.master_intensity = number(source.master_intensity, 0, 2, 1);
  for (const key of ["character", "background"] as const) {
    const from = record(source[key]);
    const to = result[key];
    to.brightness = number(from.brightness, 0.3, 2.2, 1);
    to.contrast = number(from.contrast, 0.5, 2, 1);
    to.saturation = number(from.saturation, 0, 2.5, 1);
    to.sepia = number(from.sepia, 0, 1, 0);
    to.glow_radius = Math.trunc(number(from.glow_radius, 0, 50, 0));
    to.glow_color = color(from.glow_color, to.glow_color);
  }
  for (const key of [
    "character_ambient",
    "background_ambient",
    "main_light",
    "rim_light",
    "bloom",
    "vignette",
  ] as const) {
    const from = record(source[key]);
    const to = result[key] as unknown as Record<string, unknown>;
    for (const field of Object.keys(to)) {
      if (!(field in from)) continue;
      const defaultValue = to[field];
      if (typeof defaultValue === "boolean") to[field] = from[field] === true;
      else if (typeof defaultValue === "number") {
        const pixels =
          (key === "rim_light" && ["width", "softness", "offset"].includes(field)) ||
          (key === "bloom" && field === "radius");
        const max =
          field === "angle"
            ? 360
            : pixels
              ? 64
              : key === "rim_light" && field === "intensity"
                ? 2
                : 1;
        to[field] = number(from[field], 0, max, 0);
      } else if (field.startsWith("color")) to[field] = color(from[field], defaultValue as string);
      else if (field in enums) to[field] = enumeration(from[field], field, defaultValue as string);
    }
  }
  result.asset_layers = Array.isArray(source.asset_layers)
    ? source.asset_layers.map((value): LightingAssetLayer => {
        const layer = record(value);
        const text = (key: string, fallback = "") =>
          typeof layer[key] === "string" ? (layer[key] as string) : fallback;
        return {
          id: text("id"),
          asset_hash: text("asset_hash"),
          media_type: text("media_type", "image/png"),
          target: enumeration(layer.target, "target", "both"),
          placement: enumeration(layer.placement, "placement", "behind"),
          blend_mode: enumeration(layer.blend_mode, "blend_mode", "normal"),
          fit: enumeration(layer.fit, "fit", "cover"),
          z_index: Math.trunc(number(layer.z_index, 0, 7, 0)),
          opacity: layer.opacity === undefined ? 1 : number(layer.opacity, 0, 1, 0),
          required: layer.required === true,
        };
      })
    : [];
  return result;
}
