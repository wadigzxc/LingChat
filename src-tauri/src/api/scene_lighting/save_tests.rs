use super::*;

fn create_request(id: Option<&str>) -> CreateSceneRequest {
    CreateSceneRequest {
        scene_name: "Saved".into(),
        scene_description: String::new(),
        background: String::new(),
        lighting: Some(LightingParams::default()),
        lighting_preset_id: id.map(str::to_string),
        lighting_preset_revision: Some(1),
        lighting_customized: false,
    }
}

#[tokio::test]
async fn successful_create_records_valid_final_source_but_allows_missing_history() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    for id in [
        Some("builtin:moonlight"),
        Some("user:deleted"),
        Some(""),
        None,
    ] {
        let saved = create_scene_with(&scenes, &presets, create_request(id))
            .await
            .unwrap();
        assert!(
            SceneStore::new(root.path())
                .find_by_id(&saved.id)
                .unwrap()
                .is_some()
        );
        if id == Some("builtin:moonlight") {
            assert!(
                LightingPresetStore::new(root.path())
                    .get(id.unwrap())
                    .await
                    .unwrap()
                    .unwrap()
                    .last_used_at
                    .is_some(),
                "successful create_scene must record its final saved source"
            );
        }
    }
    assert_eq!(scenes.load_all().unwrap().len(), 4);
    let json: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join("game_data/lighting_presets.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(json["recent"].as_object().unwrap().len(), 1);
}

async fn test_service(root: &Path) -> AIService {
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
    .await
}

fn update_request(scene: &Scene) -> UpdateSceneRequest {
    UpdateSceneRequest {
        id: scene.id.clone(),
        scene_name: scene.name.clone(),
        scene_description: scene.description.clone(),
        background: scene.background.clone(),
        lighting: scene.lighting.clone(),
        lighting_preset_id: scene.lighting_preset_id.clone(),
        lighting_preset_revision: scene.lighting_preset_revision,
        lighting_customized: scene.lighting_customized,
        apply_lighting_as_default: false,
        lighting_save_intent: false,
    }
}

