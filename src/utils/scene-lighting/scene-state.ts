import type { SceneInfo } from "@/api/services/scene";
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

export function createNeutralLighting(): LightingParams {
  const filter = () => ({
    brightness: 1,
    contrast: 1,
    saturation: 1,
    sepia: 0,
    glow_radius: 0,
    glow_color: "#ffaa33",
  });
  return {
    schema_version: 2,
    enabled: false,
    master_intensity: 1,
    link_character_background: true,
    character: filter(),
    background: filter(),
    character_ambient: { enabled: false, color: "#ffffff", opacity: 0 },
    background_ambient: { enabled: false, color: "#ffffff", opacity: 0 },
    main_light: {
      enabled: false,
      shape: "radial",
      target: "both",
      x: 0.5,
      y: 0.5,
      angle: 0,
      radius: 0.8,
      color_start: "#ffffff",
      color_end: "#00000000",
      opacity: 0,
      blend_mode: "normal",
    },
    rim_light: {
      enabled: false,
      color: "#ffffff",
      intensity: 0,
      width: 0,
      softness: 0,
      angle: 0,
      offset: 0,
    },
    bloom: { enabled: false, target: "both", color: "#ffffff", radius: 0, intensity: 0 },
    vignette: { enabled: false, color: "#000000", intensity: 0, radius: 0.8, softness: 0 },
    asset_layers: [],
  };
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
