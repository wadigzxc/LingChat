use super::export::{
    export_linglight_path, export_linglight_path_with_hooks, export_linglight_path_with_replacer,
    export_linglights_to_dir,
};
use super::{ArchiveLimits, validate_linglight};
use crate::ai_service::game_system::lighting::{LightingAssetLayer, LightingParams};
use crate::ai_service::game_system::lighting_presets::{LightingPresetDraft, LightingPresetStore};
use crate::api::lighting_archive::LingLightImportState;
use crate::api::lighting_archive::r#import::{
    ImportStrategy, commit_linglight_import_inner, inspect_linglight_path,
};
use image::{ImageEncoder as _, RgbaImage, codecs::png::PngEncoder};
use sha2::{Digest, Sha256};
use std::io::Read;

#[tokio::test]
async fn exports_parameter_only_user_preset_and_round_trips() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Portable Neutral".into(),
            description: "portable".into(),
            aliases: vec!["便携中性".into(), "Portable Neutral".into()],
            tags: vec!["soft".into()],
            category: "custom".into(),
            lighting: LightingParams::default(),
            ..Default::default()
        })
        .await
        .unwrap();
    let target = output.path().join("neutral.linglight");

    let result = export_linglight_path(&preset.id, &target, &store, data.path())
        .await
        .unwrap();
    let validated = validate_linglight(&result.path, ArchiveLimits::default()).unwrap();

    assert_eq!(validated.manifest.metadata.name, preset.name);
    assert_eq!(validated.manifest.metadata.aliases, preset.aliases);
    assert_eq!(validated.manifest.lighting, preset.lighting);
    assert_eq!(validated.manifest.origin_id, preset.origin_id);
    assert!(validated.assets.is_empty());
}

#[tokio::test]
async fn exports_png_and_preserves_asset_hash_on_round_trip() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let png = transparent_png();
    let hash = format!("{:x}", Sha256::digest(&png));
    let assets_dir = data.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets_dir).unwrap();
    std::fs::write(assets_dir.join(format!("{hash}.png")), &png).unwrap();
    let mut lighting = LightingParams::default();
    lighting.asset_layers.push(LightingAssetLayer {
        id: "mist".into(),
        asset_hash: hash.clone(),
        opacity: 0.7,
        required: true,
        ..Default::default()
    });
    let store = LightingPresetStore::new(data.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Mist".into(),
            aliases: vec!["雾".into(), "Haze".into()],
            lighting,
            ..Default::default()
        })
        .await
        .unwrap();
    let target = output.path().join("mist.linglight");

    export_linglight_path(&preset.id, &target, &store, data.path())
        .await
        .unwrap();
    let validated = validate_linglight(&target, ArchiveLimits::default()).unwrap();

    assert_eq!(validated.assets.len(), 1);
    assert_eq!(validated.assets[0].sha256, hash);
    assert_eq!(validated.manifest.lighting, preset.lighting);
    assert_eq!(
        std::fs::read(&validated.assets[0].staged_path).unwrap(),
        png
    );

    let destination_data = tempfile::tempdir().unwrap();
    let destination_store = LightingPresetStore::new(destination_data.path());
    let state = LingLightImportState::default();
    let token = inspect_linglight_path(&target, &state, &destination_store)
        .await
        .unwrap()
        .token;
    let imported = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &destination_store,
        destination_data.path(),
    )
    .await
    .unwrap()
    .preset;
    assert_eq!(imported.origin_id, preset.origin_id);
    assert_eq!(imported.aliases, preset.aliases);
    assert_eq!(imported.lighting.asset_layers[0].asset_hash, hash);
}

