use super::asset::resolve_lighting_asset_in;
use super::commands::{
    apply_active_lighting_to_scene, preset_request_for_application, scene_for_runtime,
};
use super::model::PreviewRuntimeLightingBackup;
use super::transition::{
    RuntimeLightingRequest, restore_runtime_lighting, transition_runtime_lighting,
};
use crate::ai_service::game_system::lighting_presets::{LightingPresetDraft, LightingPresetStore};
use crate::ai_service::game_system::scene_store::LightingParams;
use crate::ai_service::game_system::scene_transition::{SceneLightingSource, SceneRuntimeState};
use crate::api::game::should_restore_startup_scene;

#[tokio::test]
async fn preset_application_reads_and_marks_one_latest_snapshot_for_manual_and_ai() {
    use crate::ai_service::game_system::lighting_presets::LightingPresetUpdate;
    for source in [
        SceneLightingSource::ManualPreset,
        SceneLightingSource::AiPreset,
    ] {
        let root = tempfile::tempdir().unwrap();
        let store = LightingPresetStore::new(root.path());
        let preset = store
            .create(LightingPresetDraft {
                name: "Selected".into(),
                ..LightingPresetDraft::default()
            })
            .await
            .unwrap();
        let mut lighting = LightingParams::default();
        lighting.master_intensity = 1.7;
        let updated = store
            .update(
                &preset.id,
                LightingPresetUpdate {
                    lighting: Some(lighting.clone()),
                    ..LightingPresetUpdate::default()
                },
            )
            .await
            .unwrap();
        let request = preset_request_for_application(&store, &preset.id, source)
            .await
            .unwrap();
        let stored = store.get(&preset.id).await.unwrap().unwrap();
        assert!(
            stored.last_used_at.is_some(),
            "application snapshot must already be marked used"
        );
        let transition =
            transition_runtime_lighting(&SceneRuntimeState::neutral(4), None, request).unwrap();
        assert_eq!(transition.active_lighting, stored.lighting);
        assert_eq!(transition.preset_revision, Some(updated.revision));
        assert_eq!(transition.preset_id.as_deref(), Some(preset.id.as_str()));
        assert_eq!(transition.source, source);
        store.delete(&preset.id).await.unwrap();
        assert_eq!(
            transition.active_lighting, lighting,
            "owned applied snapshot survives deletion"
        );
        assert!(
            preset_request_for_application(&store, &preset.id, source)
                .await
                .is_err()
        );
    }
}

#[test]
fn preset_command_entry_points_use_only_the_atomic_application_snapshot() {
    let source = include_str!("commands.rs");
    let ai = source
        .split("pub(crate) async fn apply_lighting_preset_for_service(")
        .nth(1)
        .unwrap()
        .split("async fn apply_lighting_preset_id_for_service(")
        .next()
        .unwrap();
    assert!(ai.contains("apply_lighting_preset_id_for_service"));
    assert!(ai.contains("&preset.id"));
    assert!(!ai.contains("preset.lighting"));
    let manual = source
        .split("pub async fn apply_lighting_preset(")
        .nth(1)
        .unwrap()
        .split("pub async fn apply_lighting_params(")
        .next()
        .unwrap();
    assert!(manual.contains("apply_lighting_preset_id_for_service"));
    assert!(!manual.contains(".get("));
    let shared = source
        .split("async fn apply_lighting_preset_id_for_service(")
        .nth(1)
        .unwrap()
        .split("#[tauri::command]")
        .next()
        .unwrap();
    assert!(shared.contains("preset_request_for_application(store, id, source).await?"));
    assert!(
        !shared.contains("take_for_application"),
        "must not mark a second snapshot after committing"
    );
}

#[tokio::test]
async fn preset_application_save_failure_returns_no_runtime_request() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Save failure".into(),
            ..LightingPresetDraft::default()
        })
        .await
        .unwrap();
    store.fail_next_save_for_test();
    let error = preset_request_for_application(&store, &preset.id, SceneLightingSource::AiPreset)
        .await
        .err()
        .unwrap();
    assert!(error.contains("injected preset save failure"));
    assert!(
        store
            .get(&preset.id)
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            .is_none()
    );
}