#[tokio::test]
async fn successful_editor_update_records_final_source_not_ordinary_metadata() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    let mut req = update_request(&original);
    req.lighting_preset_id = Some("builtin:moonlight".into());
    let saved = update_scene_with(
        &service,
        &scenes,
        &presets,
        req,
        |s| s.background.clone(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    let used = presets
        .get("builtin:moonlight")
        .await
        .unwrap()
        .unwrap()
        .last_used_at;
    assert!(
        used.is_some(),
        "successful editor save records final source"
    );
    let before = std::fs::read(root.path().join("game_data/lighting_presets.json")).unwrap();
    let mut metadata = update_request(&saved);
    metadata.scene_name = "Rename only".into();
    let saved = update_scene_with(
        &service,
        &scenes,
        &presets,
        metadata,
        |s| s.background.clone(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read(root.path().join("game_data/lighting_presets.json")).unwrap(),
        before
    );
    let mut explicit = update_request(&saved);
    explicit.apply_lighting_as_default = true;
    let saved = update_scene_with(
        &service,
        &scenes,
        &presets,
        explicit,
        |s| s.background.clone(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert!(
        presets
            .get("builtin:moonlight")
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            > used,
        "identical explicit default save is still a use"
    );
    let mut deleted = update_request(&saved);
    deleted.lighting_preset_id = Some("user:deleted".into());
    update_scene_with(
        &service,
        &scenes,
        &presets,
        deleted,
        |s| s.background.clone(),
        |_| Ok(()),
    )
    .await
    .unwrap();
    let json: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join("game_data/lighting_presets.json")).unwrap(),
    )
    .unwrap();
    assert!(json["recent"].get("user:deleted").is_none());
}

#[tokio::test]
async fn failed_update_conversion_precedes_any_durable_scene_or_usage_write() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    {
        let mut gs = service.game_status.lock().await;
        gs.current_scene_id = Some(original.id.clone());
        gs.lighting_revision = u64::MAX;
    }
    let before = std::fs::read(root.path().join("game_data/scenes.json")).unwrap();
    let mut req = update_request(&original);
    req.lighting_preset_id = Some("builtin:neutral".into());
    req.apply_lighting_as_default = true;
    let error = update_scene_with(
        &service,
        &scenes,
        &presets,
        req,
        |s| s.background.clone(),
        |_| panic!("no publish"),
    )
    .await
    .unwrap_err();
    assert!(error.contains("revision 已达到上限"));
    assert!(
        std::fs::read(root.path().join("game_data/scenes.json")).unwrap() == before,
        "conversion failure must precede scene commit"
    );
    assert!(!root.path().join("game_data/lighting_presets.json").exists());
}

#[tokio::test]
async fn successful_current_default_save_records_runtime_final_source() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    {
        let mut gs = service.game_status.lock().await;
        gs.current_scene_id = Some(original.id.clone());
        gs.active_lighting.master_intensity = 1.6;
        gs.active_lighting_preset_id = Some("builtin:moonlight".into());
    }
    let payload = crate::api::scene_lighting::save_default_with(
        &service,
        &scenes,
        &presets,
        |s| s.background.clone(),
        |id| {
            assert_eq!(id, Some(original.id.as_str()));
            Ok(())
        },
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(payload.preset_id.as_deref(), Some("builtin:moonlight"));
    assert!(
        LightingPresetStore::new(root.path())
            .get("builtin:moonlight")
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            .is_some(),
        "default save must record the source of saved runtime snapshot"
    );
    assert_eq!(
        scenes
            .find_by_id(&original.id)
            .unwrap()
            .unwrap()
            .lighting
            .unwrap()
            .master_intensity,
        1.6
    );
}

#[tokio::test]
async fn failed_default_conversion_does_not_commit_scene_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    {
        let mut gs = service.game_status.lock().await;
        gs.current_scene_id = Some(original.id.clone());
        gs.active_lighting.master_intensity = 1.6;
        gs.active_lighting_preset_id = Some("builtin:moonlight".into());
        gs.lighting_revision = u64::MAX;
    }
    let before = std::fs::read(root.path().join("game_data/scenes.json")).unwrap();
    let error = crate::api::scene_lighting::save_default_with(
        &service,
        &scenes,
        &presets,
        |s| s.background.clone(),
        |_| panic!("no selection persistence"),
        |_| panic!("no event"),
    )
    .await
    .unwrap_err();
    assert!(error.contains("revision 已达到上限"));
    assert!(
        std::fs::read(root.path().join("game_data/scenes.json")).unwrap() == before,
        "default conversion must precede scene commit"
    );
    assert!(!root.path().join("game_data/lighting_presets.json").exists());
}

#[tokio::test]
async fn scene_create_usage_failure_reports_error_but_saved_scene_stays_committed() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    presets.set_favorite("builtin:neutral", true).await.unwrap();
    let path = root.path().join("game_data/lighting_presets.json");
    let before = std::fs::read(&path).unwrap();
    presets.fail_next_save_for_test();
    let error = create_scene_with(&scenes, &presets, create_request(Some("builtin:moonlight")))
        .await
        .unwrap_err();
    assert!(error.contains("injected preset save failure"));
    assert_eq!(
        SceneStore::new(root.path()).load_all().unwrap().len(),
        1,
        "scene and catalog are not a global atomic transaction"
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert!(
        LightingPresetStore::new(root.path())
            .get("builtin:moonlight")
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            .is_none()
    );
}

#[tokio::test]
async fn scene_update_publication_failure_keeps_saved_scene_and_runtime_without_usage() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    service.game_status.lock().await.current_scene_id = Some(original.id.clone());
    let mut req = update_request(&original);
    req.lighting_preset_id = Some("builtin:moonlight".into());
    req.apply_lighting_as_default = true;
    let error = update_scene_with(
        &service,
        &scenes,
        &presets,
        req,
        |s| s.background.clone(),
        |_| Err("scene publish failure".into()),
    )
    .await
    .unwrap_err();
    assert_eq!(error, "scene publish failure");
    assert_eq!(
        SceneStore::new(root.path())
            .find_by_id(&original.id)
            .unwrap()
            .unwrap()
            .lighting_preset_id
            .as_deref(),
        Some("builtin:moonlight")
    );
    assert_eq!(
        service
            .game_status
            .lock()
            .await
            .active_lighting_preset_id
            .as_deref(),
        Some("builtin:moonlight")
    );
    assert!(!root.path().join("game_data/lighting_presets.json").exists());
}

