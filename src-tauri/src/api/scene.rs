use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::AppState;
use crate::ai_service::game_system::lighting_presets::LightingPresetStore;
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
    /// Explicit editor-save intent, independent of runtime default promotion.
    /// Ordinary background/metadata updates omit this; no frontend usage clock.
    #[serde(default)]
    pub lighting_save_intent: bool,
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

pub(crate) fn persist_scene_selection(
    app: &AppHandle,
    scene_id: Option<&str>,
) -> Result<(), String> {
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

/// Apply only a scene resolved or saved while the caller holds the service guard.
/// Startup/snapshot restore and default-save already own that guard: do not relock.
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
    apply_scene_transition_with(
        service,
        transition,
        |id| persist_scene_selection(app, id),
        |payload| emit_scene_state(app, payload),
    )
    .await
}

/// Caller retains the service guard through persistence, runtime update and publication.
/// Persistence failure leaves runtime unchanged; emit failure leaves the applied state committed.
pub(crate) async fn apply_scene_transition_with(
    service: &AIService,
    transition: crate::ai_service::game_system::scene_transition::SceneTransition,
    persist: impl FnOnce(Option<&str>) -> Result<(), String>,
    emit: impl FnOnce(&SceneStatePayload) -> Result<(), String>,
) -> Result<SceneStatePayload, String> {
    persist(transition.current_scene_id.as_deref())?;
    let mut gs = service.game_status.lock().await;
    gs.apply_scene_transition(&transition);
    let payload = SceneStatePayload::from(&transition);
    drop(gs);
    emit(&payload)?;
    Ok(payload)
}

pub(crate) async fn lock_scene_query<'a>(
    service: &'a tokio::sync::Mutex<AIService>,
    load: impl FnOnce() -> Result<Vec<Scene>, String>,
    id: Option<&str>,
    name: Option<&str>,
) -> Result<(tokio::sync::MutexGuard<'a, AIService>, Scene), String> {
    let (guard, scenes) = lock_scene_catalog(service, load).await?;
    let scene = match (id, name) {
        (Some(id), _) => scenes.iter().find(|scene| scene.id == id),
        (_, Some(name)) => scenes.iter().find(|scene| scene.name == name),
        _ => None,
    }
    .cloned()
    .ok_or_else(|| format!("未找到场景: {}", id.or(name).unwrap_or_default()))?;
    Ok((guard, scene))
}

pub(crate) async fn select_scene_by_query(
    app: &AppHandle,
    id: Option<&str>,
    name: Option<&str>,
) -> Result<SceneStatePayload, String> {
    let state = app.state::<AppState>();
    let (service, scene) =
        lock_scene_query(&state.ai_service, load_synchronized_scenes, id, name).await?;
    apply_scene_selection_for_service(app, &service, Some(&scene)).await
}

// Shared UI/AI selection seam. The returned guard must cover resolution,
// persistence, runtime application and event publication.
pub(crate) async fn lock_scene_catalog<'a>(
    service: &'a tokio::sync::Mutex<AIService>,
    load: impl FnOnce() -> Result<Vec<Scene>, String>,
) -> Result<(tokio::sync::MutexGuard<'a, AIService>, Vec<Scene>), String> {
    let guard = service.lock().await;
    let scenes = load()?;
    Ok((guard, scenes))
}

