import type { SceneInfo } from "@/api/services/scene";
import { createNeutralLighting } from "./defaults";
export { createNeutralLighting } from "./defaults";
import type {
  CastRuntimeLighting,
  LightingParams,
  SceneLightingSource,
  SceneStateScene,
  SceneStatePayload,
} from "@/types/scene-lighting";

export interface SceneStateProjectionPayload extends Omit<SceneStatePayload, "scene"> {
  scene: SceneStateScene | SceneInfo | null;
}

export interface SceneStateMirror {
  currentScene: SceneInfo | null;
  currentBackground: string;
  activeLighting: LightingParams;
  activeLightingSource: SceneLightingSource;
  activeLightingPresetId: string | null;
  activeLightingPresetRevision: number | null;
  activeLightingCustomized: boolean;
  lightingRevision: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneLightingOrNeutral(
  lighting: Readonly<LightingParams> | null | undefined
): LightingParams {
  return lighting ? clone(lighting) : createNeutralLighting();
}

function isSceneInfo(scene: SceneStateScene | SceneInfo): scene is SceneInfo {
  return "scene_name" in scene;
}

function projectScene(
  scene: SceneStateScene | SceneInfo | null,
  resolvedBackground: string
): SceneInfo | null {
  if (!scene) return null;
  if (isSceneInfo(scene)) return clone(scene);
  return {
    id: scene.id,
    scene_name: scene.name,
    scene_description: scene.description,
    background: resolvedBackground || null,
    lighting: clone(scene.lighting),
    lighting_preset_id: scene.lighting_preset_id,
    lighting_preset_revision: scene.lighting_preset_revision,
    lighting_customized: scene.lighting_customized,
    created_at: scene.created_at,
    updated_at: scene.updated_at,
    source: scene.plugin_id ?? "game",
    plugin_id: scene.plugin_id ?? null,
  };
}

/** Pure projection: stale/equal revisions return the original state unchanged. */
export function applySceneStatePayload(
  state: Readonly<SceneStateMirror>,
  payload: Readonly<SceneStateProjectionPayload>
): SceneStateMirror {
  if (payload.lighting_revision <= state.lightingRevision) return state as SceneStateMirror;
  return {
    currentScene: projectScene(payload.scene, payload.background),
    currentBackground: payload.background,
    activeLighting: clone(payload.active_lighting),
    activeLightingSource: payload.source,
    activeLightingPresetId: payload.preset_id,
    activeLightingPresetRevision: payload.preset_revision,
    activeLightingCustomized: payload.customized,
    lightingRevision: payload.lighting_revision,
  };
}

export function applyCastRuntimeLighting(
  state: Readonly<SceneStateMirror>,
  mirror: Readonly<CastRuntimeLighting>,
  scene: SceneInfo | null
): SceneStateMirror {
  return applySceneStatePayload(state, {
    scene: mirror.currentSceneId ? scene : null,
    background: mirror.background ?? "",
    active_lighting: mirror.activeLighting,
    source: mirror.activeLightingSource,
    preset_id: mirror.activeLightingPresetId,
    preset_revision: mirror.activeLightingPresetRevision,
    customized: mirror.activeLightingCustomized,
    lighting_revision: mirror.lightingRevision,
  });
}
