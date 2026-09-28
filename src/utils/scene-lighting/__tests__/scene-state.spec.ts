import { describe, expect, it } from "vitest";

import type { SceneStatePayload } from "@/types/scene-lighting";
import { lighting, scene } from "@/test/scene-lighting-fixtures";
import {
  applySceneStatePayload,
  cloneLightingOrNeutral,
  createNeutralLighting,
  type SceneStateMirror,
} from "@/utils/scene-lighting/scene-state";

function mirror(): SceneStateMirror {
  return {
    currentScene: scene("old"),
    currentBackground: "old.png",
    activeLighting: lighting(0.5),
    activeLightingSource: "manual_custom",
    activeLightingPresetId: "preset:old",
    activeLightingPresetRevision: 1,
    activeLightingCustomized: true,
    lightingRevision: 4,
  };
}

function payload(revision = 5): SceneStatePayload {
  const current = scene("scene-1", lighting(1.25));
  return {
    scene: {
      id: current.id,
      name: current.scene_name,
      description: current.scene_description,
      background: "scene-1.png",
      lighting: current.lighting,
      lighting_preset_id: current.lighting_preset_id,
      lighting_preset_revision: current.lighting_preset_revision,
      lighting_customized: current.lighting_customized,
      created_at: current.created_at,
      updated_at: current.updated_at,
      plugin_id: current.plugin_id,
    },
    background: "resolved/scene-1.png",
    active_lighting: lighting(1.25),
    source: "manual_preset",
    preset_id: "preset:new",
    preset_revision: 7,
    customized: false,
    lighting_revision: revision,
  };
}

describe("applySceneStatePayload", () => {
  it("atomically projects the full authoritative payload without mutating inputs", () => {
    const before = mirror();
    const event = payload();
    const frozen = JSON.parse(JSON.stringify(event));

    const result = applySceneStatePayload(before, event);

    expect(result).toEqual({
      currentScene: {
        id: "scene-1",
        scene_name: "scene-1",
        scene_description: "",
        background: "resolved/scene-1.png",
        lighting: event.scene?.lighting,
        lighting_preset_id: "preset:base",
        lighting_preset_revision: 2,
        lighting_customized: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        source: "game",
        plugin_id: null,
      },
      currentBackground: event.background,
      activeLighting: event.active_lighting,
      activeLightingSource: event.source,
      activeLightingPresetId: event.preset_id,
      activeLightingPresetRevision: event.preset_revision,
      activeLightingCustomized: event.customized,
      lightingRevision: event.lighting_revision,
    });
    expect(result).not.toBe(before);
    expect(event).toEqual(frozen);
    expect(before.lightingRevision).toBe(4);
  });

  it.each([3, 4])("drops revision %s when current revision is 4", (revision) => {
    const before = mirror();
    expect(applySceneStatePayload(before, payload(revision))).toBe(before);
  });

  it("updates the same scene id when the revision is newer", () => {
    const before = mirror();
    before.currentScene = scene("scene-1", lighting(0.5));
    const result = applySceneStatePayload(before, payload(5));
    expect(result.currentScene?.id).toBe("scene-1");
    expect(result.activeLighting.master_intensity).toBe(1.25);
    expect(result.lightingRevision).toBe(5);
  });

  it("clears scene and background while accepting neutral lighting", () => {
    const event: SceneStatePayload = {
      ...payload(5),
      scene: null,
      background: "",
      active_lighting: createNeutralLighting(),
      source: "neutral",
      preset_id: null,
      preset_revision: null,
      customized: false,
    };
    const result = applySceneStatePayload(mirror(), event);
    expect(result.currentScene).toBeNull();
    expect(result.currentBackground).toBe("");
    expect(result.activeLighting).toEqual(createNeutralLighting());
  });
});

describe("cloneLightingOrNeutral", () => {
  it("preserves V2 fields hidden by the legacy scene editor without mutating the source", () => {
    const source = lighting(1.2);
    source.rim_light = { ...source.rim_light, enabled: true, intensity: 1.4 };
    source.asset_layers.push({
      id: "flare",
      asset_hash: "a".repeat(64),
      media_type: "image/png",
      target: "both",
      placement: "front",
      z_index: 2,
      opacity: 0.8,
      blend_mode: "screen",
      fit: "cover",
      required: false,
    });

    const draft = cloneLightingOrNeutral(source);
    draft.character.brightness = 0.5;

    expect(draft.rim_light.intensity).toBe(1.4);
    expect(draft.asset_layers).toHaveLength(1);
    expect(source.character.brightness).toBe(1);
  });
});
