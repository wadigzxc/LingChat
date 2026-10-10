import type { RelightingParams } from "@/types/scene-lighting";

/** 创建显式新块；旧场景的 neutral factory 不调用它，避免开窗就产生草稿变化。 */
export function createRelightingParams(): RelightingParams {
  return {
    enabled: false,
    mode: "original",
    target: "both",
    ambient: { intensity: 1, color: "#ffffff" },
    point_light: {
      enabled: true,
      x: 0.5,
      y: 0.5,
      radius: 0.75,
      softness: 0.8,
      intensity: 0.85,
      color: "#fff1d2",
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function number(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function color(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  // 受光颜色不带 alpha；旧滤镜的 #RGB/#RGBA/#RRGGBBAA 规则保持独立。
  return /^#[\da-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

/** 防御渲染副本；missing/null 不制造可选块，typed wire 的拒绝域由 Rust 处理。 */
export function normalizeRelightingParams(input: unknown): RelightingParams | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  const source = record(input);
  const result = createRelightingParams();
  result.enabled = boolean(source.enabled, result.enabled);
  if (source.mode === "original" || source.mode === "relight") result.mode = source.mode;
  if (source.target === "character" || source.target === "background" || source.target === "both") {
    result.target = source.target;
  }
  const ambient = record(source.ambient);
  result.ambient.intensity = number(ambient.intensity, 0, 2, result.ambient.intensity);
  result.ambient.color = color(ambient.color, result.ambient.color);
  const point = record(source.point_light);
  result.point_light.enabled = boolean(point.enabled, result.point_light.enabled);
  const pointRanges = {
    x: [0, 1],
    y: [0, 1],
    radius: [0.01, 2],
    softness: [0, 1],
    intensity: [0, 4],
  } as const;
  for (const field of ["x", "y", "radius", "softness", "intensity"] as const) {
    const [min, max] = pointRanges[field];
    result.point_light[field] = number(point[field], min, max, result.point_light[field]);
  }
  result.point_light.color = color(point.color, result.point_light.color);
  return result;
}
