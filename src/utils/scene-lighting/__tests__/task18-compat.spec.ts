import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async (command: string, args?: { seedContent?: string }) =>
    command === "get_locale_messages" ? args?.seedContent : undefined
  ),
}));
import { applySceneChangeMessage } from "@/api/websocket/handlers/script-handler";
import { useGameStore } from "@/stores/modules/game";
import { useUIStore } from "@/stores/modules/ui/ui";
import { lighting, scene } from "@/test/scene-lighting-fixtures";
import {
  applyCastRuntimeLighting,
  createNeutralLighting,
  type SceneStateMirror,
} from "@/utils/scene-lighting/scene-state";
import type { CastRuntimeLighting } from "@/types/scene-lighting";
import type { WebInitData } from "@/api/services/game-info";

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
function temporarySwitch(revision: number, intensity: number) {
  return {
    scene: scene("same-id"),
    background: "same.png",
    active_lighting: lighting(intensity),
    source: "manual",
    preset_id: "user:temporary",
    preset_revision: 1,
    customized: true,
    lighting_revision: revision,
  };
}
function emptyMirror(): SceneStateMirror {
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
function castSnapshot(): CastRuntimeLighting {
  const game = useGameStore();
  return {
    currentSceneId: game.currentScene?.id ?? null,
    background: useUIStore().currentBackground,
    activeLighting: game.activeLighting,
    activeLightingSource: game.activeLightingSource,
    activeLightingPresetId: game.activeLightingPresetId,
    activeLightingPresetRevision: game.activeLightingPresetRevision,
    activeLightingCustomized: game.activeLightingCustomized,
    lightingRevision: game.lightingRevision,
  };
}
it("accepts three same-ID temporary changes and rejects delayed prior events without changing saved pixels", () => {
  const game = useGameStore();
  for (const [revision, intensity] of [
    [1, 0.5],
    [2, 1.25],
    [3, 1.75],
  ]) {
    applySceneChangeMessage(temporarySwitch(revision, intensity));
    expect(game.currentScene?.id).toBe("same-id");
    expect(game.lightingRevision).toBe(revision);
    expect(game.activeLighting.master_intensity).toBe(intensity);
  }
  const saved = JSON.stringify(game.currentScene?.lighting);
  applySceneChangeMessage(temporarySwitch(2, 0.5));
  expect(game.activeLighting.master_intensity).toBe(1.75);
  expect(game.lightingRevision).toBe(3);
  expect(JSON.stringify(game.currentScene?.lighting)).toBe(saved);
});
it("late cast hydration takes the latest runtime snapshot and ignores older mirrors", () => {
  applySceneChangeMessage(temporarySwitch(3, 1.75));
  const latest = castSnapshot();
  const hydrated = applyCastRuntimeLighting(emptyMirror(), latest, useGameStore().currentScene);
  expect(hydrated.activeLighting.master_intensity).toBe(1.75);
  expect(hydrated.activeLightingSource).toBe("manual");
  expect(
    applyCastRuntimeLighting(
      hydrated,
      { ...latest, lightingRevision: 2, activeLighting: lighting(0.5) },
      useGameStore().currentScene
    )
  ).toBe(hydrated);
});
it("a reloaded WebView module consumes backend temporary state rather than the saved scene default", async () => {
  applySceneChangeMessage(temporarySwitch(3, 1.75));
  const old = useGameStore();
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
    background: "same.png",
    background_effect: "",
    background_music: "",
    current_scene_id: old.currentScene?.id ?? null,
    current_scene: old.currentScene,
    active_lighting: old.activeLighting,
    active_lighting_source: old.activeLightingSource,
    active_lighting_preset_id: old.activeLightingPresetId,
    active_lighting_preset_revision: old.activeLightingPresetRevision,
    active_lighting_customized: old.activeLightingCustomized,
    lighting_revision: old.lightingRevision,
    lines: [],
    scene_awareness_enabled: true,
  } satisfies WebInitData;
  // WebView reload re-evaluates modules; a new Pinia alone reuses this project's module state.
  vi.resetModules();
  const { useGameStore: reloadedGameStore } = await import("@/stores/modules/game");
  const { applyWebInitData: hydrate } = await import("@/stores/modules/game/actions");
  setActivePinia(createPinia());
  const reloaded = reloadedGameStore();
  expect(reloaded.lightingRevision).toBe(-1);
  hydrate(reloaded, info);
  expect(reloaded.lightingRevision).toBe(3);
  expect(reloaded.activeLighting.master_intensity).toBe(1.75);
  expect(reloaded.activeLightingSource).toBe("manual");
  expect(reloaded.currentScene?.lighting?.master_intensity).not.toBe(1.75);
});
