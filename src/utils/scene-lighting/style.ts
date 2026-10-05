import type {
  BlendMode,
  LightingTarget,
  MainLightParams,
  LightingAssetLayer,
} from "@/types/scene-lighting";
import { normalizeLighting } from "./normalize";

export type LightingCss = Record<string, string | number>;
export interface CompiledLighting {
  filter: string;
  mainLight: LightingCss | null;
  ambient: LightingCss | null;
  bloom: LightingCss | null;
  vignette: LightingCss | null;
  /** URL resolution and slot-local sorting belong to the host components. */
  assets: { layer: LightingAssetLayer; style: LightingCss }[];
  warnings: "add-blend-fallback"[];
}

export interface LightingCompileOptions {
  /** Host probes capability and deduplicates warnings; compiler has no globals/IO. */
  supportsPlusLighter?: boolean;
}
const blends: Record<BlendMode, string> = {
  normal: "normal",
  screen: "screen",
  add: "plus-lighter",
  overlay: "overlay",
  soft_light: "soft-light",
  multiply: "multiply",
};

function alphaColor(color: string, intensity: number): string {
  if (intensity === 1) return color;
  let hex = color.slice(1);
  if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join("");
  const rgb = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  return `rgba(${rgb.join(", ")}, ${decimal(Math.min(1, alpha * intensity))})`;
}
function decimal(value: number): number {
  return Number(value.toFixed(6));
}
function mainGradient(light: MainLightParams): string {
  if (light.shape === "radial")
    return `radial-gradient(circle at ${decimal(light.x * 100)}% ${decimal(light.y * 100)}%, ${light.color_start} 0%, ${light.color_end} ${decimal(light.radius * 100)}%)`;
  // CSS angle: 0 points up, 90 right. Project center on a normalized square.
  const radians = (light.angle * Math.PI) / 180;
  const dx = Math.sin(radians),
    dy = -Math.cos(radians);
  const center =
    0.5 + ((light.x - 0.5) * dx + (light.y - 0.5) * dy) / (Math.abs(dx) + Math.abs(dy));
  const start = decimal(Math.max(0, center - light.radius / 2) * 100);
  const end = decimal(Math.min(1, center + light.radius / 2) * 100);
  return `linear-gradient(${light.angle}deg, ${light.color_start} ${start}%, ${light.color_end} ${end}%)`;
}

/** `both` is the single overall slot, not a wildcard: never double-compose it. */
export function compileLighting(
  input: unknown,
  surface: LightingTarget,
  options: LightingCompileOptions = {}
): CompiledLighting {
  const lighting = normalizeLighting(input);
  if (
    !lighting.enabled ||
    lighting.master_intensity === 0 ||
    !["character", "background", "both"].includes(surface)
  ) {
    return {
      filter: "none",
      mainLight: null,
      ambient: null,
      bloom: null,
      vignette: null,
      assets: [],
      warnings: [],
    };
  }
  const parts: string[] = [];
  const master = lighting.master_intensity;
  const strength = (value: number) => decimal(Math.min(1, value * master));
  if (surface !== "both") {
    const source = lighting[surface];
    const c = {
      ...source,
      brightness: decimal(Math.max(0.3, Math.min(2.2, 1 + (source.brightness - 1) * master))),
      contrast: decimal(Math.max(0.5, Math.min(2, 1 + (source.contrast - 1) * master))),
      saturation: decimal(Math.max(0, Math.min(2.5, 1 + (source.saturation - 1) * master))),
      sepia: strength(source.sepia),
      glow_color: alphaColor(source.glow_color, master),
    };
    if (c.brightness !== 1) parts.push(`brightness(${c.brightness})`);
    if (c.contrast !== 1) parts.push(`contrast(${c.contrast})`);
    if (c.saturation !== 1) parts.push(`saturate(${c.saturation})`);
    if (c.glow_radius > 0) parts.push(`drop-shadow(0 0 ${c.glow_radius}px ${c.glow_color})`);
    if (c.sepia > 0) parts.push(`sepia(${c.sepia})`);
  }
  const rim = lighting.rim_light;
  if (surface === "character" && rim.enabled && rim.intensity * master > 0) {
    const angle = (rim.angle * Math.PI) / 180;
    const color = alphaColor(rim.color, rim.intensity * master);
    for (const distance of [rim.offset, rim.offset + rim.width]) {
      const x = decimal(Math.sin(angle) * distance),
        y = decimal(-Math.cos(angle) * distance);
      parts.push(`drop-shadow(${x}px ${y}px ${rim.softness}px ${color})`);
    }
  }
  const warnings: CompiledLighting["warnings"] = [];
  const blend = (mode: BlendMode) => {
    if (mode === "add" && options.supportsPlusLighter === false) {
      if (!warnings.length) warnings.push("add-blend-fallback");
      return "screen";
    }
    return blends[mode];
  };
  const mainLight =
    lighting.main_light.target === surface &&
    lighting.main_light.enabled &&
    lighting.main_light.opacity > 0
      ? {
          background: mainGradient(lighting.main_light),
          mixBlendMode: blend(lighting.main_light.blend_mode),
          opacity: strength(lighting.main_light.opacity),
        }
      : null;
  const b = lighting.bloom;
  const bloomActive = b.enabled && b.target === surface && strength(b.intensity) > 0;
  if (surface === "character" && bloomActive)
    parts.push(`drop-shadow(0 0 ${b.radius}px ${alphaColor(b.color, b.intensity * master)})`);
  const bloom =
    surface !== "character" && bloomActive
      ? {
          background: `radial-gradient(circle, ${b.color} 0%, transparent 100%)`,
          filter: `blur(${b.radius}px)`,
          mixBlendMode: "screen",
          opacity: strength(b.intensity),
        }
      : null;
  const ambientParams = surface === "both" ? null : lighting[`${surface}_ambient`];
  const ambient =
    ambientParams?.enabled && strength(ambientParams.opacity) > 0
      ? {
          background: ambientParams.color,
          mixBlendMode: "multiply",
          opacity: strength(ambientParams.opacity),
        }
      : null;
  const v = lighting.vignette;
  const vignette =
    surface === "both" && v.enabled && strength(v.intensity) > 0
      ? {
          background: `radial-gradient(ellipse at center, transparent ${decimal(v.radius * 100)}%, ${v.color} ${decimal(Math.min(1, v.radius + v.softness) * 100)}%)`,
          opacity: strength(v.intensity),
        }
      : null;
  const assets = lighting.asset_layers
    .filter(
      (layer) =>
        layer.target === surface && strength(layer.opacity) > 0 && layer.media_type === "image/png"
    )
    .map((layer) => ({
      layer,
      style: {
        objectFit: layer.fit === "stretch" ? "fill" : layer.fit,
        opacity: strength(layer.opacity),
        mixBlendMode: blend(layer.blend_mode),
        zIndex: layer.z_index,
      },
    }));
  return {
    filter: parts.join(" ") || "none",
    mainLight,
    ambient,
    bloom,
    vignette,
    assets,
    warnings,
  };
}
