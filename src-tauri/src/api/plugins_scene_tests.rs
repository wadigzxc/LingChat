use super::*;
use crate::ai_service::game_system::scene_transition::{
    SceneRuntimeState, SceneSelection, SceneStatePayload, transition_scene_selection,
};
use crate::ai_service::service::AIService;
use std::cell::Cell;
use std::path::Path;
use tokio::sync::Mutex;

async fn test_service(root: &Path) -> Mutex<AIService> {
    Mutex::new(
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

fn entry(root: &Path) -> PluginResourceEntry {
    let path = root.join("plugins/demo/backgrounds/sky.png");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"owned by plugin").unwrap();
    PluginResourceEntry {
        kind: ResourceKind::Backgrounds,
        key: "sky.png".into(),
        name: "Sky".into(),
        path,
        plugin_id: "demo".into(),
        conflict: false,
        hidden: false,
    }
}

async fn assert_queued<F: std::future::Future>(mut future: std::pin::Pin<&mut F>) {
    std::future::poll_fn(|cx| {
        assert!(
            future.as_mut().poll(cx).is_pending(),
            "operation must queue behind retained service guard"
        );
        std::task::Poll::Ready(())
    })
    .await;
}

#[tokio::test]
async fn plugin_rebuild_queues_before_collect_and_store_mutation() {
    let root = tempfile::tempdir().unwrap();
    let store = SceneStore::new(root.path());
    let service = test_service(root.path()).await;
    let e = entry(root.path());
    sync_plugin_scenes_with(&service, &store, async { vec![e] }, |_| Ok(()), |_| Ok(()))
        .await
        .unwrap();
    let before = std::fs::read(root.path().join("game_data/scenes.json")).unwrap();
    let (held, resolved) = super::super::scene::lock_scene_query(
        &service,
        || store.load_all().map_err(|e| e.to_string()),
        Some("plugin:demo/sky.png"),
        None,
    )
    .await
    .unwrap();
    let collected = Cell::new(false);
    let refresh = sync_plugin_scenes_with(
        &service,
        &store,
        async {
            collected.set(true);
            Vec::new()
        },
        |_| Ok(()),
        |_| Ok(()),
    );
    tokio::pin!(refresh);
    assert_queued(refresh.as_mut()).await;
    assert!(
        !collected.get(),
        "plugin visibility must be collected after service acquisition"
    );
    assert_eq!(
        std::fs::read(root.path().join("game_data/scenes.json")).unwrap(),
        before,
        "queued plugin rebuild must not remove a scene resolved by the retained guard"
    );
    let select = super::super::scene::lock_scene_query(
        &service,
        || store.load_all().map_err(|e| e.to_string()),
        Some("plugin:demo/sky.png"),
        None,
    );
    tokio::pin!(select);
    assert_queued(select.as_mut()).await;
    let transition = transition_scene_selection(
        &SceneRuntimeState::neutral(0),
        Some(SceneSelection::new(
            resolved.clone(),
            resolved.background.clone(),
        )),
    )
    .unwrap();
    super::super::scene::apply_scene_transition_with(
        &held,
        transition,
        |_| Ok(()),
        |payload| {
            assert!(service.try_lock().is_err());
            assert!(
                !collected.get(),
                "queued rebuild cannot overtake selection publication"
            );
            assert_eq!(payload.lighting_revision, 1);
            Ok(())
        },
    )
    .await
    .unwrap();
    drop(held);
    refresh.await.unwrap();
    assert!(
        select.await.is_err(),
        "later queued selection must not resurrect removed plugin scene"
    );
    assert!(store.load_all().unwrap().is_empty());
    assert_eq!(
        service
            .lock()
            .await
            .game_status
            .lock()
            .await
            .scene_runtime_state(),
        SceneRuntimeState::neutral(2)
    );
}

async fn plugin_manager(root: &Path) -> PluginManager {
    entry(root);
    std::fs::write(root.join("plugins/demo/manifest.toml"), "id = 'demo'\nname = 'Demo'\ndescription = 'Fixture'\nversion = '1.0.0'\nresources = ['backgrounds']\n").unwrap();
    let root = root.to_path_buf();
    let manager = tokio::task::spawn_blocking(move || {
        PluginManager::new(
            root,
            Arc::new(crate::ai_service::tools::registry::ToolRegistry::new()),
        )
    })
    .await
    .unwrap();
    manager.set_enabled("demo", true).await.unwrap();
    manager
}

async fn seed_active(
    service: &Mutex<AIService>,
    store: &SceneStore,
    manager: &PluginManager,
) -> Scene {
    sync_plugin_scenes_with(
        service,
        store,
        manager.visible_file_entries(ResourceKind::Backgrounds),
        |_| Ok(()),
        |_| Ok(()),
    )
    .await
    .unwrap();
    let scene = store.load_all().unwrap().remove(0);
    let guard = service.lock().await;
    let transition = transition_scene_selection(
        &SceneRuntimeState::neutral(40),
        Some(SceneSelection::new(scene.clone(), scene.background.clone())),
    )
    .unwrap();
    guard
        .game_status
        .lock()
        .await
        .apply_scene_transition(&transition);
    scene
}

#[derive(Clone, Copy)]
enum Removal {
    Hide,
    Disable,
    Delete,
}

#[tokio::test]
async fn active_plugin_hide_clears_persistence_runtime_and_publishes_under_guard() {
    assert_active_removal(Removal::Hide).await;
}

#[tokio::test]
async fn active_plugin_disable_clears_persistence_runtime_and_publishes_under_guard() {
    assert_active_removal(Removal::Disable).await;
}

#[tokio::test]
async fn active_plugin_delete_clears_persistence_runtime_and_publishes_under_guard() {
    assert_active_removal(Removal::Delete).await;
}

async fn assert_active_removal(removal: Removal) {
    let root = tempfile::tempdir().unwrap();
    let manager = plugin_manager(root.path()).await;
    let service = test_service(root.path()).await;
    let store = SceneStore::new(root.path());
    let scene = seed_active(&service, &store, &manager).await;
    let selection_path = root.path().join("last-scene.json");
    std::fs::write(
        &selection_path,
        serde_json::to_vec(&Some(&scene.id)).unwrap(),
    )
    .unwrap();
    match removal {
        Removal::Hide => manager
            .set_resource_hidden("demo", "backgrounds/sky.png", true)
            .await
            .unwrap(),
        Removal::Disable => manager.set_enabled("demo", false).await.unwrap(),
        Removal::Delete => manager.delete_plugin("demo").await.unwrap(),
    }
    let emitted = std::cell::RefCell::new(Vec::<SceneStatePayload>::new());
    sync_plugin_scenes_with(
        &service,
        &store,
        manager.visible_file_entries(ResourceKind::Backgrounds),
        |id| {
            assert!(service.try_lock().is_err());
            assert!(
                store.load_all().unwrap().is_empty(),
                "catalog must commit before selection persistence"
            );
            assert_eq!(id, None);
            std::fs::write(&selection_path, serde_json::to_vec(&id).unwrap())
                .map_err(|e| e.to_string())
        },
        |payload| {
            assert!(
                service.try_lock().is_err(),
                "publication retains service serialization"
            );
            emitted.borrow_mut().push(payload.clone());
            Ok(())
        },
    )
    .await
    .unwrap();
    let guard = service.lock().await;
    assert_eq!(
        guard.game_status.lock().await.scene_runtime_state(),
        SceneRuntimeState::neutral(42),
        "active plugin removal must not leave dangling identity/background/lighting"
    );
    assert_eq!(std::fs::read(&selection_path).unwrap(), b"null");
    {
        let events = emitted.borrow();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].lighting_revision, 42);
        assert!(events[0].scene.is_none());
        assert!(events[0].background.is_empty());
    }
    if matches!(removal, Removal::Delete) {
        assert!(
            !Path::new(&scene.background).exists(),
            "only PluginManager owns physical deletion"
        );
    } else {
        assert_eq!(
            std::fs::read(&scene.background).unwrap(),
            b"owned by plugin"
        );
    }
    drop(guard);
    // Repeating a refresh is not a second selection transition.
    sync_plugin_scenes_with(
        &service,
        &store,
        manager.visible_file_entries(ResourceKind::Backgrounds),
        |_| panic!("already neutral"),
        |_| panic!("duplicate clear event"),
    )
    .await
    .unwrap();
    assert_eq!(
        service
            .lock()
            .await
            .game_status
            .lock()
            .await
            .lighting_revision,
        42
    );
}

