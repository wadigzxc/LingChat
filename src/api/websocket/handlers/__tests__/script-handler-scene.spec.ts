import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { applySceneChangeMessage } from "@/api/websocket/handlers/script-handler";
import { useGameStore } from "@/stores/modules/game";
import { useUIStore } from "@/stores/modules/ui/ui";
import { lighting, scene } from "@/test/scene-lighting-fixtures";

function completePayload() {
  return {
    scene: scene("next"),
    background: "next.png",
    active_lighting: lighting(2),
    source: "manual",
    preset_id: null,
    preset_revision: null,
    customized: true,
    lighting_revision: 10,
  };
}

function expectSceneStateUnchanged(lightingRevision = 9) {
  const game = useGameStore();
  const ui = useUIStore();
  expect(game.currentScene?.id).toBe("current");
  expect(ui.currentBackground).toBe("current.png");
  expect(game.activeLighting.master_intensity).toBe(1.5);
  expect(game.activeLightingSource).toBe("manual");
  expect(game.lightingRevision).toBe(lightingRevision);
}

describe("legacy websocket scene_change compatibility", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("routes a complete payload through the authoritative revision reducer", () => {
    const game = useGameStore();
    const ui = useUIStore();
    game.lightingRevision = 8;
    game.activeLighting = lighting(1);
    ui.setCurrentBackground("current.png");

    applySceneChangeMessage({
      scene: scene("stale"),
      background: "stale.png",
      active_lighting: lighting(2),
      source: "manual",
      preset_id: null,
      preset_revision: null,
      customized: true,
      lighting_revision: 8,
    });

    expect(game.currentScene).toBeNull();
    expect(game.activeLighting.master_intensity).toBe(1);
    expect(game.lightingRevision).toBe(8);
    expect(ui.currentBackground).toBe("current.png");
  });

  it("rejects a partial revisioned payload instead of downgrading it to legacy state", () => {
    const game = useGameStore();
    const ui = useUIStore();
    game.currentScene = scene("current");
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual";
    game.lightingRevision = 9;
    ui.setCurrentBackground("current.png");

    applySceneChangeMessage({
      scene: scene("partial"),
      background: "partial.png",
      lighting_revision: 10,
    });

    expect(game.currentScene?.id).toBe("current");
    expect(ui.currentBackground).toBe("current.png");
    expect(game.activeLighting.master_intensity).toBe(1.5);
    expect(game.lightingRevision).toBe(9);
  });

  it.each([NaN, Infinity, 1e308, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects malformed lighting revision %s",
    (lighting_revision) => {
      const game = useGameStore();
      const ui = useUIStore();
      game.currentScene = scene("current");
      game.activeLighting = lighting(1.5);
      game.activeLightingSource = "manual";
      game.lightingRevision = 9;
      ui.setCurrentBackground("current.png");

      applySceneChangeMessage({ ...completePayload(), lighting_revision });

      expectSceneStateUnchanged();
    }
  );

  it("rejects an unknown lighting source", () => {
    const game = useGameStore();
    const ui = useUIStore();
    game.currentScene = scene("current");
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual";
    game.lightingRevision = 9;
    ui.setCurrentBackground("current.png");

    applySceneChangeMessage({ ...completePayload(), source: "remote" });

    expectSceneStateUnchanged();
  });

  it.each([
    {},
    { ...lighting(2), character: {} },
    { ...lighting(2), main_light: { ...lighting(2).main_light, opacity: NaN } },
  ])("rejects malformed active lighting %#", (active_lighting) => {
    const game = useGameStore();
    const ui = useUIStore();
    game.currentScene = scene("current");
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual";
    game.lightingRevision = 9;
    ui.setCurrentBackground("current.png");

    applySceneChangeMessage({ ...completePayload(), active_lighting });

    expectSceneStateUnchanged();
  });

  it.each([
    { scene: {} },
    { scene: [] },
    { scene: "next" },
    { scene: { ...scene("next"), lighting_preset_revision: 1.5 } },
    { scene: { ...scene("next"), background: 42 } },
    { scene: { ...scene("next"), lighting: {} } },
    { background: null },
    { preset_id: 42 },
    { preset_revision: -1 },
    { preset_revision: Infinity },
    { preset_revision: 1.5 },
    { customized: "true" },
  ])("rejects malformed scene/preset fields %# without any partial mutation", (fields) => {
    const game = useGameStore();
    game.currentScene = scene("current");
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual";
    game.activeLightingPresetId = "current-preset";
    game.activeLightingPresetRevision = 4;
    game.activeLightingCustomized = false;
    game.lightingRevision = 9;
    useUIStore().setCurrentBackground("current.png");
    applySceneChangeMessage({ ...completePayload(), ...fields });
    expectSceneStateUnchanged();
    expect(game.activeLightingPresetId).toBe("current-preset");
    expect(game.activeLightingPresetRevision).toBe(4);
    expect(game.activeLightingCustomized).toBe(false);
  });

  it("rejects non-finite numbers in every lighting parameter block", () => {
    const game = useGameStore();
    game.currentScene = scene("current");
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual";
    game.lightingRevision = 9;
    useUIStore().setCurrentBackground("current.png");
    for (const [block, value] of Object.entries(lighting(2))) {
      if (typeof value === "number") {
        applySceneChangeMessage({
          ...completePayload(),
          active_lighting: { ...lighting(2), [block]: Infinity },
        });
        expectSceneStateUnchanged();
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [field, number] of Object.entries(value)) {
          if (typeof number !== "number") continue;
          applySceneChangeMessage({
            ...completePayload(),
            active_lighting: { ...lighting(2), [block]: { ...value, [field]: NaN } },
          });
          expectSceneStateUnchanged();
        }
      }
    }
  });

  it.each(["neutral", "scene_default", "manual", "ai"])(
    "accepts a valid advancing payload from %s",
    (source) => {
      const game = useGameStore();
      game.lightingRevision = 9;
      applySceneChangeMessage({ ...completePayload(), source });
      expect(game.currentScene?.id).toBe("next");
      expect(game.lightingRevision).toBe(10);
      expect(game.activeLightingSource).toBe(source);
    }
  );

  it.each([0, 8, 9])("keeps reducer rejection of revision %s", (lighting_revision) => {
    const game = useGameStore();
    game.currentScene = scene("current");
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual";
    game.lightingRevision = 9;
    useUIStore().setCurrentBackground("current.png");
    applySceneChangeMessage({ ...completePayload(), lighting_revision });
    expectSceneStateUnchanged();
  });

  it("treats legacy null scene as an explicit clear without changing revision authority", () => {
    const game = useGameStore();
    const ui = useUIStore();
    game.currentScene = scene("old");
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual";
    game.lightingRevision = 9;
    ui.setCurrentBackground("old.png");

    applySceneChangeMessage({ scene: null });

    expect(game.currentScene).toBeNull();
    expect(ui.currentBackground).toBe("");
    expect(game.activeLighting.enabled).toBe(false);
    expect(game.activeLightingSource).toBe("neutral");
    expect(game.lightingRevision).toBe(9);
  });
});