#[tokio::test]
async fn scene_update_usage_failure_preserves_catalog_but_keeps_prior_effects() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    service.game_status.lock().await.current_scene_id = Some(original.id.clone());
    let mut req = update_request(&original);
    req.lighting_preset_id = Some("builtin:neutral".into());
    req.apply_lighting_as_default = true;
    presets.fail_next_save_for_test();
    let emitted = std::cell::Cell::new(false);
    let error = update_scene_with(
        &service,
        &scenes,
        &presets,
        req,
        |s| s.background.clone(),
        |_| {
            emitted.set(true);
            Ok(())
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("injected preset save failure"));
    assert!(emitted.get());
    assert_eq!(
        SceneStore::new(root.path())
            .find_by_id(&original.id)
            .unwrap()
            .unwrap()
            .lighting_preset_id
            .as_deref(),
        Some("builtin:neutral")
    );
    assert_eq!(
        service
            .game_status
            .lock()
            .await
            .active_lighting_preset_id
            .as_deref(),
        Some("builtin:neutral")
    );
    assert!(!root.path().join("game_data/lighting_presets.json").exists());
}

#[tokio::test]
async fn default_save_selection_or_publication_or_usage_failure_has_explicit_partial_commit_boundary()
 {
    for failure in ["selection", "publication", "usage"] {
        let root = tempfile::tempdir().unwrap();
        let presets = LightingPresetStore::new(root.path());
        let scenes = SceneStore::new(root.path());
        let original = create_scene_with(&scenes, &presets, create_request(None))
            .await
            .unwrap();
        let service = test_service(root.path()).await;
        {
            let mut gs = service.game_status.lock().await;
            gs.current_scene_id = Some(original.id.clone());
            gs.active_lighting.master_intensity = 1.7;
            gs.active_lighting_source =
                crate::ai_service::game_system::scene_transition::SceneLightingSource::ManualPreset;
            gs.active_lighting_preset_id = Some("builtin:moonlight".into());
        }
        let runtime_before = service.game_status.lock().await.scene_runtime_state();
        let emitted = std::cell::Cell::new(false);
        if failure == "usage" {
            presets.fail_next_save_for_test();
        }
        let error = crate::api::scene_lighting::save_default_with(
            &service,
            &scenes,
            &presets,
            |s| s.background.clone(),
            |_| {
                if failure == "selection" {
                    Err("selection failure".into())
                } else {
                    Ok(())
                }
            },
            |_| {
                emitted.set(true);
                if failure == "publication" {
                    Err("publication failure".into())
                } else {
                    Ok(())
                }
            },
        )
        .await
        .unwrap_err();
        assert!(error.contains("failure"));
        let saved = SceneStore::new(root.path())
            .find_by_id(&original.id)
            .unwrap()
            .unwrap();
        assert_eq!(saved.lighting.unwrap().master_intensity, 1.7);
        let runtime = service.game_status.lock().await.scene_runtime_state();
        if failure == "selection" {
            assert_eq!(runtime, runtime_before);
            assert!(!emitted.get());
        } else {
            assert!(emitted.get());
            assert_eq!(
                runtime.lighting_revision,
                runtime_before.lighting_revision + 1
            );
        }
        assert!(!root.path().join("game_data/lighting_presets.json").exists());
    }
}

#[tokio::test]
async fn identical_editor_save_intent_records_usage_without_promoting_temporary_runtime() {
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let saved = create_scene_with(&scenes, &presets, create_request(Some("builtin:moonlight")))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    {
        let mut gs = service.game_status.lock().await;
        gs.current_scene_id = Some(saved.id.clone());
        gs.active_lighting.master_intensity = 0.4;
        gs.active_lighting_source =
            crate::ai_service::game_system::scene_transition::SceneLightingSource::ManualCustom;
    }
    let before = service.game_status.lock().await.scene_runtime_state();
    let used = presets
        .get("builtin:moonlight")
        .await
        .unwrap()
        .unwrap()
        .last_used_at;
    let mut req = update_request(&saved);
    req.lighting_save_intent = true;
    update_scene_with(
        &service,
        &scenes,
        &presets,
        req,
        |s| s.background.clone(),
        |payload| {
            assert_eq!(payload.active_lighting, before.active_lighting);
            assert_eq!(payload.source, before.source);
            Ok(())
        },
    )
    .await
    .unwrap();
    assert!(
        presets
            .get("builtin:moonlight")
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            > used,
        "explicit same-value editor save is a successful use"
    );
    let mut expected = before;
    expected.lighting_revision += 1;
    assert_eq!(
        service.game_status.lock().await.scene_runtime_state(),
        expected
    );
}

