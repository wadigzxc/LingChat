import { expect, it } from "vitest";
import { createNeutralLighting } from "../../defaults";
import { createRelightingParams } from "../../relighting-params";
import { resolveLightingRoute } from "../route";
import {
  compileRelightingShaderSpec,
  decodeSrgb,
  encodeSrgb,
  evaluateRelightingLinear,
} from "../math";
import { geometryReason } from "../geometry";
const scene = { sizeCss: [200, 100] as const },
  source = { sizeCss: [20, 40] as const, localToScene: [-2, 0, 0, 0.5, 70, 10] as const };
function enabled() {
  const s = createNeutralLighting();
  s.enabled = true;
  s.relighting = { ...createRelightingParams(), enabled: true };
  return s;
}
it("uses one priority route without mutating snapshots or creating absent blocks", () => {
  const s = enabled(),
    before = structuredClone(s);
  expect(resolveLightingRoute(s, true)).toMatchObject({ kind: "identity", legacyAllowed: false });
  s.master_intensity = 0;
  expect(resolveLightingRoute(s)).toMatchObject({ kind: "identity", legacyAllowed: false });
  s.master_intensity = 1;
  s.enabled = false;
  expect(resolveLightingRoute(s)).toMatchObject({ kind: "identity", legacyAllowed: false });
  s.enabled = true;
  s.relighting!.enabled = false;
  expect(resolveLightingRoute(s)).toEqual({ kind: "legacy", legacyAllowed: true });
  const old = createNeutralLighting();
  old.enabled = true;
  expect(resolveLightingRoute(old)).toEqual({ kind: "legacy", legacyAllowed: true });
  expect(old.relighting).toBeUndefined();
  expect(resolveLightingRoute(before)).toMatchObject({ kind: "relighting", legacyAllowed: false });
  expect(before.relighting!.enabled).toBe(true);
});
it("both is two independently selected source kinds; a miss never restores legacy", () => {
  for (const target of ["character", "background", "both"] as const) {
    const s = enabled();
    s.relighting!.target = target;
    for (const surface of ["character", "background"] as const) {
      const route = compileRelightingShaderSpec(
        resolveLightingRoute(s),
        surface,
        scene,
        source,
        "supported"
      );
      expect(route.kind).toBe(target === surface || target === "both" ? "webgl" : "identity");
      expect(route.legacyAllowed).toBe(false);
    }
  }
  expect(
    compileRelightingShaderSpec(
      resolveLightingRoute(enabled()),
      "character",
      scene,
      source,
      "unavailable"
    )
  ).toEqual({ kind: "identity", legacyAllowed: false, reason: "webgl-unavailable" });
});
it("compiles signed B and C without early clamps, including L.5 and L11", () => {
  for (const [ambient, point, gain] of [
    [0, 0.75, 0.5],
    [2, 4, 11],
  ]) {
    const s = enabled();
    s.master_intensity = 2;
    s.relighting!.mode = "relight";
    s.relighting!.ambient = { color: "#ffffff", intensity: ambient };
    s.relighting!.point_light = {
      ...s.relighting!.point_light,
      color: "#ffffff",
      intensity: point,
      radius: 2,
      softness: 0,
    };
    const r = compileRelightingShaderSpec(
      resolveLightingRoute(s),
      "character",
      scene,
      source,
      "supported"
    );
    expect(r.kind).toBe("webgl");
    if (r.kind !== "webgl") throw Error("unavailable");
    expect(r.spec.baseSignedLinear).toEqual([2 * ambient - 1, 2 * ambient - 1, 2 * ambient - 1]);
    expect(r.spec.pointLinear).toEqual([2 * point, 2 * point, 2 * point]);
    expect(evaluateRelightingLinear(r.spec, [0, 0], [0.01, 0.02, 0.03])).toEqual([
      0.01 * gain,
      0.02 * gain,
      0.03 * gain,
    ]);
  }
});
it("original ignores ambient but still applies point; radius is scene-relative", () => {
  const s = enabled();
  s.relighting!.ambient = { color: "#000000", intensity: 0 };
  const r = compileRelightingShaderSpec(
    resolveLightingRoute(s),
    "character",
    scene,
    source,
    "supported"
  );
  if (r.kind !== "webgl") throw Error("unavailable");
  expect(r.spec.baseSignedLinear).toEqual([1, 1, 1]);
  expect(r.spec.radiusSceneCss).toBe(75);
  expect(r.spec.localToScene).toEqual(source.localToScene);
  s.relighting!.point_light.enabled = false;
  const off = compileRelightingShaderSpec(
    resolveLightingRoute(s),
    "character",
    scene,
    source,
    "supported"
  );
  if (off.kind === "webgl") expect(off.spec.pointLinear).toEqual([0, 0, 0]);
});
it("IEC piecewise functions round-trip byte values including the breakpoints", () => {
  for (let i = 0; i <= 255; i++) expect(encodeSrgb(decodeSrgb(i / 255))).toBeCloseTo(i / 255, 12);
});
it("hard edge is strict d<r; signed negative gain becomes zero after point addition", () => {
  const spec = {
    sourceSizeCss: [10, 10] as const,
    localToScene: [1, 0, 0, 1, 0, 0] as const,
    lightSceneCss: [0, 0] as const,
    radiusSceneCss: 1,
    softness: 0,
    baseSignedLinear: [-1, -1, -1] as const,
    pointLinear: [2, 2, 2] as const,
  };
  expect(evaluateRelightingLinear(spec, [1, 0], [0.25, 0.25, 0.25])).toEqual([0, 0, 0]);
  expect(evaluateRelightingLinear(spec, [0.999, 0], [0.25, 0.25, 0.25])).toEqual([
    0.25, 0.25, 0.25,
  ]);
  expect(evaluateRelightingLinear({ ...spec, softness: 1 }, [0.5, 0], [0.25, 0.25, 0.25])).toEqual([
    0, 0, 0,
  ]);
});
it("accepts axis translation/scale/mirror but rejects unknown, singular and zero geometry", () => {
  expect(geometryReason(source, scene)).toBeNull();
  expect(geometryReason({ ...source, localToScene: [1, 1, 0, 1, 0, 0] }, scene)).toBe(
    "unsupported-transform"
  );
  expect(geometryReason({ ...source, localToScene: [0, 0, 0, 1, 0, 0] }, scene)).toBe(
    "singular-transform"
  );
  expect(geometryReason({ ...source, sizeCss: [0, 5] }, scene)).toBe("zero-geometry");
  expect(geometryReason({ ...source, reason: "unsupported-transform" }, scene)).toBe(
    "unsupported-transform"
  );
  expect(
    compileRelightingShaderSpec(
      resolveLightingRoute(enabled()),
      "character",
      scene,
      null,
      "supported"
    )
  ).toEqual({ kind: "identity", legacyAllowed: false, reason: "source-unavailable" });
});
