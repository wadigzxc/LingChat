use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::AppState;
use crate::ai_service::game_system::scene_store::{LightingParams, Scene, SceneStore};
use crate::ai_service::game_system::scene_transition::{
    SceneSelection, SceneStatePayload, StoredSceneSelection, resolve_startup_selection,
    restore_snapshot_scene, transition_scene_by_id, transition_scene_selection,
};
use crate::ai_service::service::AIService;
use crate::api::data_dir;

// ========== Response types ==========

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SceneInfo {
    pub id: String,
    pub scene_name: String,
    pub scene_description: String,
    pub background: Option<String>,
    pub lighting: Option<LightingParams>,
    pub lighting_preset_id: Option<String>,
    pub lighting_preset_revision: Option<u32>,
    pub lighting_customized: bool,
    pub created_at: String,
    pub updated_at: String,
    /// 来源："game" 或提供该场景背景图的插件 id（插件场景写入 scenes.json，带 plugin_id 标签）。
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
}

// ========== Request types ==========

#[derive(Debug, Deserialize)]
pub struct CreateSceneRequest {
    pub scene_name: String,
    pub scene_description: String,
    pub background: String,
    #[serde(default)]
    pub lighting: Option<LightingParams>,
    #[serde(default)]
    pub lighting_preset_id: Option<String>,
    #[serde(default)]
    pub lighting_preset_revision: Option<u32>,
    #[serde(default)]
    pub lighting_customized: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSceneRequest {
    pub id: String,
    pub scene_name: String,
    pub scene_description: String,
    pub background: String,
    #[serde(default)]
    pub lighting: Option<LightingParams>,
    #[serde(default)]
    pub lighting_preset_id: Option<String>,
    #[serde(default)]
    pub lighting_preset_revision: Option<u32>,
    #[serde(default)]
    pub lighting_customized: bool,
}

// ========== Helpers ==========

/// 从任意路径中提取纯文件名（用于存储到 scenes.json）
fn to_background_filename(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    let p = std::path::Path::new(raw);
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| raw.to_string())
}

/// 将存储的文件名解析为完整路径（用于返回给前端显示）
fn to_background_fullpath(filename: &str) -> String {
    if filename.is_empty() {
        return String::new();
    }
    // 插件场景直接存绝对路径：已是绝对路径且存在则原样返回。
    let direct = std::path::Path::new(filename);
    if direct.is_absolute() && direct.exists() {
        return filename.to_string();
    }
    // 如果已经是完整路径（旧数据兼容），先提取文件名再拼接
    let name = to_background_filename(filename);
    if name.is_empty() {
        return String::new();
    }
    super::backgrounds_dir()
        .join(&name)
        .to_string_lossy()
        .into_owned()
}

/// 【已废弃】改为仅提取文件名；保留此函数供外部用（game.rs），行为改为解析为完整路径。
pub(crate) fn normalize_background(raw: &str) -> String {
    to_background_fullpath(raw)
}

