import { invoke } from "@tauri-apps/api/core";

import type {
  BatchExportResult,
  ExportResult,
  ImportCommitResult,
  ImportInspection,
  ImportStrategy,
  LightingParams,
  LightingPreset,
  LightingPresetDraft,
  LightingPresetUpdate,
  PresetSort,
  ResolvedLightingAsset,
  SceneStatePayload,
} from "@/types/scene-lighting";

export function listLightingPresets(sort?: PresetSort): Promise<LightingPreset[]> {
  return invoke<LightingPreset[]>("list_lighting_presets", { sort });
}

export function createLightingPreset(draft: LightingPresetDraft): Promise<LightingPreset> {
  return invoke<LightingPreset>("create_lighting_preset", { draft });
}

export function updateLightingPreset(
  id: string,
  update: LightingPresetUpdate
): Promise<LightingPreset> {
  return invoke<LightingPreset>("update_lighting_preset", { id, update });
}

export function deleteLightingPreset(id: string): Promise<boolean> {
  return invoke<boolean>("delete_lighting_preset", { id });
}

export function applyLightingPreset(id: string): Promise<SceneStatePayload> {
  return invoke<SceneStatePayload>("apply_lighting_preset", { id });
}

export function applyLightingParams(lighting: LightingParams): Promise<SceneStatePayload> {
  return invoke<SceneStatePayload>("apply_lighting_params", { lighting });
}

export function restoreSceneLighting(): Promise<SceneStatePayload> {
  return invoke<SceneStatePayload>("restore_scene_lighting");
}

export function saveActiveLightingAsSceneDefault(): Promise<SceneStatePayload> {
  return invoke<SceneStatePayload>("save_active_lighting_as_scene_default");
}

export function resolveLightingAsset(hash: string): Promise<ResolvedLightingAsset> {
  return invoke<ResolvedLightingAsset>("resolve_lighting_asset", { hash });
}

export function inspectLightingImport(path: string): Promise<ImportInspection> {
  return invoke<ImportInspection>("inspect_linglight", { path });
}

export function commitLightingImport(
  token: string,
  strategy: ImportStrategy,
  parameterOnly: boolean
): Promise<ImportCommitResult> {
  return invoke<ImportCommitResult>("commit_linglight_import", {
    token,
    strategy,
    parameterOnly,
  });
}

export function cancelLightingImport(token: string): Promise<void> {
  return invoke<void>("cancel_linglight_import", { token });
}

export function exportLightingPreset(presetId: string, targetPath: string): Promise<ExportResult> {
  return invoke<ExportResult>("export_linglight", { presetId, targetPath });
}

export function exportLightingPresets(
  presetIds: string[],
  targetDir: string
): Promise<BatchExportResult> {
  return invoke<BatchExportResult>("export_linglights", { presetIds, targetDir });
}
