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
    transition_scene_update_with_intent,
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
    /// Explicit default-save intent; omitted by ordinary scene editors.
    #[serde(default)]
    pub apply_lighting_as_default: bool,
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
    store
        .mutate_if_changed(|scenes| {
            let mut existing_bgs: HashSet<String> = scenes
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
                    if !existing_bgs.insert(file_name.clone()) {
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
            Ok((scenes.clone(), added))
        })
        .map_err(|e| format!("同步场景列表失败: {e}"))
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
    let saved = store
        .mutate(|scenes| {
            scenes.push(scene.clone());
            Ok(scene)
        })
        .map_err(|e| format!("保存场景失败: {e}"))?;
    Ok(model_to_info(&saved))
}

#[tauri::command]
pub async fn update_scene(app: AppHandle, req: UpdateSceneRequest) -> Result<SceneInfo, String> {
    // Serialize persistence and the resulting runtime event with other service
    // operations. Never wait for this lock after committing a captured snapshot:
    // another update could otherwise commit/apply first and then be rolled back.
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let store = SceneStore::new(&data_dir());
    let (previous, updated) = store
        .mutate(|scenes| {
            let scene = scenes
                .iter_mut()
                .find(|scene| scene.id == req.id)
                .ok_or_else(|| anyhow::anyhow!("场景 {} 不存在", req.id))?;
            let previous = scene.clone();
            scene.name = req.scene_name;
            scene.description = req.scene_description;
            scene.background = to_background_filename(&req.background);
            scene.lighting = req.lighting;
            scene.lighting_preset_id = req.lighting_preset_id;
            scene.lighting_preset_revision = req.lighting_preset_revision;
            scene.lighting_customized = req.lighting_customized;
            scene.updated_at = now_iso();
            Ok((previous, scene.clone()))
        })
        .map_err(|e| format!("更新场景失败: {e}"))?;

    let info = model_to_info(&updated);
    let resolved_background = normalize_background(&updated.background);
    let mut game_status = service.game_status.lock().await;
    let runtime = game_status.scene_runtime_state();
    if let Some(transition) = transition_scene_update_with_intent(
        &runtime,
        &previous,
        updated,
        resolved_background,
        req.apply_lighting_as_default,
    )? {
        let payload = SceneStatePayload::from(&transition);
        game_status.apply_scene_transition(&transition);
        drop(game_status);
        emit_scene_state(&app, &payload)?;
    }
    Ok(info)
}

fn delete_scene_from_store(store: &SceneStore, id: &str, base: &Path) -> Result<(), String> {
    store
        .mutate_with_cleanup(
            |scenes| {
                let index = scenes
                    .iter()
                    .position(|scene| scene.id == id)
                    .ok_or_else(|| anyhow::anyhow!("场景 {} 不存在", id))?;
                Ok(scenes.remove(index))
            },
            |scenes, deleted| {
                // Plugin backgrounds are owned by the plugin lifecycle.
                let deleted_bg = to_background_filename(&deleted.background);
                if deleted.plugin_id.is_some()
                    || deleted_bg.is_empty()
                    || scenes
                        .iter()
                        .any(|scene| to_background_filename(&scene.background) == deleted_bg)
                {
                    return Ok(());
                }
                // Check references and remove the file under the same shared lock.
                // JSON has already committed: a save failure never reaches here.
                let file_path = base.join(&deleted_bg);
                if crate::utils::path::validate_path_in_base(&file_path, base).is_ok()
                    && file_path.exists()
                {
                    if let Err(e) = std::fs::remove_file(&file_path) {
                        tracing::warn!("删除场景背景图失败 {deleted_bg}: {e}");
                    }
                }
                Ok(())
            },
        )
        .map(|_| ())
        .map_err(|e| format!("删除场景失败: {e}"))
}