pub(crate) fn model_to_info(s: &Scene) -> SceneInfo {
    let bg = normalize_background(&s.background);
    SceneInfo {
        id: s.id.clone(),
        scene_name: s.name.clone(),
        scene_description: s.description.clone(),
        background: if bg.is_empty() { None } else { Some(bg) },
        lighting: s.lighting.clone(),
        lighting_preset_id: s.lighting_preset_id.clone(),
        lighting_preset_revision: s.lighting_preset_revision,
        lighting_customized: s.lighting_customized,
        created_at: s.created_at.clone(),
        updated_at: s.updated_at.clone(),
        source: s.plugin_id.clone().unwrap_or_else(|| "game".to_string()),
        plugin_id: s.plugin_id.clone(),
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn load_synchronized_scenes() -> Result<Vec<Scene>, String> {
    load_synchronized_scenes_from(&data_dir(), &super::backgrounds_dir())
}

fn load_synchronized_scenes_from(data_dir: &Path, bg_dir: &Path) -> Result<Vec<Scene>, String> {
    let store = SceneStore::new(data_dir);
    let mut scenes = store
        .load_all()
        .map_err(|e| format!("加载场景列表失败: {e}"))?;
    let existing_bgs: HashSet<String> = scenes
        .iter()
        .map(|s| to_background_filename(&s.background))
        .filter(|b| !b.is_empty())
        .collect();
    let allowed = ["png", "jpg", "jpeg", "webp", "bmp", "svg", "tif", "gif"];
    let mut added = false;

    if let Ok(entries) = std::fs::read_dir(bg_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !allowed.contains(&ext.as_str()) {
                continue;
            }
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if existing_bgs.contains(&file_name) {
                continue;
            }
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let now = now_iso();
            scenes.push(Scene {
                id: Uuid::new_v4().to_string(),
                name,
                description: String::new(),
                background: file_name,
                lighting: None,
                lighting_preset_id: None,
                lighting_preset_revision: None,
                lighting_customized: false,
                created_at: now.clone(),
                updated_at: now,
                plugin_id: None,
            });
            added = true;
        }
    }

    if added {
        store
            .save_all(&scenes)
            .map_err(|e| format!("保存场景失败: {e}"))?;
    }
    Ok(scenes)
}

fn persist_scene_selection(app: &AppHandle, scene_id: Option<&str>) -> Result<(), String> {
    let store = app
        .store(crate::config::STORE_FILE)
        .map_err(|e| format!("打开会话存储失败: {e}"))?;
    let value = scene_id
        .map(|id| serde_json::Value::String(id.to_string()))
        .unwrap_or(serde_json::Value::Null);
    store.set(crate::config::session::LAST_SCENE_ID.to_string(), value);
    store.save().map_err(|e| format!("保存上次场景失败: {e}"))
}

pub(crate) fn emit_scene_state(app: &AppHandle, payload: &SceneStatePayload) -> Result<(), String> {
    app.emit("scene-state:changed", payload)
        .map_err(|e| format!("广播场景状态失败: {e}"))
}

pub(crate) async fn apply_scene_selection_for_service(
    app: &AppHandle,
    service: &AIService,
    scene: Option<&Scene>,
) -> Result<SceneStatePayload, String> {
    let selected = scene.cloned().map(|scene| {
        let background = normalize_background(&scene.background);
        SceneSelection::new(scene, background)
    });
    let gs = service.game_status.lock().await;
    let transition = transition_scene_selection(&gs.scene_runtime_state(), selected)?;
    drop(gs);
    apply_scene_transition_for_service(app, service, transition).await
}

async fn apply_scene_transition_for_service(
    app: &AppHandle,
    service: &AIService,
    transition: crate::ai_service::game_system::scene_transition::SceneTransition,
) -> Result<SceneStatePayload, String> {
    persist_scene_selection(app, transition.current_scene_id.as_deref())?;
    let mut gs = service.game_status.lock().await;
    gs.apply_scene_transition(&transition);
    let payload = SceneStatePayload::from(&transition);
    drop(gs);
    emit_scene_state(app, &payload)?;
    Ok(payload)
}

pub async fn apply_scene_selection(
    app: &AppHandle,
    scene: Option<&Scene>,
) -> Result<SceneStatePayload, String> {
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    apply_scene_selection_for_service(app, &service, scene).await
}

pub async fn select_scene_by_id(
    app: &AppHandle,
    scene_id: Option<&str>,
) -> Result<SceneStatePayload, String> {
    let scenes = load_synchronized_scenes()?;
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let runtime = service.game_status.lock().await.scene_runtime_state();
    let transition = transition_scene_by_id(&runtime, &scenes, scene_id, |scene| {
        normalize_background(&scene.background)
    })?;
    apply_scene_transition_for_service(app, &service, transition).await
}

pub(crate) async fn restore_startup_scene_selection(
    app: &AppHandle,
    service: &AIService,
) -> Result<SceneStatePayload, String> {
    let scenes = load_synchronized_scenes()?;
    let current_id = service.game_status.lock().await.current_scene_id.clone();
    let stored = if let Some(id) = current_id {
        StoredSceneSelection::SceneId(id)
    } else if let Ok(store) = app.store(crate::config::STORE_FILE) {
        match store.get(crate::config::session::LAST_SCENE_ID) {
            None => StoredSceneSelection::NeverSelected,
            Some(value) if value.is_null() => StoredSceneSelection::ExplicitNone,
            Some(value) => value
                .as_str()
                .map(|id| StoredSceneSelection::SceneId(id.to_string()))
                .unwrap_or(StoredSceneSelection::ExplicitNone),
        }
    } else {
        StoredSceneSelection::NeverSelected
    };
    let resolution = resolve_startup_selection(stored, &scenes);
    let persist_correction = resolution.persist_correction;
    let payload = apply_scene_selection_for_service(app, service, resolution.scene).await?;
    if persist_correction {
        tracing::info!("启动场景记录缺失或无效，已选择安全回退并修正持久化状态");
    }
    Ok(payload)
}

pub(crate) async fn restore_snapshot_scene_selection(
    app: &AppHandle,
    service: &AIService,
    snapshot_scene_id: Option<&str>,
) -> Result<SceneStatePayload, String> {
    let scenes = load_synchronized_scenes()?;
    let runtime = service.game_status.lock().await.scene_runtime_state();
    let transition = restore_snapshot_scene(&runtime, snapshot_scene_id, &scenes, |scene| {
        normalize_background(&scene.background)
    })?;
    apply_scene_transition_for_service(app, service, transition).await
}

// ========== Tauri commands ==========

#[tauri::command]
pub async fn list_scenes(_app: AppHandle) -> Result<Vec<SceneInfo>, String> {
    let scenes = load_synchronized_scenes()?;
    Ok(scenes.iter().map(|s| model_to_info(s)).collect())
}

#[tauri::command]
pub async fn create_scene(_app: AppHandle, req: CreateSceneRequest) -> Result<SceneInfo, String> {
    let store = SceneStore::new(&data_dir());
    let mut scenes = store
        .load_all()
        .map_err(|e| format!("加载场景列表失败: {}", e))?;

    let now = now_iso();
    let scene = Scene {
        id: Uuid::new_v4().to_string(),
        name: req.scene_name,
        description: req.scene_description,
        background: to_background_filename(&req.background),
        lighting: req.lighting,
        lighting_preset_id: req.lighting_preset_id,
        lighting_preset_revision: req.lighting_preset_revision,
        lighting_customized: req.lighting_customized,
        created_at: now.clone(),
        updated_at: now,
        plugin_id: None,
    };
    let info = model_to_info(&scene);
    scenes.push(scene);
    store
        .save_all(&scenes)
        .map_err(|e| format!("保存场景失败: {}", e))?;
    Ok(info)
}

#[tauri::command]
pub async fn update_scene(_app: AppHandle, req: UpdateSceneRequest) -> Result<SceneInfo, String> {
    let store = SceneStore::new(&data_dir());
    let mut scenes = store
        .load_all()
        .map_err(|e| format!("加载场景列表失败: {}", e))?;

    let idx = scenes
        .iter()
        .position(|s| s.id == req.id)
        .ok_or_else(|| format!("场景 {} 不存在", req.id))?;

    scenes[idx].name = req.scene_name;
    scenes[idx].description = req.scene_description;
    scenes[idx].background = to_background_filename(&req.background);
    scenes[idx].lighting = req.lighting;
    scenes[idx].lighting_preset_id = req.lighting_preset_id;
    scenes[idx].lighting_preset_revision = req.lighting_preset_revision;
    scenes[idx].lighting_customized = req.lighting_customized;
    scenes[idx].updated_at = now_iso();

    let info = model_to_info(&scenes[idx]);
    store
        .save_all(&scenes)
        .map_err(|e| format!("保存场景失败: {}", e))?;
    let state = _app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let is_current = service.game_status.lock().await.current_scene_id.as_deref() == Some(&req.id);
    if is_current {
        apply_scene_selection_for_service(&_app, &service, Some(&scenes[idx])).await?;
    }
    Ok(info)
}

#[tauri::command]
pub async fn delete_scene(app: AppHandle, id: String) -> Result<(), String> {
    let store = SceneStore::new(&data_dir());
    let mut scenes = store
        .load_all()
        .map_err(|e| format!("加载场景列表失败: {}", e))?;

    // 记住被删场景的背景图文件名，删除记录后据此清理孤儿文件。
    // 插件场景随插件生命周期管理（且存绝对路径），不在此删除。
    let deleted_bg = scenes
        .iter()
        .find(|s| s.id == id)
        .filter(|s| s.plugin_id.is_none())
        .map(|s| to_background_filename(&s.background))
        .unwrap_or_default();

    let before = scenes.len();
    scenes.retain(|s| s.id != id);
    if scenes.len() == before {
        return Err(format!("场景 {} 不存在", id));
    }

    store
        .save_all(&scenes)
        .map_err(|e| format!("保存场景失败: {}", e))?;

    // 若该背景图不再被任何剩余场景引用，删除文件，否则 list_scenes 会把它重新
    // 注册成只有文件名、没有描述的占位场景（删除后“复活”的根因）。
    if !deleted_bg.is_empty()
        && !scenes
            .iter()
            .any(|s| to_background_filename(&s.background) == deleted_bg)
    {
        let base = super::backgrounds_dir();
        let file_path = base.join(&deleted_bg);
        if crate::utils::path::validate_path_in_base(&file_path, &base).is_ok()
            && file_path.exists()
        {
            if let Err(e) = std::fs::remove_file(&file_path) {
                tracing::warn!("删除场景背景图失败 {deleted_bg}: {e}");
            }
        }
    }

    // 若删除的是当前选中场景，统一清空背景、光影、持久化 ID 并广播。
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let is_current = service.game_status.lock().await.current_scene_id.as_deref() == Some(&id);
    if is_current {
        apply_scene_selection_for_service(&app, &service, None).await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn select_scene(app: AppHandle, scene_id: Option<String>) -> Result<(), String> {
    select_scene_by_id(&app, scene_id.as_deref()).await?;
    Ok(())
}

#[tauri::command]
pub async fn set_scene_awareness(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let mut gs = service.game_status.lock().await;
    gs.scene_awareness_enabled = enabled;

    // 持久化到 store
    if let Ok(store) = app.store(crate::config::STORE_FILE) {
        store.set(
            crate::config::session::SCENE_AWARENESS_ENABLED.to_string(),
            serde_json::Value::Bool(enabled),
        );
        let _ = store.save();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_and_ai_scene_lists_share_background_directory_synchronization() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let backgrounds_dir = root.path().join("backgrounds");
        std::fs::create_dir_all(&backgrounds_dir).unwrap();
        std::fs::write(backgrounds_dir.join("sky.png"), b"png fixture").unwrap();

        let synchronized = load_synchronized_scenes_from(&data_dir, &backgrounds_dir).unwrap();
        let ui_ids: Vec<_> = synchronized.iter().map(|scene| scene.id.as_str()).collect();
        let ai_ids: Vec<_> = synchronized.iter().map(|scene| scene.id.as_str()).collect();

        assert_eq!(ui_ids, ai_ids);
        assert_eq!(synchronized.len(), 1);
        assert_eq!(synchronized[0].background, "sky.png");
    }
}
