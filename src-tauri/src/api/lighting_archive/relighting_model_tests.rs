use super::LingLightManifest;
use serde_json::{Value, json};

fn manifest(lighting: Value) -> Value {
    json!({
        "format": "linglight", "version": 1,
        "originId": "relighting-contract", "revision": 1,
        "metadata": {"name": "Relighting", "description": "fixture", "aliases": [], "tags": [], "category": "test"},
        "lighting": lighting, "assets": [], "futureLayers": []
    })
}

#[test]
fn relighting_archive_known_root_null_is_omission_not_unknown_field() {
    serde_json::from_value::<LingLightManifest>(manifest(json!({"schema_version": 2})))
        .expect("the same legacy envelope without a new block must be valid");
    serde_json::from_value::<LingLightManifest>(manifest(
        json!({"schema_version": 2, "relighting": {}}),
    ))
    .expect("an explicitly empty valid new block must also be valid");
    let wire = manifest(json!({"schema_version": 2, "relighting": null}));
    let typed: LingLightManifest = serde_json::from_value(wire).unwrap();
    let serialized = serde_json::to_value(typed).unwrap();
    assert!(serialized["lighting"].get("relighting").is_none());
}

#[test]
fn relighting_archive_matches_shared_strict_accepted_domain() {
    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/utils/scene-lighting/__tests__/relighting-wire-cases.json"
    )))
    .unwrap();
    for row in fixture["cases"].as_array().unwrap() {
        let parsed = serde_json::from_value::<LingLightManifest>(manifest(row["input"].clone()));
        assert_eq!(
            parsed.is_ok(),
            row["archive_valid"].as_bool().unwrap(),
            "archive input {}",
            row["id"]
        );
        if let Ok(typed) = parsed {
            let wire = serde_json::to_value(&typed).unwrap();
            let reparsed: LingLightManifest = serde_json::from_value(wire).unwrap();
            assert_eq!(reparsed.lighting, typed.lighting);
        }
    }
}

#[test]
fn relighting_archive_nullable_exception_does_not_relax_unknown_or_nested_fields() {
    for lighting in [
        json!({"schema_version": 2, "unknown_root_key": null}),
        json!({"schema_version": 2, "relighting": {"unknown": null}}),
        json!({"schema_version": 2, "relighting": {"ambient": {"unknown": null}}}),
        json!({"schema_version": 2, "relighting": {"point_light": {"unknown": null}}}),
        json!({"schema_version": 2, "relighting": {"ambient": null}}),
        json!({"schema_version": 2, "relighting": {"point_light": null}}),
        json!({"schema_version": 2, "relighting": []}),
    ] {
        assert!(serde_json::from_value::<LingLightManifest>(manifest(lighting)).is_err());
    }
}

#[tokio::test]
async fn relighting_real_export_inspect_commit_preserves_snapshot_and_old_parameters() {
    use super::export::export_linglight_path;
    use super::r#import::{ImportStrategy, commit_linglight_import_inner, inspect_linglight_path};
    use super::{ArchiveLimits, LingLightImportState, validate_linglight};
    use crate::ai_service::game_system::lighting::LightingParams;
    use crate::ai_service::game_system::lighting_presets::{
        LightingPresetDraft, LightingPresetStore,
    };

    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../src/utils/scene-lighting/__tests__/relighting-wire-cases.json"
    )))
    .unwrap();
    let row = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == "canonical-relight-character")
        .unwrap();
    let mut lighting: LightingParams = serde_json::from_value(row["input"].clone()).unwrap();
    lighting.enabled = true;
    lighting.character.contrast = 1.7;
    lighting.main_light.enabled = true;
    let source = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(source.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Relighting snapshot".into(),
            aliases: vec!["受光".into()],
            lighting: lighting.clone(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(preset.lighting, lighting);
    let archive = output.path().join("relighting.linglight");
    export_linglight_path(&preset.id, &archive, &store, source.path())
        .await
        .unwrap();
    let validated = validate_linglight(&archive, ArchiveLimits::default()).unwrap();
    assert_eq!(validated.manifest.lighting, lighting);

    let destination = tempfile::tempdir().unwrap();
    let destination_store = LightingPresetStore::new(destination.path());
    let state = LingLightImportState::default();
    let inspection = inspect_linglight_path(&archive, &state, &destination_store)
        .await
        .unwrap();
    let imported = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &destination_store,
        destination.path(),
    )
    .await
    .unwrap()
    .preset;
    assert_eq!(imported.lighting, lighting);
    assert_eq!(imported.aliases, preset.aliases);
    assert_eq!(imported.origin_id, preset.origin_id);
    let saved: Value = serde_json::from_slice(
        &std::fs::read(destination.path().join("game_data/lighting_presets.json")).unwrap(),
    )
    .unwrap();
    let saved_presets = saved.as_array().expect("persisted preset catalog");
    let stored = saved_presets
        .iter()
        .find(|entry| entry["id"] == imported.id)
        .expect("imported persisted record");
    let loaded: LightingParams = serde_json::from_value(stored["lighting"].clone()).unwrap();
    assert_eq!(loaded, lighting);
    let reopened = LightingPresetStore::new(destination.path())
        .get(&imported.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reopened.lighting, lighting);
}