#[tokio::test]
async fn batch_export_creates_one_package_per_preset() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let first = store
        .create(LightingPresetDraft {
            name: "First".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let second = store
        .create(LightingPresetDraft {
            name: "Second".into(),
            ..Default::default()
        })
        .await
        .unwrap();

    let result = export_linglights_to_dir(
        &[first.id.clone(), second.id.clone()],
        output.path(),
        &store,
        data.path(),
    )
    .await;

    assert_eq!(result.items.len(), 2);
    assert!(result.items.iter().all(|item| item.error.is_none()));
    assert_eq!(std::fs::read_dir(output.path()).unwrap().count(), 2);
    for item in result.items {
        validate_linglight(item.path.as_ref().unwrap(), ArchiveLimits::default()).unwrap();
    }
}

#[tokio::test]
async fn temporary_write_failure_preserves_existing_target() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Write Failure".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let target = output.path().join("write-failure.linglight");
    std::fs::write(&target, b"old-package").unwrap();

    let result = export_linglight_path_with_hooks(
        &preset.id,
        &target,
        &store,
        data.path(),
        |_| anyhow::bail!("injected write failure"),
        |path, bytes| crate::utils::atomic_file::atomic_replace_file(path, bytes),
    )
    .await;

    let error = result.unwrap_err();
    assert!(format!("{error:#}").contains("injected write failure"));
    assert_eq!(std::fs::read(&target).unwrap(), b"old-package");
    assert_eq!(std::fs::read_dir(output.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn replace_failure_preserves_existing_target() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Atomic".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let target = output.path().join("atomic.linglight");
    std::fs::write(&target, b"old-package").unwrap();

    let result =
        export_linglight_path_with_replacer(&preset.id, &target, &store, data.path(), |_, _| {
            anyhow::bail!("injected rename failure")
        })
        .await;

    let error = result.unwrap_err();
    assert!(format!("{error:#}").contains("injected rename failure"));
    assert_eq!(std::fs::read(&target).unwrap(), b"old-package");
    assert_eq!(std::fs::read_dir(output.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn rejects_builtin_export_without_creating_output() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let target = output.path().join("builtin.linglight");
    let error = export_linglight_path("builtin:neutral", &target, &store, data.path())
        .await
        .unwrap_err();
    assert!(format!("{error:#}").contains("另存为用户副本"));
    assert!(!target.exists());
}

#[tokio::test]
async fn missing_corrupt_and_hash_mismatched_assets_leave_target_untouched() {
    for case in ["missing", "corrupt", "mismatch"] {
        let data = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let assets_dir = data.path().join("game_data/lighting_assets");
        std::fs::create_dir_all(&assets_dir).unwrap();
        let (hash, bytes) = match case {
            "missing" => ("0".repeat(64), None),
            "corrupt" => {
                let bytes = b"not-a-png".to_vec();
                (format!("{:x}", Sha256::digest(&bytes)), Some(bytes))
            },
            "mismatch" => ("1".repeat(64), Some(transparent_png())),
            _ => unreachable!(),
        };
        if let Some(bytes) = bytes {
            std::fs::write(assets_dir.join(format!("{hash}.png")), bytes).unwrap();
        }
        let mut lighting = LightingParams::default();
        lighting.asset_layers.push(LightingAssetLayer {
            id: case.into(),
            asset_hash: hash,
            ..Default::default()
        });
        let store = LightingPresetStore::new(data.path());
        let preset = store
            .create(LightingPresetDraft {
                name: case.into(),
                lighting,
                ..Default::default()
            })
            .await
            .unwrap();
        let target = output.path().join("existing.linglight");
        std::fs::write(&target, b"old-package").unwrap();
        assert!(
            export_linglight_path(&preset.id, &target, &store, data.path())
                .await
                .is_err(),
            "{case} asset unexpectedly exported"
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"old-package", "{case}");
        assert_eq!(std::fs::read_dir(output.path()).unwrap().count(), 1);
    }
}

#[tokio::test]
async fn manifest_omits_local_paths_scene_fields_and_internal_timestamps() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Portable".into(),
            last_used_at: Some("2026-01-01T00:00:00Z".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    let target = output.path().join("portable.linglight");
    export_linglight_path(&preset.id, &target, &store, data.path())
        .await
        .unwrap();
    let file = std::fs::File::open(&target).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let mut manifest = String::new();
    zip.by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    let wire: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    let object = wire.as_object().unwrap();
    for required in [
        "format",
        "version",
        "originId",
        "revision",
        "metadata",
        "lighting",
        "assets",
        "futureLayers",
    ] {
        assert!(
            object.contains_key(required),
            "missing {required}: {manifest}"
        );
    }
    for legacy in [
        "origin",
        "preset",
        "required_capabilities",
        "optional_capabilities",
    ] {
        assert!(
            !object.contains_key(legacy),
            "legacy key {legacy}: {manifest}"
        );
    }
    for forbidden in [
        data.path().to_string_lossy().as_ref(),
        "created_at",
        "updated_at",
        "last_used_at",
        "favorite",
        "background_path",
        "scene_id",
    ] {
        assert!(
            !manifest.contains(forbidden),
            "leaked {forbidden}: {manifest}"
        );
    }
}

#[tokio::test]
async fn normalizes_extension_and_atomically_overwrites_existing_target() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let preset = store
        .create(LightingPresetDraft {
            name: "Overwrite".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let requested = output.path().join("chosen.zip");
    let normalized = output.path().join("chosen.linglight");
    std::fs::write(&normalized, b"old-package").unwrap();
    let result = export_linglight_path(&preset.id, &requested, &store, data.path())
        .await
        .unwrap();
    assert_eq!(result.path, normalized);
    assert!(!requested.exists());
    validate_linglight(&normalized, ArchiveLimits::default()).unwrap();
    assert_eq!(std::fs::read_dir(output.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn batch_sanitizes_reserved_illegal_and_duplicate_names_stably() {
    let data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let mut ids = Vec::new();
    for name in ["CON", "CON", "bad:<>name. "] {
        ids.push(
            store
                .create(LightingPresetDraft {
                    name: name.into(),
                    ..Default::default()
                })
                .await
                .unwrap()
                .id,
        );
    }
    let result = export_linglights_to_dir(&ids, output.path(), &store, data.path()).await;
    let names: Vec<_> = result
        .items
        .iter()
        .map(|item| {
            item.path
                .as_ref()
                .unwrap()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(
        names,
        [
            "_CON.linglight",
            "_CON (2).linglight",
            "bad___name.linglight"
        ]
    );
}

#[tokio::test]
async fn exported_package_survives_inspect_and_commit_round_trip() {
    let source_data = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let source_store = LightingPresetStore::new(source_data.path());
    let mut lighting = LightingParams::default();
    lighting.master_intensity = 1.25;
    let source = source_store
        .create(LightingPresetDraft {
            name: "Round Trip".into(),
            lighting,
            ..Default::default()
        })
        .await
        .unwrap();
    let archive = output.path().join("round-trip.linglight");
    export_linglight_path(&source.id, &archive, &source_store, source_data.path())
        .await
        .unwrap();
    let destination_data = tempfile::tempdir().unwrap();
    let destination_store = LightingPresetStore::new(destination_data.path());
    let state = LingLightImportState::default();
    let token = inspect_linglight_path(&archive, &state, &destination_store)
        .await
        .unwrap()
        .token;
    let imported = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &destination_store,
        destination_data.path(),
    )
    .await
    .unwrap()
    .preset;
    assert_eq!(imported.origin_id, source.origin_id);
    assert_eq!(imported.revision, source.revision);
    assert_eq!(imported.lighting, source.lighting);
}

fn transparent_png() -> Vec<u8> {
    let image = RgbaImage::from_pixel(2, 3, image::Rgba([10, 20, 30, 128]));
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(image.as_raw(), 2, 3, image::ExtendedColorType::Rgba8)
        .unwrap();
    bytes
}

#[tokio::test]
async fn task18_rebuildable_neutral_fixture_inspect_commit_export_roundtrip() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../examples/lighting-presets/neutral.linglight");
    let data = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(data.path());
    let state = LingLightImportState::default();
    let inspection = inspect_linglight_path(&path, &state, &store).await.unwrap();
    assert!(inspection.warnings.is_empty());
    let imported = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap()
    .preset;
    assert_eq!(imported.name, "Portable Neutral");
    let neutral = crate::ai_service::game_system::lighting_presets::builtin_presets()
        .into_iter()
        .find(|preset| preset.id == "builtin:neutral")
        .unwrap();
    assert_eq!(imported.lighting, neutral.lighting);
    assert!(uuid::Uuid::parse_str(imported.id.strip_prefix("user:").unwrap()).is_ok());
    let output = tempfile::tempdir().unwrap();
    let target = output.path().join("neutral.linglight");
    export_linglight_path(&imported.id, &target, &store, data.path())
        .await
        .unwrap();
    let validated = validate_linglight(&target, ArchiveLimits::default()).unwrap();
    assert_eq!(validated.manifest.lighting, imported.lighting);
    assert_eq!(validated.manifest.origin_id, imported.origin_id);
    assert!(validated.assets.is_empty());
    let file = std::fs::File::open(target).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let mut manifest = String::new();
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    let wire: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    assert_eq!(wire["format"], "linglight");
    assert_eq!(wire["version"], 1);
    for forbidden in [
        "preset",
        "origin",
        "created_at",
        "updated_at",
        "scene",
        "background",
    ] {
        assert!(
            wire.get(forbidden).is_none(),
            "unexpected field: {forbidden}"
        );
    }
}