#[tokio::test]
async fn scene_save_retains_service_and_catalog_lock_until_publish_then_usage_commit() {
    use futures_util::poll;
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let user = presets.create(Default::default()).await.unwrap();
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = tokio::sync::Mutex::new(test_service(root.path()).await);
    let guard = service.lock().await;
    let held = guard.game_status.lock().await;
    let before = std::fs::read(root.path().join("game_data/lighting_presets.json")).unwrap();
    let mut req = update_request(&original);
    req.lighting_preset_id = Some(user.id.clone());
    let mut save = Box::pin(update_scene_with(
        &guard,
        &scenes,
        &presets,
        req,
        |s| s.background.clone(),
        |_| Ok(()),
    ));
    assert!(poll!(save.as_mut()).is_pending());
    let mut delete = Box::pin(presets.delete(&user.id));
    let mut select = Box::pin(service.lock());
    assert!(poll!(delete.as_mut()).is_pending());
    assert!(poll!(select.as_mut()).is_pending());
    assert_eq!(
        std::fs::read(root.path().join("game_data/lighting_presets.json")).unwrap(),
        before
    );
    drop(held);
    save.await.unwrap();
    assert!(
        poll!(select.as_mut()).is_pending(),
        "service guard survives save through successful usage write"
    );
    let removed = delete.await.unwrap().unwrap();
    assert!(
        removed.last_used_at.is_some(),
        "queued delete observes the successful save's committed usage"
    );
    assert!(presets.get(&user.id).await.unwrap().is_none());
    assert_eq!(
        scenes
            .find_by_id(&original.id)
            .unwrap()
            .unwrap()
            .lighting_preset_id
            .as_deref(),
        Some(user.id.as_str())
    );
    drop(guard);
    drop(select.await);
}

#[cfg(windows)]
#[tokio::test]
async fn real_scene_replacement_failure_never_records_usage_for_create_update_or_default() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = tempfile::tempdir().unwrap();
    let presets = LightingPresetStore::new(root.path());
    let scenes = SceneStore::new(root.path());
    let original = create_scene_with(&scenes, &presets, create_request(None))
        .await
        .unwrap();
    let service = test_service(root.path()).await;
    {
        let mut gs = service.game_status.lock().await;
        gs.current_scene_id = Some(original.id.clone());
        gs.active_lighting_preset_id = Some("builtin:moonlight".into());
    }
    let scene_path = root.path().join("game_data/scenes.json");
    let before = std::fs::read(&scene_path).unwrap();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(&scene_path)
        .unwrap();
    assert!(
        create_scene_with(&scenes, &presets, create_request(Some("builtin:moonlight")))
            .await
            .is_err()
    );
    let mut req = update_request(&original);
    req.apply_lighting_as_default = true;
    req.lighting_preset_id = Some("builtin:moonlight".into());
    assert!(
        update_scene_with(
            &service,
            &scenes,
            &presets,
            req,
            |s| s.background.clone(),
            |_| panic!("no emit")
        )
        .await
        .is_err()
    );
    assert!(
        crate::api::scene_lighting::save_default_with(
            &service,
            &scenes,
            &presets,
            |s| s.background.clone(),
            |_| panic!("no selection"),
            |_| panic!("no emit")
        )
        .await
        .is_err()
    );
    assert_eq!(std::fs::read(&scene_path).unwrap(), before);
    assert!(!root.path().join("game_data/lighting_presets.json").exists());
    assert_eq!(
        std::fs::read_dir(scene_path.parent().unwrap())
            .unwrap()
            .count(),
        1
    );
    drop(held);
    crate::api::scene_lighting::save_default_with(
        &service,
        &scenes,
        &presets,
        |s| s.background.clone(),
        |_| Ok(()),
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert!(
        LightingPresetStore::new(root.path())
            .get("builtin:moonlight")
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            .is_some()
    );
}
