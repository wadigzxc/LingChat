use tauri::{AppHandle, Manager, State};

use crate::AppState;
use crate::ai_service::game_system::lighting::LightingParams;
use crate::ai_service::game_system::lighting_presets::{
    LightingPreset, LightingPresetDraft, LightingPresetStore, LightingPresetUpdate, PresetSort,
};
use crate::ai_service::game_system::scene_store::{Scene, SceneStore};
use crate::ai_service::game_system::scene_transition::{SceneLightingSource, SceneStatePayload};
use crate::ai_service::service::AIService;

use super::transition::{
    RuntimeLightingRequest, restore_runtime_lighting, transition_runtime_lighting,
};

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) fn scene_for_runtime(
    data_dir: &std::path::Path,
    id: Option<&str>,
) -> Result<Option<Scene>, String> {
    let Some(id) = id else {
        return Ok(None);
    };
    let scene = SceneStore::new(data_dir)
        .find_by_id(id)
        .map_err(error_text)?;
    scene
        .ok_or_else(|| format!("当前场景不存在: {id}"))
        .map(Some)
}

pub(crate) fn apply_active_lighting_to_scene(
    scene: &mut Scene,
    runtime: &crate::ai_service::game_system::scene_transition::SceneRuntimeState,
    updated_at: String,
) {
    scene.lighting = Some(runtime.active_lighting.clone());
    scene.lighting_preset_id = runtime.preset_id.clone();
    scene.lighting_preset_revision = runtime.preset_revision;
    scene.lighting_customized = runtime.customized;
    scene.updated_at = updated_at;
}

async fn commit_runtime_request_for_service<F>(
    service: &AIService,
    make_request: F,
) -> Result<SceneStatePayload, String>
where
    F: FnOnce(
        &crate::ai_service::game_system::scene_transition::SceneRuntimeState,
    ) -> RuntimeLightingRequest,
{
    let mut game_status = service.game_status.lock().await;
    let current = game_status.scene_runtime_state();
    let scene = scene_for_runtime(&service.data_dir, current.current_scene_id.as_deref())?;
    let transition = transition_runtime_lighting(&current, scene, make_request(&current))?;
    let payload = SceneStatePayload::from(&transition);
    game_status.apply_scene_transition(&transition);
    drop(game_status);
    Ok(payload)
}

/// Atomically retrieve and mark the sole snapshot used by manual and AI application.
pub(crate) async fn preset_request_for_application(
    store: &LightingPresetStore,
    id: &str,
    source: SceneLightingSource,
) -> Result<RuntimeLightingRequest, String> {
    if !matches!(
        source,
        SceneLightingSource::ManualPreset | SceneLightingSource::AiPreset
    ) {
        return Err("预设应用来源必须是 manual_preset 或 ai_preset".into());
    }
    let preset = store
        .take_for_application(id)
        .await
        .map_err(error_text)?
        .ok_or_else(|| format!("光影预设不存在: {id}"))?;
    Ok(match source {
        SceneLightingSource::ManualPreset => {
            RuntimeLightingRequest::manual_preset(preset.lighting, preset.id, preset.revision)
        },
        SceneLightingSource::AiPreset => {
            RuntimeLightingRequest::ai_preset(preset.lighting, preset.id, preset.revision)
        },
        _ => unreachable!("validated preset source"),
    })
}

/// Shared by manual commands and Task 9. AI callers can select a preset through
/// this function, but cannot submit arbitrary lighting parameters.
pub(crate) async fn apply_lighting_preset_for_service(
    app: &AppHandle,
    service: &AIService,
    preset: LightingPreset,
    source: SceneLightingSource,
) -> Result<SceneStatePayload, String> {
    // AI selection may be stale after matching; only its ID crosses this boundary.
    // Resolve the application snapshot anew through the same entry as manual use.
    let store = app.state::<LightingPresetStore>();
    apply_lighting_preset_id_for_service(app, service, &store, &preset.id, source).await
}

