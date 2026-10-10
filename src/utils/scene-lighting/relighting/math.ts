import type {
  LightingRoute,
  SceneGeometry,
  ShaderSpec,
  SurfaceGeometry,
  SurfaceKind,
  SurfaceRoute,
  Vec2,
  Vec3,
} from "./types";
import { geometryReason, transformPoint } from "./geometry";
export function decodeSrgb(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
export function encodeSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}
function color(hex: string): Vec3 {
  return [0, 2, 4].map((i) =>
    decodeSrgb(parseInt(hex.slice(i + 1, i + 3), 16) / 255)
  ) as unknown as Vec3;
}
export function compileRelightingShaderSpec(
  route: LightingRoute,
  surface: SurfaceKind,
  scene: SceneGeometry,
  source: SurfaceGeometry | null,
  capability: "supported" | "unavailable"
): SurfaceRoute {
  if (route.kind !== "relighting") return route;
  const { params, master } = route;
  const identity = (reason: string): SurfaceRoute => ({
    kind: "identity",
    legacyAllowed: false,
    reason,
  });
  if (params.target !== "both" && params.target !== surface) return identity("target-miss");
  if (capability !== "supported") return identity("webgl-unavailable");
  const reason = geometryReason(source, scene);
  if (reason || !source) return identity(reason ?? "source-unavailable");
  const ambient =
    params.mode === "original"
      ? [1, 1, 1]
      : color(params.ambient.color).map((v) => v * params.ambient.intensity);
  return {
    kind: "webgl",
    legacyAllowed: false,
    spec: {
      sourceSizeCss: [...source.sizeCss],
      localToScene: [...source.localToScene],
      lightSceneCss: [
        params.point_light.x * scene.sizeCss[0],
        params.point_light.y * scene.sizeCss[1],
      ],
      radiusSceneCss: params.point_light.radius * Math.min(...scene.sizeCss),
      softness: params.point_light.softness,
      baseSignedLinear: ambient.map((v) => 1 - master + master * v) as unknown as Vec3,
      pointLinear: color(params.point_light.color).map((v) =>
        params.point_light.enabled ? master * v * params.point_light.intensity : 0
      ) as unknown as Vec3,
    },
  };
}
export function evaluateRelightingLinear(
  spec: ShaderSpec,
  localXY: Vec2,
  straightLinearRGB: Vec3
): Vec3 {
  const xy = transformPoint(spec.localToScene, localXY),
    d = Math.hypot(xy[0] - spec.lightSceneCss[0], xy[1] - spec.lightSceneCss[1]);
  let falloff = d < spec.radiusSceneCss ? 1 : 0;
  if (spec.softness > 0) {
    const t = Math.max(
      0,
      Math.min(
        1,
        (d - spec.radiusSceneCss * (1 - spec.softness)) / (spec.radiusSceneCss * spec.softness)
      )
    );
    falloff = 1 - t * t * (3 - 2 * t);
  }
  return straightLinearRGB.map((v, i) =>
    Math.max(
      0,
      Math.min(1, v * Math.max(0, spec.baseSignedLinear[i] + spec.pointLinear[i] * falloff))
    )
  ) as unknown as Vec3;
}