pub async fn select_scene_by_id(
    app: &AppHandle,
    scene_id: Option<&str>,
) -> Result<SceneStatePayload, String> {
    let state = app.state::<AppState>();
    let (service, scenes) = lock_scene_catalog(&state.ai_service, load_synchronized_scenes).await?;
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
pub async fn create_scene(app: AppHandle, req: CreateSceneRequest) -> Result<SceneInfo, String> {
    let state = app.state::<AppState>();
    let _service = state.ai_service.lock().await;
    let presets = app.state::<LightingPresetStore>();
    let store = SceneStore::new(&data_dir());
    let saved = create_scene_with(&store, &presets, req).await?;
    Ok(model_to_info(&saved))
}

pub(crate) async fn create_scene_with(
    store: &SceneStore,
    presets: &LightingPresetStore,
    req: CreateSceneRequest,
) -> Result<Scene, String> {
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
    let source = scene.lighting_preset_id.clone();
    presets
        .with_successful_use(source.as_deref(), |_| async move {
            store
                .mutate(|scenes| {
                    scenes.push(scene.clone());
                    Ok(scene)
                })
                .map_err(|e| format!("保存场景失败: {e}"))
        })
        .await
}

#[tauri::command]
pub async fn update_scene(app: AppHandle, req: UpdateSceneRequest) -> Result<SceneInfo, String> {
    // Serialize persistence and the resulting runtime event with other service
    // operations. Never wait for this lock after committing a captured snapshot:
    // another update could otherwise commit/apply first and then be rolled back.
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let store = SceneStore::new(&data_dir());
    let presets = app.state::<LightingPresetStore>();
    let saved = update_scene_with(
        &service,
        &store,
        &presets,
        req,
        |scene| normalize_background(&scene.background),
        |payload| emit_scene_state(&app, payload),
    )
    .await?;
    Ok(model_to_info(&saved))
}

pub(crate) async fn update_scene_with(
    service: &AIService,
    store: &SceneStore,
    presets: &LightingPresetStore,
    req: UpdateSceneRequest,
    resolve_background: impl FnOnce(&Scene) -> String,
    emit: impl FnOnce(&SceneStatePayload) -> Result<(), String>,
) -> Result<Scene, String> {
    let source = req.lighting_preset_id.clone();
    presets
        .with_successful_use_if(source.as_deref(), |_| async move {
            let runtime = service.game_status.lock().await.scene_runtime_state();
            let (updated, transition, record_usage) = store
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
                    let record_usage = req.lighting_save_intent
                        || req.apply_lighting_as_default
                        || previous.lighting != scene.lighting
                        || previous.lighting_preset_id != scene.lighting_preset_id
                        || previous.lighting_preset_revision != scene.lighting_preset_revision
                        || previous.lighting_customized != scene.lighting_customized;
                    // Validate/convert before scenes.json commits; native emit remains
                    // after commit and deliberately does not roll persistence back.
                    let background = resolve_background(scene);
                    let transition = transition_scene_update_with_intent(
                        &runtime,
                        &previous,
                        scene.clone(),
                        background,
                        req.apply_lighting_as_default,
                    )
                    .map_err(anyhow::Error::msg)?;
                    Ok((scene.clone(), transition, record_usage))
                })
                .map_err(|e| format!("更新场景失败: {e}"))?;
            if let Some(transition) = transition {
                let payload = SceneStatePayload::from(&transition);
                let mut game_status = service.game_status.lock().await;
                game_status.apply_scene_transition(&transition);
                drop(game_status);
                emit(&payload)?;
            }
            Ok((updated, record_usage))
        })
        .await
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
    // Match select/update: service -> store -> game status, through publication.
    let state = app.state::<AppState>();
    let service = state.ai_service.lock().await;
    let store = SceneStore::new(&data_dir());
    delete_scene_from_store(&store, &id, &super::backgrounds_dir())?;

    // 若删除的是当前选中场景，统一清空背景、光影、持久化 ID 并广播。
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
#[path = "scene_lighting/save_tests.rs"]
mod recent_save_tests;

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_service(root: &Path) -> tokio::sync::Mutex<AIService> {
        tokio::sync::Mutex::new(
            AIService::new(
                sea_orm::DatabaseConnection::default(),
                root.to_path_buf(),
                Default::default(),
                Default::default(),
                None,
                false,
                10,
                10,
                Default::default(),
                false,
            )
            .await,
        )
    }

    async fn assert_queued<F: std::future::Future>(future: std::pin::Pin<&mut F>) {
        let mut future = future;
        std::future::poll_fn(|cx| {
            assert!(
                future.as_mut().poll(cx).is_pending(),
                "operation must queue behind service guard"
            );
            std::task::Poll::Ready(())
        })
        .await;
    }

    #[tokio::test]
    async fn queued_ui_selection_reads_updated_scene_after_service_lock() {
        let root = tempfile::tempdir().unwrap();
        let bg = root.path().join("backgrounds");
        std::fs::create_dir_all(&bg).unwrap();
        std::fs::write(bg.join("old.png"), b"fixture").unwrap();
        let old = load_synchronized_scenes_from(root.path(), &bg)
            .unwrap()
            .remove(0);
        let store = SceneStore::new(root.path());
        let service = test_service(root.path()).await;
        let held = service.lock().await;
        let initial = transition_scene_selection(
            &crate::ai_service::game_system::scene_transition::SceneRuntimeState::neutral(20),
            Some(SceneSelection::new(old.clone(), old.background.clone())),
        )
        .unwrap();
        held.game_status
            .lock()
            .await
            .apply_scene_transition(&initial);
        let update = async {
            let service = service.lock().await;
            let updated = store
                .mutate(|scenes| {
                    scenes[0].background = "new.png".into();
                    scenes[0].lighting = Some(LightingParams {
                        master_intensity: 0.25,
                        ..LightingParams::default()
                    });
                    scenes[0].lighting_preset_id = Some("user:new".into());
                    scenes[0].lighting_preset_revision = Some(7);
                    scenes[0].lighting_customized = true;
                    Ok(scenes[0].clone())
                })
                .unwrap();
            let mut gs = service.game_status.lock().await;
            let transition = transition_scene_update_with_intent(
                &gs.scene_runtime_state(),
                &old,
                updated.clone(),
                updated.background.clone(),
                false,
            )
            .unwrap()
            .unwrap();
            gs.apply_scene_transition(&transition);
        };
        tokio::pin!(update);
        assert_queued(update.as_mut()).await;
        let select = lock_scene_catalog(&service, || store.load_all().map_err(|e| e.to_string()));
        tokio::pin!(select);
        assert_queued(select.as_mut()).await;
        drop(held);
        update.await;
        let (guard, scenes) = select.await.unwrap();
        let mut gs = guard.game_status.lock().await;
        let transition =
            transition_scene_by_id(&gs.scene_runtime_state(), &scenes, Some(&old.id), |scene| {
                scene.background.clone()
            })
            .unwrap();
        gs.apply_scene_transition(&transition);
        let payload = SceneStatePayload::from(&transition);
        assert_eq!(
            payload.background, "new.png",
            "a higher revision must not resurrect the old Scene clone"
        );
        assert_eq!(payload.active_lighting.master_intensity, 0.25);
        assert_eq!(payload.preset_id.as_deref(), Some("user:new"));
        assert_eq!(payload.preset_revision, Some(7));
        assert!(payload.customized);
        assert_eq!(payload.lighting_revision, 23);
        assert_eq!(gs.background, "new.png");
        assert_eq!(store.load_all().unwrap()[0].background, "new.png");
    }

    #[tokio::test]
    async fn queued_ai_name_selection_re_resolves_latest_exact_name() {
        let root = tempfile::tempdir().unwrap();
        let bg = root.path().join("backgrounds");
        std::fs::create_dir_all(&bg).unwrap();
        std::fs::write(bg.join("old.png"), b"fixture").unwrap();
        let old = load_synchronized_scenes_from(root.path(), &bg)
            .unwrap()
            .remove(0);
        let store = SceneStore::new(root.path());
        let service = test_service(root.path()).await;
        let held = service.lock().await;
        let update = async {
            let _guard = service.lock().await;
            store
                .mutate(|scenes| {
                    scenes[0].name = "Renamed".into();
                    let mut latest = scenes[0].clone();
                    latest.id = "B".into();
                    latest.name = old.name.clone();
                    latest.background = "latest.png".into();
                    latest.lighting = Some(LightingParams {
                        master_intensity: 0.6,
                        ..LightingParams::default()
                    });
                    scenes.push(latest);
                    Ok(())
                })
                .unwrap();
        };
        tokio::pin!(update);
        assert_queued(update.as_mut()).await;
        let select = lock_scene_query(
            &service,
            || store.load_all().map_err(|e| e.to_string()),
            None,
            Some(&old.name),
        );
        tokio::pin!(select);
        assert_queued(select.as_mut()).await;
        drop(held);
        update.await;
        let (guard, scene) = select.await.unwrap();
        let mut gs = guard.game_status.lock().await;
        let transition = transition_scene_selection(
            &gs.scene_runtime_state(),
            Some(SceneSelection::new(scene.clone(), scene.background.clone())),
        )
        .unwrap();
        gs.apply_scene_transition(&transition);
        assert_eq!(
            gs.current_scene_id.as_deref(),
            Some("B"),
            "AI must resolve the original name against the locked latest catalog, not pin its old ID"
        );
        assert_eq!(gs.background, "latest.png");
        assert_eq!(gs.active_lighting.master_intensity, 0.6);
    }

    #[tokio::test]
    async fn queued_selection_does_not_resurrect_deleted_scene() {
        let root = tempfile::tempdir().unwrap();
        let bg = root.path().join("backgrounds");
        std::fs::create_dir_all(&bg).unwrap();
        std::fs::write(bg.join("old.png"), b"fixture").unwrap();
        let old = load_synchronized_scenes_from(root.path(), &bg)
            .unwrap()
            .remove(0);
        let store = SceneStore::new(root.path());
        let service = test_service(root.path()).await;
        let held = service.lock().await;
        let ui = lock_scene_catalog(&service, || load_synchronized_scenes_from(root.path(), &bg));
        tokio::pin!(ui);
        assert_queued(ui.as_mut()).await;
        delete_scene_from_store(&store, &old.id, &bg).unwrap();
        let mut gs = held.game_status.lock().await;
        let clear = transition_scene_selection(&gs.scene_runtime_state(), None).unwrap();
        gs.apply_scene_transition(&clear);
        drop(gs);
        drop(held);
        let (guard, scenes) = ui.await.unwrap();
        let gs = guard.game_status.lock().await;
        assert!(
            transition_scene_by_id(&gs.scene_runtime_state(), &scenes, Some(&old.id), |scene| {
                scene.background.clone()
            })
            .is_err()
        );
        assert_eq!(gs.current_scene_id, None);
        assert_eq!(gs.lighting_revision, 1);
        drop(gs);
        drop(guard);
        let ai = lock_scene_query(
            &service,
            || store.load_all().map_err(|e| e.to_string()),
            Some(&old.id),
            Some(&old.name),
        )
        .await;
        assert!(matches!(ai, Err(error) if error == format!("未找到场景: {}", old.id)));
        assert!(!bg.join("old.png").exists());
    }

    #[tokio::test]
    async fn ai_scene_query_preserves_exact_id_priority_and_case_sensitive_first_name() {
        let root = tempfile::tempdir().unwrap();
        let bg = root.path().join("backgrounds");
        std::fs::create_dir_all(&bg).unwrap();
        std::fs::write(bg.join("old.png"), b"fixture").unwrap();
        let mut a = load_synchronized_scenes_from(root.path(), &bg)
            .unwrap()
            .remove(0);
        a.id = "A".into();
        a.name = "Exact Name".into();
        let mut b = a.clone();
        b.id = "B".into();
        b.background = "latest.png".into();
        let store = SceneStore::new(root.path());
        store
            .mutate(|scenes| {
                *scenes = vec![a, b];
                Ok(())
            })
            .unwrap();
        let service = test_service(root.path()).await;
        for (id, name, expected) in [
            (Some("B"), Some("Exact Name"), "B"),
            (None, Some("Exact Name"), "A"),
        ] {
            let (guard, scene) = lock_scene_query(
                &service,
                || store.load_all().map_err(|e| e.to_string()),
                id,
                name,
            )
            .await
            .unwrap();
            assert_eq!(scene.id, expected);
            assert!(
                service.try_lock().is_err(),
                "resolution returns the same retained service guard"
            );
            drop(guard);
        }
        for (id, name, missing) in [
            (Some("missing"), Some("Exact Name"), "missing"),
            (None, Some("exact name"), "exact name"),
        ] {
            let result = lock_scene_query(
                &service,
                || store.load_all().map_err(|e| e.to_string()),
                id,
                name,
            )
            .await;
            assert!(matches!(result, Err(error) if error == format!("未找到场景: {missing}")));
        }
    }

    #[test]
    fn selection_commands_retain_shared_guard_and_restore_does_not_relock_service() {
        let source = include_str!("scene.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap();
        let ui = source
            .split("pub async fn select_scene_by_id(")
            .nth(1)
            .unwrap()
            .split("pub(crate) async fn restore_startup_scene_selection(")
            .next()
            .unwrap();
        assert!(ui.contains("lock_scene_catalog(&state.ai_service"));
        assert!(ui.contains("apply_scene_transition_for_service(app, &service"));
        assert!(!ui.contains("drop(service)"));
        let ai = source
            .split("pub(crate) async fn select_scene_by_query(")
            .nth(1)
            .unwrap()
            .split("// Shared UI/AI selection seam")
            .next()
            .unwrap();
        assert!(ai.contains("lock_scene_query(&state.ai_service"));
        assert!(ai.contains("apply_scene_selection_for_service(app, &service"));
        assert!(!ai.contains("drop(service)"));
        let restore = source
            .split("pub(crate) async fn restore_startup_scene_selection(")
            .nth(1)
            .unwrap()
            .split("// ========== Tauri commands")
            .next()
            .unwrap();
        assert!(!restore.contains("ai_service.lock()"));
        assert!(!source.contains("pub async fn apply_scene_selection("));
        let tool = include_str!("../ai_service/tools/scene.rs")
            .split("impl Tool for SceneSwitch {")
            .nth(1)
            .unwrap()
            .split("pub struct LightingList;")
            .next()
            .unwrap();
        assert!(tool.contains("select_scene_by_query(&app, id.as_deref(), name.as_deref())"));
        assert!(!tool.contains("load_synchronized_scenes()"));
    }

    #[test]
    fn scene_delete_serializes_store_cleanup_and_clear_event_under_service_lock() {
        let source = include_str!("scene.rs");
        let body = source
            .split("pub async fn delete_scene(")
            .nth(1)
            .unwrap()
            .split("pub async fn select_scene(")
            .next()
            .unwrap();
        let lock = body.find("state.ai_service.lock().await").unwrap();
        let deletion = body.find("delete_scene_from_store(").unwrap();
        let clear = body.find("apply_scene_selection_for_service(").unwrap();
        assert!(
            lock < deletion && deletion < clear,
            "delete persistence must not overtake a locked selection/event"
        );
        assert!(!body[lock..clear].contains("drop(service)"));
    }

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
        let usage_lock = body.find("with_successful_use_if(").unwrap();
        let snapshot = body
            .find("service.game_status.lock().await.scene_runtime_state()")
            .unwrap();
        let mutation = body.find(".mutate(|scenes|").unwrap();
        let conversion = body
            .find("let transition = transition_scene_update_with_intent(")
            .unwrap();
        let emit = body.find("emit(&payload)").unwrap();
        assert!(lock < usage_lock && usage_lock < snapshot && snapshot < mutation);
        assert!(mutation < conversion && conversion < emit);
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
        assert!(!req.lighting_save_intent);
        assert!(req.lighting.is_none());
        let mut explicit = legacy;
        explicit["apply_lighting_as_default"] = serde_json::json!(true);
        explicit["lighting_save_intent"] = serde_json::json!(true);
        let req: UpdateSceneRequest = serde_json::from_value(explicit).unwrap();
        assert!(req.apply_lighting_as_default);
        assert!(req.lighting_save_intent);
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