async fn apply_lighting_preset_id_for_service(
    app: &AppHandle,
    service: &AIService,
    store: &LightingPresetStore,
    id: &str,
    source: SceneLightingSource,
) -> Result<SceneStatePayload, String> {
    let request = preset_request_for_application(store, id, source).await?;
    let payload = commit_runtime_request_for_service(service, move |_| request).await?;
    crate::api::scene::emit_scene_state(app, &payload)?;
    Ok(payload)
}

#[tauri::command]
pub async fn list_lighting_presets(
    sort: Option<PresetSort>,
    store: State<'_, LightingPresetStore>,
) -> Result<Vec<LightingPreset>, String> {
    store
        .list(sort.unwrap_or_default())
        .await
        .map_err(error_text)
}

#[tauri::command]
pub async fn create_lighting_preset(
    draft: LightingPresetDraft,
    store: State<'_, LightingPresetStore>,
) -> Result<LightingPreset, String> {
    store.create(draft).await.map_err(error_text)
}

#[tauri::command]
pub async fn update_lighting_preset(
    id: String,
    update: LightingPresetUpdate,
    store: State<'_, LightingPresetStore>,
) -> Result<LightingPreset, String> {
    store.update(&id, update).await.map_err(error_text)
}

#[tauri::command]
pub async fn delete_lighting_preset(
    id: String,
    store: State<'_, LightingPresetStore>,
) -> Result<bool, String> {
    store
        .delete(&id)
        .await
        .map(|removed| removed.is_some())
        .map_err(error_text)
}

#[tauri::command]
pub async fn apply_lighting_preset(
    app: AppHandle,
    id: String,
    store: State<'_, LightingPresetStore>,
) -> Result<SceneStatePayload, String> {
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    apply_lighting_preset_id_for_service(
        &app,
        &service,
        &store,
        &id,
        SceneLightingSource::ManualPreset,
    )
    .await
}

#[tauri::command]
pub async fn apply_lighting_params(
    app: AppHandle,
    lighting: LightingParams,
) -> Result<SceneStatePayload, String> {
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let payload = commit_runtime_request_for_service(&service, move |current| {
        RuntimeLightingRequest::manual_custom_from(current, lighting)
    })
    .await?;
    crate::api::scene::emit_scene_state(&app, &payload)?;
    Ok(payload)
}

#[tauri::command]
pub async fn restore_scene_lighting(app: AppHandle) -> Result<SceneStatePayload, String> {
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let mut game_status = service.game_status.lock().await;
    let current = game_status.scene_runtime_state();
    let scene = scene_for_runtime(&service.data_dir, current.current_scene_id.as_deref())?;
    let transition = restore_runtime_lighting(&current, scene)?;
    let payload = SceneStatePayload::from(&transition);
    game_status.apply_scene_transition(&transition);
    drop(game_status);
    crate::api::scene::emit_scene_state(&app, &payload)?;
    Ok(payload)
}

#[tauri::command]
pub async fn save_active_lighting_as_scene_default(
    app: AppHandle,
) -> Result<SceneStatePayload, String> {
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let runtime = service.game_status.lock().await.scene_runtime_state();
    let scene_id = runtime
        .current_scene_id
        .as_deref()
        .ok_or_else(|| "当前没有场景，无法保存默认光影".to_string())?;

    let store = SceneStore::new(&service.data_dir);
    let saved = store
        .mutate(|scenes| {
            let scene = scenes
                .iter_mut()
                .find(|scene| scene.id == scene_id)
                .ok_or_else(|| anyhow::anyhow!("当前场景不存在，无法保存默认光影"))?;
            apply_active_lighting_to_scene(scene, &runtime, chrono::Utc::now().to_rfc3339());
            Ok(scene.clone())
        })
        .map_err(error_text)?;

    crate::api::scene::apply_scene_selection_for_service(&app, &service, Some(&saved)).await
}
