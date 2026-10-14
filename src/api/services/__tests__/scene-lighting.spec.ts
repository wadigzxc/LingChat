import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  applyLightingParams,
  applyLightingPreset,
  cancelLightingImport,
  commitLightingImport,
  createLightingPreset,
  deleteLightingPreset,
  exportLightingPreset,
  exportLightingPresets,
  inspectLightingImport,
  listLightingPresets,
  resolveLightingAsset,
  restoreSceneLighting,
  saveActiveLightingAsSceneDefault,
  setLightingPresetFavorite,
  updateLightingPreset,
} from "@/api/services/scene-lighting";
import {
  getSceneLightingMetadata,
  getSceneLightingMetadataForSave,
  updateScene,
  type UpdateSceneRequest,
} from "@/api/services/scene";
import { lighting, scene } from "@/test/scene-lighting-fixtures";

describe("scene lighting command wrappers", () => {
  beforeEach(() => invoke.mockClear());

  it.each([true, false])(
    "forwards the explicit favorite target %s and returns the complete command DTO",
    async (favorite) => {
      const dto = {
        id: "builtin:neutral",
        kind: "built_in",
        favorite,
        revision: 7,
        lighting: lighting(),
        origin_id: "builtin:neutral",
        name: "Neutral",
        i18n_key: "lighting.presets.neutral",
        description: "",
        aliases: [],
        tags: [],
        category: "neutral",
        last_used_at: null,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      };
      invoke.mockResolvedValueOnce(dto);
      const result = await setLightingPresetFavorite("builtin:neutral", favorite);
      expect(invoke.mock.calls).toEqual([
        ["set_lighting_preset_favorite", { id: "builtin:neutral", favorite }],
      ]);
      expect(result).toBe(dto);
    }
  );
  it("forwards explicit default intent without adding it to legacy ordinary edits", async () => {
    const ordinary: UpdateSceneRequest = {
      id: "captured",
      scene_name: "Name",
      scene_description: "Description",
      background: "captured.png",
      lighting: lighting(),
      lighting_preset_id: "user:captured",
      lighting_preset_revision: 4,
      lighting_customized: true,
    };
    await updateScene(ordinary);
    const explicit: UpdateSceneRequest = { ...ordinary, apply_lighting_as_default: true };
    await updateScene(explicit);
    expect(invoke.mock.calls).toEqual([
      ["update_scene", { req: ordinary }],
      ["update_scene", { req: explicit }],
    ]);
    expect((invoke.mock.calls[0]![1] as { req: UpdateSceneRequest }).req).not.toHaveProperty(
      "apply_lighting_as_default"
    );
    expect((invoke.mock.calls[1]![1] as { req: UpdateSceneRequest }).req).toHaveProperty(
      "apply_lighting_as_default",
      true
    );
  });

  it("uses the exact Rust command names and argument keys", async () => {
    const draft = {
      name: "Preset",
      description: "",
      aliases: [],
      tags: [],
      category: "",
      favorite: false,
      last_used_at: null,
      lighting: lighting(),
    };
    await listLightingPresets("favorite_first");
    await createLightingPreset(draft);
    await updateLightingPreset("user:1", { favorite: true });
    await deleteLightingPreset("user:1");
    await applyLightingPreset("user:1");
    await applyLightingParams(draft.lighting);
    await restoreSceneLighting();
    await saveActiveLightingAsSceneDefault();
    await resolveLightingAsset("abc");
    await inspectLightingImport("C:/a.linglight");
    await commitLightingImport("token", "keep_both", true);
    await cancelLightingImport("token");
    await exportLightingPreset("user:1", "C:/one.linglight");
    await exportLightingPresets(["user:1", "user:2"], "C:/out");

    expect(invoke.mock.calls).toEqual([
      ["list_lighting_presets", { sort: "favorite_first" }],
      ["create_lighting_preset", { draft }],
      ["update_lighting_preset", { id: "user:1", update: { favorite: true } }],
      ["delete_lighting_preset", { id: "user:1" }],
      ["apply_lighting_preset", { id: "user:1" }],
      ["apply_lighting_params", { lighting: draft.lighting }],
      ["restore_scene_lighting"],
      ["save_active_lighting_as_scene_default"],
      ["resolve_lighting_asset", { hash: "abc" }],
      ["inspect_linglight", { path: "C:/a.linglight" }],
      ["commit_linglight_import", { token: "token", strategy: "keep_both", parameterOnly: true }],
      ["cancel_linglight_import", { token: "token" }],
      ["export_linglight", { presetId: "user:1", targetPath: "C:/one.linglight" }],
      ["export_linglights", { presetIds: ["user:1", "user:2"], targetDir: "C:/out" }],
    ]);
  });
});

describe("scene lighting source metadata", () => {
  it("carries preset provenance through scene editor save payloads", () => {
    expect(getSceneLightingMetadata(scene())).toEqual({
      lighting_preset_id: "preset:base",
      lighting_preset_revision: 2,
      lighting_customized: false,
    });
  });

  it("marks edited lighting as customized while preserving preset provenance", () => {
    const initial = scene();
    const edited = lighting();
    edited.character.brightness = 1.25;

    expect(getSceneLightingMetadataForSave(initial, edited)).toEqual({
      lighting_preset_id: "preset:base",
      lighting_preset_revision: 2,
      lighting_customized: true,
    });
  });

  it("clears preset provenance when lighting is disabled", () => {
    expect(getSceneLightingMetadataForSave(scene(), null)).toEqual({
      lighting_preset_id: null,
      lighting_preset_revision: null,
      lighting_customized: false,
    });
  });
});
