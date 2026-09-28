import { describe, expect, it } from "vitest";

import { applyCastRuntimeLighting } from "@/utils/scene-lighting/scene-state";
import { lighting, scene } from "@/test/scene-lighting-fixtures";

function castMirror(revision: number, intensity: number) {
  return {
    currentSceneId: "scene-1",
    background: "resolved.png",
    activeLighting: lighting(intensity),
    activeLightingSource: "manual_custom" as const,
    activeLightingPresetId: "user:cast",
    activeLightingPresetRevision: 3,
    activeLightingCustomized: true,
    lightingRevision: revision,
  };
}

describe("cast runtime lighting mirror", () => {
  it("updates the same scene id on a newer revision", () => {
    const current = {
      currentScene: scene(),
      currentBackground: "old.png",
      activeLighting: lighting(0.5),
      activeLightingSource: "scene_default" as const,
      activeLightingPresetId: null,
      activeLightingPresetRevision: null,
      activeLightingCustomized: false,
      lightingRevision: 8,
    };
    const result = applyCastRuntimeLighting(current, castMirror(9, 1.5), scene());
    expect(result.lightingRevision).toBe(9);
    expect(result.activeLighting.master_intensity).toBe(1.5);
  });

  it("drops old and out-of-order cast mirrors by lighting revision", () => {
    const current = {
      currentScene: scene(),
      currentBackground: "current.png",
      activeLighting: lighting(1),
      activeLightingSource: "scene_default" as const,
      activeLightingPresetId: null,
      activeLightingPresetRevision: null,
      activeLightingCustomized: false,
      lightingRevision: 8,
    };
    expect(applyCastRuntimeLighting(current, castMirror(8, 2), scene())).toBe(current);
    expect(applyCastRuntimeLighting(current, castMirror(7, 2), scene())).toBe(current);
  });
});
