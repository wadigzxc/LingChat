/** Wire types mirror Rust V2 scene-lighting DTOs and intentionally keep snake_case fields. */
export interface FilterParams {
  brightness: number;
  contrast: number;
  saturation: number;
  sepia: number;
  glow_radius: number;
  glow_color: string;
}

export type LightShape = "linear" | "radial";
export type LightingTarget = "character" | "background" | "both";
export type BlendMode = "screen" | "add" | "overlay" | "soft_light" | "multiply" | "normal";
export type AssetPlacement = "front" | "behind";
export type AssetFit = "contain" | "stretch" | "cover";

export interface AmbientParams {
  enabled: boolean;
  color: string;
  opacity: number;
}

export interface MainLightParams {
  enabled: boolean;
  shape: LightShape;
  target: LightingTarget;
  x: number;
  y: number;
  angle: number;
  radius: number;
  color_start: string;
  color_end: string;
  opacity: number;
  blend_mode: BlendMode;
}

export interface RimLightParams {
  enabled: boolean;
  color: string;
  intensity: number;
  width: number;
  softness: number;
  angle: number;
  offset: number;
}

export interface BloomParams {
  enabled: boolean;
  target: LightingTarget;
  color: string;
  radius: number;
  intensity: number;
}

export interface VignetteParams {
  enabled: boolean;
  color: string;
  intensity: number;
  radius: number;
  softness: number;
}

export interface LightingAssetLayer {
  id: string;
  asset_hash: string;
  media_type: string;
  target: LightingTarget;
  placement: AssetPlacement;
  z_index: number;
  opacity: number;
  blend_mode: BlendMode;
  fit: AssetFit;
  required: boolean;
}

export interface LightingParams {
  schema_version: 2;
  enabled: boolean;
  master_intensity: number;
  link_character_background: boolean;
  character: FilterParams;
  background: FilterParams;
  character_ambient: AmbientParams;
  background_ambient: AmbientParams;
  main_light: MainLightParams;
  rim_light: RimLightParams;
  bloom: BloomParams;
  vignette: VignetteParams;
  asset_layers: LightingAssetLayer[];
}

export type SceneLightingSource = "neutral" | "scene_default" | "manual" | "ai";

/** `SceneStatePayload.scene` is Rust's persisted Scene, not the UI SceneInfo DTO. */
export interface SceneStateScene {
  id: string;
  name: string;
  description: string;
  background: string;
  lighting: LightingParams | null;
  lighting_preset_id: string | null;
  lighting_preset_revision: number | null;
  lighting_customized: boolean;
  created_at: string;
  updated_at: string;
  plugin_id?: string | null;
}

export interface SceneStatePayload {
  scene: SceneStateScene | null;
  background: string;
  active_lighting: LightingParams;
  source: SceneLightingSource;
  preset_id: string | null;
  preset_revision: number | null;
  customized: boolean;
  lighting_revision: number;
}

export type PresetKind = "built_in" | "user";
export type PresetSort = "favorite_first" | "recently_used" | "name";

export interface LightingPreset {
  id: string;
  origin_id: string | null;
  revision: number;
  kind: PresetKind;
  name: string;
  i18n_key: string | null;
  description: string;
  aliases: string[];
  tags: string[];
  category: string;
  favorite: boolean;
  last_used_at: string | null;
  lighting: LightingParams;
  created_at: string;
  updated_at: string;
}

export interface LightingPresetDraft {
  name: string;
  description: string;
  aliases: string[];
  tags: string[];
  category: string;
  favorite: boolean;
  last_used_at: string | null;
  lighting: LightingParams;
}

export interface LightingPresetUpdate {
  name?: string | null;
  description?: string | null;
  aliases?: string[] | null;
  tags?: string[] | null;
  category?: string | null;
  favorite?: boolean | null;
  /** Rust Option<Option<String>>: omit = unchanged, null = clear. */
  last_used_at?: string | null;
  lighting?: LightingParams | null;
}

export interface ResolvedLightingAsset {
  hash: string;
  supported: boolean;
  asset_protocol_path: string | null;
  warning: string | null;
}

export type ImportStrategy = "keep_both" | "overwrite_same_origin";
export type ImportConflictKind = "built_in" | "same_origin" | "name";

export interface ImportConflict {
  kind: ImportConflictKind;
  existing_id: string;
  existing_name: string;
}

export interface ImportPresetSummary {
  name: string;
  description: string;
  tags: string[];
  category: string;
  origin_id: string;
  revision: number;
}

export interface ImportAssetSummary {
  id: string;
  sha256: string;
  byte_size: number;
  width: number;
  height: number;
}

export interface ImportInspection {
  token: string;
  preset: ImportPresetSummary;
  assets: ImportAssetSummary[];
  warnings: string[];
  conflicts: ImportConflict[];
  expires_at: string;
}

export interface ImportCommitResult {
  preset: LightingPreset;
  warnings: string[];
}

export interface ExportResult {
  preset_id: string;
  path: string;
}

export interface BatchExportItem {
  preset_id: string;
  path: string | null;
  error: string | null;
}

export interface BatchExportResult {
  items: BatchExportItem[];
}

/** Rust cast mirror/snapshot use camelCase by explicit serde/JSON construction. */
export interface CastRuntimeLighting {
  currentSceneId: string | null;
  background: string | null;
  activeLighting: LightingParams;
  activeLightingSource: SceneLightingSource;
  activeLightingPresetId: string | null;
  activeLightingPresetRevision: number | null;
  activeLightingCustomized: boolean;
  lightingRevision: number;
}

export interface CastMirror extends CastRuntimeLighting {
  line: string;
  title: string;
  subtitle: string;
  emotion: string;
  motionText: string;
  status: string;
  backgroundEffect: string | null;
  presentRoleIds: number[];
  currentRoleId: number | null;
  roleEmotion: string;
  roleOriginalEmotion: string;
}

export interface CastSnapshot extends CastRuntimeLighting {
  backgroundEffect: string | null;
  presentRoleIds: number[];
  currentRoleId: number | null;
}