#[tokio::test]
async fn invalid_preset_application_source_does_not_mark_recent_use() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Invalid source".into(),
            ..LightingPresetDraft::default()
        })
        .await
        .unwrap();
    assert!(
        preset_request_for_application(&store, &preset.id, SceneLightingSource::Neutral)
            .await
            .is_err()
    );
    assert!(
        store
            .get(&preset.id)
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            .is_none()
    );
}

#[test]
fn manual_preset_transition_changes_only_runtime_lighting() {
    let current = SceneRuntimeState {
        current_scene_id: Some("scene-1".into()),
        background: "background.png".into(),
        active_lighting: LightingParams::default(),
        source: SceneLightingSource::SceneDefault,
        preset_id: None,
        preset_revision: None,
        customized: false,
        lighting_revision: 7,
    };
    let mut lighting = LightingParams::default();
    lighting.enabled = true;

    let transition = transition_runtime_lighting(
        &current,
        None,
        RuntimeLightingRequest::manual_preset(lighting.clone(), "user:preset".into(), 4),
    )
    .unwrap();

    assert_eq!(transition.current_scene_id, current.current_scene_id);
    assert_eq!(transition.background, current.background);
    assert_eq!(transition.active_lighting, lighting);
    assert_eq!(transition.source, SceneLightingSource::ManualPreset);
    assert_eq!(transition.preset_id.as_deref(), Some("user:preset"));
    assert_eq!(transition.preset_revision, Some(4));
    assert!(!transition.customized);
    assert_eq!(transition.lighting_revision, 8);

    let payload = serde_json::to_value(
        crate::ai_service::game_system::scene_transition::SceneStatePayload::from(&transition),
    )
    .unwrap();
    assert_eq!(payload["source"], "manual");
    assert_eq!(payload["preset_id"], "user:preset");
    assert_eq!(payload["preset_revision"], 4);
    assert_eq!(payload["lighting_revision"], 8);
}

#[test]
fn ai_preset_uses_the_same_preset_only_transition() {
    let current = SceneRuntimeState::neutral(2);
    let request =
        RuntimeLightingRequest::ai_preset(LightingParams::default(), "builtin:neutral".into(), 1);

    let transition = transition_runtime_lighting(&current, None, request).unwrap();

    assert_eq!(transition.source, SceneLightingSource::AiPreset);
    assert_eq!(transition.preset_id.as_deref(), Some("builtin:neutral"));
    assert_eq!(transition.lighting_revision, 3);
    let payload = serde_json::to_value(
        crate::ai_service::game_system::scene_transition::SceneStatePayload::from(&transition),
    )
    .unwrap();
    assert_eq!(payload["source"], "ai");
}

#[tokio::test]
async fn deleting_active_source_preset_keeps_runtime_snapshot_metadata() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Temporary".into(),
            lighting: LightingParams {
                master_intensity: 1.6,
                ..LightingParams::default()
            },
            ..LightingPresetDraft::default()
        })
        .await
        .unwrap();
    let transition = transition_runtime_lighting(
        &SceneRuntimeState::neutral(0),
        None,
        RuntimeLightingRequest::manual_preset(
            preset.lighting.clone(),
            preset.id.clone(),
            preset.revision,
        ),
    )
    .unwrap();

    store.delete(&preset.id).await.unwrap();

    assert!(store.get(&preset.id).await.unwrap().is_none());
    assert_eq!(transition.active_lighting.master_intensity, 1.6);
    assert_eq!(transition.preset_id.as_deref(), Some(preset.id.as_str()));
    assert_eq!(transition.source, SceneLightingSource::ManualPreset);
}

#[test]
fn manual_custom_normalizes_and_increments_once() {
    let current = SceneRuntimeState::neutral(10);
    let mut lighting = LightingParams::default();
    lighting.master_intensity = 99.0;

    let transition = transition_runtime_lighting(
        &current,
        None,
        RuntimeLightingRequest::manual_custom(lighting),
    )
    .unwrap();

    assert_eq!(transition.active_lighting.master_intensity, 2.0);
    assert_eq!(transition.source, SceneLightingSource::ManualCustom);
    assert!(transition.customized);
    assert_eq!(transition.lighting_revision, 11);
}

