import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { applyWebInitData } from "@/stores/modules/game/actions";
import { useGameStore } from "@/stores/modules/game";
import { useUIStore } from "@/stores/modules/ui/ui";
import { persist } from "@/stores/plugins/persist";
import type { WebInitData } from "@/api/services/game-info";
import { lighting, scene } from "@/test/scene-lighting-fixtures";

describe("game runtime lighting state", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("applyCurrentScene(null) clears the background and applies neutral lighting", () => {
    const game = useGameStore();
    const ui = useUIStore();
    game.currentScene = scene();
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual_custom";
    ui.setCurrentBackground("old.png");

    game.applyCurrentScene(null);

    expect(game.currentScene).toBeNull();
    expect(ui.currentBackground).toBe("");
    expect(game.activeLighting.enabled).toBe(false);
    expect(game.activeLightingSource).toBe("neutral");
    expect(game.activeLightingPresetId).toBeNull();
    expect(game.activeLightingCustomized).toBe(false);
  });

  it("initialization consumes the backend runtime lighting snapshot", () => {
    const game = useGameStore();
    const info = {
      character_settings: {
        ai_name: "AI",
        ai_subtitle: "",
        user_name: "User",
        user_subtitle: "",
        character_id: 1,
        thinking_message: "",
        scale: 1,
        offset_x: 0,
        offset_y: 0,
        scale_p: 1,
        offset_x_p: 0,
        offset_y_p: 0,
        bubble_top: 0,
        bubble_left: 0,
        clothes: {},
        clothes_name: "",
        body_part: {},
        character_folder: "ai",
      },
      current_interact_role_id: 1,
      onstage_roles_ids: [1],
      onstage_roles: [],
      background: "resolved.png",
      background_effect: "",
      background_music: "",
      current_scene_id: "scene-1",
      current_scene: scene(),
      active_lighting: lighting(1.75),
      active_lighting_source: "manual_preset",
      active_lighting_preset_id: "user:night",
      active_lighting_preset_revision: 4,
      active_lighting_customized: true,
      lighting_revision: 12,
      lines: [],
      scene_awareness_enabled: true,
    } satisfies WebInitData;

    applyWebInitData(game, info);

    expect(game.activeLighting.master_intensity).toBe(1.75);
    expect(game.activeLightingSource).toBe("manual_preset");
    expect(game.activeLightingPresetId).toBe("user:night");
    expect(game.activeLightingPresetRevision).toBe(4);
    expect(game.activeLightingCustomized).toBe(true);
    expect(game.lightingRevision).toBe(12);
  });

  it("does not write runtime lighting into Pinia localStorage persistence", () => {
    localStorage.setItem(
      "lingchat-game",
      JSON.stringify({
        activeLighting: lighting(2),
        activeLightingSource: "manual_custom",
        activeLightingPresetId: "stale",
        lightingRevision: 99,
      })
    );
    const pinia = createPinia();
    pinia.use(persist);
    setActivePinia(pinia);
    const game = useGameStore();

    expect(game.activeLightingPresetId).not.toBe("stale");
    expect(game.lightingRevision).not.toBe(99);

    localStorage.clear();
    game.activeLighting = lighting(1.5);
    game.activeLightingSource = "manual_custom";
    game.activeLightingPresetId = "temporary";
    game.lightingRevision = 99;

    expect(localStorage.getItem("lingchat-game")).toBeNull();
  });
});
