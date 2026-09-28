import { invoke } from "@tauri-apps/api/core";

import type { LightingParams } from "@/types/scene-lighting";

export type { LightingParams } from "@/types/scene-lighting";

export interface SceneLightingMetadata {
  lighting_preset_id: string | null;
  lighting_preset_revision: number | null;
  lighting_customized: boolean;
}

export function getSceneLightingMetadata(
  scene: Pick<SceneInfo, keyof SceneLightingMetadata>
): SceneLightingMetadata {
  return {
    lighting_preset_id: scene.lighting_preset_id,
    lighting_preset_revision: scene.lighting_preset_revision,
    lighting_customized: scene.lighting_customized,
  };
}

export function getSceneLightingMetadataForSave(
  initial: SceneLightingMetadata & { lighting?: LightingParams | null },
  lighting: LightingParams | null
): SceneLightingMetadata {
  if (lighting === null) {
    return {
      lighting_preset_id: null,
      lighting_preset_revision: null,
      lighting_customized: false,
    };
  }

  return {
    lighting_preset_id: initial.lighting_preset_id,
    lighting_preset_revision: initial.lighting_preset_revision,
    lighting_customized:
      initial.lighting_customized ||
      JSON.stringify(initial.lighting ?? null) !== JSON.stringify(lighting),
  };
}

export interface SceneInfo extends SceneLightingMetadata {
  id: string;
  scene_name: string;
  scene_description: string;
  background: string | null;
  lighting: LightingParams | null;
  created_at: string;
  updated_at: string;
  /** 来源："game" 或提供该场景背景图的插件 id。 */
  source: string;
  plugin_id?: string | null;
}

export interface CreateSceneRequest extends SceneLightingMetadata {
  scene_name: string;
  scene_description: string;
  background: string;
  lighting?: LightingParams | null;
}

export interface UpdateSceneRequest extends SceneLightingMetadata {
  id: string;
  scene_name: string;
  scene_description: string;
  background: string;
  lighting?: LightingParams | null;
}

export async function listScenes(): Promise<SceneInfo[]> {
  return invoke<SceneInfo[]>("list_scenes");
}

export async function createScene(req: CreateSceneRequest): Promise<SceneInfo> {
  return invoke<SceneInfo>("create_scene", { req });
}

export async function updateScene(req: UpdateSceneRequest): Promise<SceneInfo> {
  return invoke<SceneInfo>("update_scene", { req });
}

export async function deleteScene(id: string): Promise<void> {
  return invoke("delete_scene", { id });
}

export async function selectScene(sceneId: string | null): Promise<void> {
  return invoke("select_scene", { sceneId });
}

export async function setSceneAwareness(enabled: boolean): Promise<void> {
  return invoke("set_scene_awareness", { enabled });
}