#[test]
fn manual_custom_preserves_preset_provenance() {
    let mut current = SceneRuntimeState::neutral(10);
    current.source = SceneLightingSource::ManualPreset;
    current.preset_id = Some("user:base".into());
    current.preset_revision = Some(7);

    let transition = transition_runtime_lighting(
        &current,
        None,
        RuntimeLightingRequest::manual_custom_from(&current, LightingParams::default()),
    )
    .unwrap();

    assert_eq!(transition.source, SceneLightingSource::ManualCustom);
    assert_eq!(transition.preset_id.as_deref(), Some("user:base"));
    assert_eq!(transition.preset_revision, Some(7));
    assert!(transition.customized);
    assert_eq!(transition.lighting_revision, 11);
}

#[test]
fn restoring_scene_uses_saved_default_lighting() {
    let current = SceneRuntimeState {
        current_scene_id: Some("scene-1".into()),
        ..SceneRuntimeState::neutral(8)
    };
    let mut expected = LightingParams::default();
    expected.master_intensity = 1.4;
    let scene = crate::ai_service::game_system::scene_store::Scene {
        id: "scene-1".into(),
        name: "Scene".into(),
        description: String::new(),
        background: "background.png".into(),
        lighting: Some(expected.clone()),
        lighting_preset_id: Some("user:saved".into()),
        lighting_preset_revision: Some(3),
        lighting_customized: false,
        created_at: "created".into(),
        updated_at: "updated".into(),
        plugin_id: None,
    };

    let transition = restore_runtime_lighting(&current, Some(scene)).unwrap();

    assert_eq!(transition.active_lighting, expected);
    assert_eq!(transition.source, SceneLightingSource::SceneDefault);
    assert_eq!(transition.preset_id.as_deref(), Some("user:saved"));
    assert_eq!(transition.preset_revision, Some(3));
    assert_eq!(transition.lighting_revision, 9);
}

#[test]
fn restoring_without_scene_keeps_background_and_uses_neutral_lighting() {
    let mut current = SceneRuntimeState::neutral(3);
    current.background = "script-background.png".into();
    current.active_lighting.master_intensity = 1.8;
    current.source = SceneLightingSource::ManualCustom;

    let transition = restore_runtime_lighting(&current, None).unwrap();

    assert!(transition.current_scene_id.is_none());
    assert_eq!(transition.background, "script-background.png");
    assert_eq!(transition.active_lighting, LightingParams::default());
    assert_eq!(transition.source, SceneLightingSource::Neutral);
    assert_eq!(transition.lighting_revision, 4);
}

#[test]
fn missing_current_scene_is_rejected_before_runtime_transition() {
    let root = tempfile::tempdir().unwrap();

    let error = scene_for_runtime(root.path(), Some("missing-scene")).unwrap_err();

    assert_eq!(error, "当前场景不存在: missing-scene");
}

#[test]
fn failed_transition_does_not_mutate_runtime() {
    let current = SceneRuntimeState::neutral(u64::MAX);
    let before = current.clone();

    let error = transition_runtime_lighting(
        &current,
        None,
        RuntimeLightingRequest::manual_custom(LightingParams::default()),
    )
    .unwrap_err();

    assert_eq!(error, "场景光影 revision 已达到上限");
    assert_eq!(current, before);
}