#[tokio::test]
async fn visible_plugin_rebuild_preserves_scene_defaults_and_active_override() {
    let root = tempfile::tempdir().unwrap();
    let manager = plugin_manager(root.path()).await;
    let service = test_service(root.path()).await;
    let store = SceneStore::new(root.path());
    let selected = seed_active(&service, &store, &manager).await;
    store
        .mutate(|scenes| {
            scenes[0].description = "User description".into();
            scenes[0].lighting = Some(
                crate::ai_service::game_system::scene_store::LightingParams {
                    master_intensity: 0.3,
                    ..Default::default()
                },
            );
            scenes[0].lighting_preset_id = Some("user:retained".into());
            scenes[0].lighting_preset_revision = Some(7);
            scenes[0].lighting_customized = true;
            scenes[0].created_at = "created".into();
            scenes[0].updated_at = "updated".into();
            let mut game_scene = scenes[0].clone();
            game_scene.id = "game-owned".into();
            game_scene.plugin_id = None;
            scenes.push(game_scene);
            Ok(())
        })
        .unwrap();
    let before = store.load_all().unwrap();
    let guard = service.lock().await;
    let mut gs = guard.game_status.lock().await;
    gs.active_lighting.master_intensity = 0.9;
    let runtime = gs.scene_runtime_state();
    drop(gs);
    drop(guard);
    sync_plugin_scenes_with(
        &service,
        &store,
        manager.visible_file_entries(ResourceKind::Backgrounds),
        |_| panic!("visible selection must not be repersisted"),
        |_| panic!("visible selection must not be reselected/published"),
    )
    .await
    .unwrap();
    let after = store.load_all().unwrap();
    let plugin = after.iter().find(|s| s.id == selected.id).unwrap();
    assert_eq!(
        serde_json::to_value(plugin).unwrap(),
        serde_json::to_value(&before[0]).unwrap(),
        "rebuild must retain user defaults/provenance for still-visible plugin scene"
    );
    let game = after.iter().find(|s| s.plugin_id.is_none()).unwrap();
    assert_eq!(
        serde_json::to_value(game).unwrap(),
        serde_json::to_value(&before[1]).unwrap()
    );
    assert_eq!(
        service
            .lock()
            .await
            .game_status
            .lock()
            .await
            .scene_runtime_state(),
        runtime
    );
}

