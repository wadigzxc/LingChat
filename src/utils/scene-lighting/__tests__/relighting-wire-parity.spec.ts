import { describe, expect, it } from "vitest";
import type { CastRuntimeLighting } from "@/types/scene-lighting";
import wireCases from "./relighting-wire-cases.json";
import { createNeutralLighting } from "../defaults";
import { normalizeLighting } from "../normalize";
import { createRelightingParams } from "../relighting-params";
import {
  applyCastRuntimeLighting,
  applySceneStatePayload,
  cloneLightingOrNeutral,
  type SceneStateMirror,
} from "../scene-state";

// 共享输入涵盖 typed wire 拒绝域；TS 防御投影通过不表示 Rust 接受错误 JSON。
describe("relighting defensive projection shared wire fixtures", () => {
  it.each(wireCases.cases)("projects $id", (row) => {
    const before = JSON.stringify(row.input);
    const result = normalizeLighting(row.input);
    if (row.expected_relighting === null) expect("relighting" in result).toBe(false);
    else expect(result.relighting).toEqual(row.expected_relighting);
    expect(JSON.stringify(row.input)).toBe(before);
  });
});

it("keeps old neutral snapshots absent and byte-identical after normalization", () => {
  const neutral = createNeutralLighting();
  const before = JSON.stringify(neutral);
  expect("relighting" in neutral).toBe(false);
  expect(JSON.stringify(normalizeLighting(neutral))).toBe(before);
  expect("relighting" in cloneLightingOrNeutral(neutral)).toBe(false);
  expect("relighting" in normalizeLighting({ relighting: null })).toBe(false);
});

it("returns independent factory blocks rather than sharing nested defaults", () => {
  const first = createRelightingParams();
  const second = createRelightingParams();
  first.ambient.color = "#000000";
  first.point_light.x = 0;
  expect(second).toEqual(wireCases.factory);
});

it("preserves a new block through JSON and cloned scene snapshots without aliasing", () => {
  const source = normalizeLighting(
    wireCases.cases.find((row) => row.id === "canonical-relight-character")!.input
  );
  const roundtrip = JSON.parse(JSON.stringify(source));
  const cloned = cloneLightingOrNeutral(roundtrip);
  expect(cloned).toEqual(source);
  cloned.relighting!.point_light.x = 1;
  expect(source.relighting!.point_light.x).toBe(0.2);
  expect(roundtrip.relighting.point_light.x).toBe(0.2);
});

function state(): SceneStateMirror {
  return {
    currentScene: null,
    currentBackground: "",
    activeLighting: createNeutralLighting(),
    activeLightingSource: "neutral",
    activeLightingPresetId: null,
    activeLightingPresetRevision: null,
    activeLightingCustomized: false,
    lightingRevision: 0,
  };
}

it("carries a relighting block through the actual scene-state projection", () => {
  const lighting = normalizeLighting(
    wireCases.cases.find((row) => row.id === "canonical-relight-character")!.input
  );
  const projected = applySceneStatePayload(state(), {
    scene: null,
    background: "scene.webp",
    active_lighting: lighting,
    source: "manual",
    preset_id: null,
    preset_revision: null,
    customized: true,
    lighting_revision: 1,
  });
  expect(projected.activeLighting.relighting).toEqual(lighting.relighting);
  expect(projected.activeLighting.relighting).not.toBe(lighting.relighting);
  projected.activeLighting.relighting!.ambient.intensity = 0;
  expect(lighting.relighting!.ambient.intensity).toBe(0.25);
});

it("carries a relighting block through the actual cast mirror projection", () => {
  const lighting = normalizeLighting(
    wireCases.cases.find((row) => row.id === "canonical-relight-character")!.input
  );
  const mirror: CastRuntimeLighting = {
    currentSceneId: null,
    background: "scene.webp",
    activeLighting: lighting,
    activeLightingSource: "manual",
    activeLightingPresetId: null,
    activeLightingPresetRevision: null,
    activeLightingCustomized: true,
    lightingRevision: 1,
  };
  const projected = applyCastRuntimeLighting(state(), mirror, null);
  expect(projected.activeLighting).toEqual(lighting);
  expect(projected.activeLighting.relighting).not.toBe(mirror.activeLighting.relighting);
});