#[test]
fn preview_backup_restores_temporary_lighting_with_new_revision() {
    let mut original = SceneRuntimeState::neutral(5);
    original.active_lighting.master_intensity = 0.4;
    original.source = SceneLightingSource::ManualPreset;
    original.preset_id = Some("user:kept".into());
    original.preset_revision = Some(3);
    let backup = PreviewRuntimeLightingBackup::capture(&original);

    let mut during_preview = SceneRuntimeState::neutral(8);
    during_preview.current_scene_id = Some("preview-scene".into());
    during_preview.active_lighting.master_intensity = 1.8;
    during_preview.source = SceneLightingSource::SceneDefault;
    during_preview.customized = true;

    let restored = backup.restore_transition(&during_preview, None).unwrap();

    assert_eq!(restored.active_lighting.master_intensity, 0.4);
    assert_eq!(restored.source, SceneLightingSource::ManualPreset);
    assert_eq!(restored.preset_id.as_deref(), Some("user:kept"));
    assert_eq!(restored.preset_revision, Some(3));
    assert!(!restored.customized);
    assert_eq!(restored.lighting_revision, 9);
}

#[test]
fn resolves_only_existing_lowercase_hash_png_inside_asset_root() {
    let root = tempfile::tempdir().unwrap();
    let assets = root.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets).unwrap();
    let hash = "a".repeat(64);
    let expected = assets.join(format!("{hash}.png"));
    std::fs::write(&expected, b"png").unwrap();

    let resolved = resolve_lighting_asset_in(root.path(), &hash).unwrap();

    assert_eq!(resolved, expected.canonicalize().unwrap());
}

#[test]
fn rejects_invalid_or_missing_lighting_asset_hashes() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("game_data/lighting_assets")).unwrap();
    for invalid in [
        "a",
        &"A".repeat(64),
        &"g".repeat(64),
        &format!("{}../x", "a".repeat(64)),
        &format!("{}/x", "a".repeat(64)),
        &format!("{}\\x", "a".repeat(64)),
    ] {
        assert!(
            resolve_lighting_asset_in(root.path(), invalid).is_err(),
            "{invalid}"
        );
    }
    assert!(resolve_lighting_asset_in(root.path(), &"b".repeat(64)).is_err());

    let directory_hash = "c".repeat(64);
    std::fs::create_dir(
        root.path()
            .join(format!("game_data/lighting_assets/{directory_hash}.png")),
    )
    .unwrap();
    assert!(resolve_lighting_asset_in(root.path(), &directory_hash).is_err());
}

#[test]
fn rejects_lighting_asset_symlink_that_escapes_asset_root() {
    let root = tempfile::tempdir().unwrap();
    let assets = root.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets).unwrap();
    let outside = root.path().join("outside.png");
    std::fs::write(&outside, b"png").unwrap();
    let hash = "d".repeat(64);
    let link = assets.join(format!("{hash}.png"));

    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    #[cfg(windows)]
    if std::os::windows::fs::symlink_file(&outside, &link).is_err() {
        return;
    }

    assert!(resolve_lighting_asset_in(root.path(), &hash).is_err());
}

#[test]
fn saving_active_lighting_updates_scene_snapshot_and_metadata() {
    let mut scene = crate::ai_service::game_system::scene_store::Scene {
        id: "scene-1".into(),
        name: "Scene".into(),
        description: String::new(),
        background: "bg.png".into(),
        lighting: None,
        lighting_preset_id: None,
        lighting_preset_revision: None,
        lighting_customized: false,
        created_at: "old".into(),
        updated_at: "old".into(),
        plugin_id: None,
    };
    let mut runtime = SceneRuntimeState::neutral(4);
    runtime.active_lighting.master_intensity = 1.4;
    runtime.source = SceneLightingSource::ManualPreset;
    runtime.preset_id = Some("user:source".into());
    runtime.preset_revision = Some(6);
    runtime.customized = true;

    apply_active_lighting_to_scene(&mut scene, &runtime, "new".into());

    assert_eq!(scene.lighting.unwrap().master_intensity, 1.4);
    assert_eq!(scene.lighting_preset_id.as_deref(), Some("user:source"));
    assert_eq!(scene.lighting_preset_revision, Some(6));
    assert!(scene.lighting_customized);
    assert_eq!(scene.updated_at, "new");
}

#[test]
fn web_init_only_restores_scene_on_first_process_initialization() {
    assert!(should_restore_startup_scene(&SceneRuntimeState::neutral(0)));
    assert!(!should_restore_startup_scene(&SceneRuntimeState::neutral(
        1
    )));
}