#[cfg(windows)]
#[tokio::test]
async fn catalog_save_failure_does_not_clear_runtime_or_plugin_files() {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;
    let root = tempfile::tempdir().unwrap();
    let manager = plugin_manager(root.path()).await;
    let service = test_service(root.path()).await;
    let store = SceneStore::new(root.path());
    let scene = seed_active(&service, &store, &manager).await;
    let runtime = service
        .lock()
        .await
        .game_status
        .lock()
        .await
        .scene_runtime_state();
    let path = root.path().join("game_data/scenes.json");
    let before = std::fs::read(&path).unwrap();
    // Permit load, deny atomic replacement of the real catalog on Windows.
    let held_file = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0)
        .open(&path)
        .unwrap();
    manager.set_enabled("demo", false).await.unwrap();
    let error = sync_plugin_scenes_with(
        &service,
        &store,
        manager.visible_file_entries(ResourceKind::Backgrounds),
        |_| panic!("save failed before persistence"),
        |_| panic!("save failed before publication"),
    )
    .await
    .unwrap_err();
    assert!(error.starts_with("写入插件场景失败:"));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(
        service
            .lock()
            .await
            .game_status
            .lock()
            .await
            .scene_runtime_state(),
        runtime
    );
    assert!(Path::new(&scene.background).exists());
    drop(held_file);
}

#[tokio::test]
async fn selection_persistence_failure_keeps_runtime_but_catalog_removal_is_committed() {
    let root = tempfile::tempdir().unwrap();
    let manager = plugin_manager(root.path()).await;
    let service = test_service(root.path()).await;
    let store = SceneStore::new(root.path());
    let scene = seed_active(&service, &store, &manager).await;
    let runtime = service
        .lock()
        .await
        .game_status
        .lock()
        .await
        .scene_runtime_state();
    let selection_path = root.path().join("invalid-store-directory");
    std::fs::create_dir(&selection_path).unwrap();
    manager.set_enabled("demo", false).await.unwrap();
    let error = sync_plugin_scenes_with(
        &service,
        &store,
        manager.visible_file_entries(ResourceKind::Backgrounds),
        |_| {
            std::fs::write(&selection_path, b"null")
                .map_err(|e| format!("selection persistence: {e}"))
        },
        |_| panic!("persistence failure must not emit"),
    )
    .await
    .unwrap_err();
    assert!(error.starts_with("selection persistence:"));
    assert!(store.load_all().unwrap().is_empty());
    assert_eq!(
        service
            .lock()
            .await
            .game_status
            .lock()
            .await
            .scene_runtime_state(),
        runtime
    );
    assert!(Path::new(&scene.background).exists());
}

#[tokio::test]
async fn broadcast_failure_keeps_cleared_runtime_and_persistence_committed() {
    let root = tempfile::tempdir().unwrap();
    let manager = plugin_manager(root.path()).await;
    let service = test_service(root.path()).await;
    let store = SceneStore::new(root.path());
    let scene = seed_active(&service, &store, &manager).await;
    let selection_path = root.path().join("last-scene.json");
    manager.set_enabled("demo", false).await.unwrap();
    let game_status = service.lock().await.game_status.clone();
    let error = sync_plugin_scenes_with(
        &service,
        &store,
        manager.visible_file_entries(ResourceKind::Backgrounds),
        |id| {
            std::fs::write(&selection_path, serde_json::to_vec(&id).unwrap())
                .map_err(|e| e.to_string())
        },
        |payload| {
            assert!(service.try_lock().is_err());
            assert_eq!(
                game_status.try_lock().unwrap().scene_runtime_state(),
                SceneRuntimeState::neutral(42),
                "runtime applied and game-status guard released before publication"
            );
            let next = super::super::scene::lock_scene_query(
                &service,
                || store.load_all().map_err(|e| e.to_string()),
                Some(&scene.id),
                None,
            );
            tokio::pin!(next);
            futures_executor::block_on(assert_queued(next.as_mut()));
            assert_eq!(payload.lighting_revision, 42);
            Err("broadcast unavailable".into())
        },
    )
    .await
    .unwrap_err();
    assert_eq!(error, "broadcast unavailable");
    assert_eq!(std::fs::read(&selection_path).unwrap(), b"null");
    assert_eq!(
        game_status.lock().await.scene_runtime_state(),
        SceneRuntimeState::neutral(42)
    );
    assert!(store.load_all().unwrap().is_empty());
}