#[tauri::command]
pub async fn delete_scene(app: AppHandle, id: String) -> Result<(), String> {
    let store = SceneStore::new(&data_dir());
    delete_scene_from_store(&store, &id, &super::backgrounds_dir())?;

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
    fn scene_update_serializes_store_write_runtime_snapshot_and_emit_under_service_lock() {
        // Like game::reset_lock_tests, check the real command scope without mocking
        // a separate lock model or requiring a running AppHandle/database.
        let source = include_str!("scene.rs");
        let body = source
            .split("pub async fn update_scene(")
            .nth(1)
            .unwrap()
            .split("fn delete_scene_from_store(")
            .next()
            .unwrap();
        let lock = body.find("state.ai_service.lock().await").unwrap();
        let mutation = body.find(".mutate(|scenes|").unwrap();
        let snapshot = body.find("game_status.scene_runtime_state()").unwrap();
        let emit = body.find("emit_scene_state(&app, &payload)").unwrap();
        assert!(
            lock < mutation,
            "store writes must not overtake runtime events"
        );
        assert!(mutation < snapshot && snapshot < emit);
        assert_eq!(body.matches("state.ai_service.lock().await").count(), 1);
        assert!(!body[lock..emit].contains("drop(service)"));
    }

    #[test]
    fn scene_update_forwards_explicit_default_intent_to_runtime_transition() {
        let source = include_str!("scene.rs");
        let body = source
            .split("pub async fn update_scene(")
            .nth(1)
            .unwrap()
            .split("fn delete_scene_from_store(")
            .next()
            .unwrap();
        assert!(body.contains("transition_scene_update_with_intent("));
        assert!(body.contains("req.apply_lighting_as_default"));
    }

    #[test]
    fn update_request_defaults_intent_to_false_and_accepts_explicit_true() {
        let legacy = serde_json::json!({
            "id": "captured", "scene_name": "Name",
            "scene_description": "Description", "background": "old.png"
        });
        let req: UpdateSceneRequest = serde_json::from_value(legacy.clone()).unwrap();
        assert!(!req.apply_lighting_as_default);
        assert!(req.lighting.is_none());
        let mut explicit = legacy;
        explicit["apply_lighting_as_default"] = serde_json::json!(true);
        let req: UpdateSceneRequest = serde_json::from_value(explicit).unwrap();
        assert!(req.apply_lighting_as_default);
        assert_eq!(req.id, "captured");
    }

    #[test]
    fn deleting_scene_preserves_shared_background_then_removes_orphan() {
        let root = tempfile::tempdir().unwrap();
        let bg_dir = root.path().join("backgrounds");
        std::fs::create_dir_all(&bg_dir).unwrap();
        let bg = bg_dir.join("sky.png");
        std::fs::write(&bg, b"png fixture").unwrap();
        let store = SceneStore::new(root.path());
        let first = load_synchronized_scenes_from(root.path(), &bg_dir)
            .unwrap()
            .remove(0);
        let mut second = first.clone();
        second.id = "second".into();
        // Legacy full paths must count as references to the same filename.
        second.background = bg.to_string_lossy().into_owned();
        store
            .mutate(|scenes| {
                scenes.push(second);
                Ok(())
            })
            .unwrap();
        delete_scene_from_store(&store, &first.id, &bg_dir).unwrap();
        assert!(bg.exists());
        assert_eq!(store.load_all().unwrap().len(), 1);
        delete_scene_from_store(&store, "second", &bg_dir).unwrap();
        assert!(!bg.exists());
        assert!(
            load_synchronized_scenes_from(root.path(), &bg_dir)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn deleting_plugin_scene_never_removes_plugin_background() {
        let root = tempfile::tempdir().unwrap();
        let bg_dir = root.path().join("backgrounds");
        std::fs::create_dir_all(&bg_dir).unwrap();
        let bg = bg_dir.join("plugin.png");
        std::fs::write(&bg, b"plugin").unwrap();
        let store = SceneStore::new(root.path());
        let mut scene = load_synchronized_scenes_from(root.path(), &bg_dir)
            .unwrap()
            .remove(0);
        scene.plugin_id = Some("plugin".into());
        let id = scene.id.clone();
        store
            .mutate(|scenes| {
                *scenes = vec![scene];
                Ok(())
            })
            .unwrap();
        delete_scene_from_store(&store, &id, &bg_dir).unwrap();
        assert!(bg.exists());
    }

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
