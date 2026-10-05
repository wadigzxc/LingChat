use std::fs::File;
use std::io::Write;
use std::sync::Arc;

use image::{ImageEncoder as _, RgbaImage, codecs::png::PngEncoder};
use serde_json::json;
use sha2::{Digest, Sha256};
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

use super::r#import::{ImportStrategy, commit_linglight_import_inner, inspect_linglight_path};
use super::import_state::LingLightImportState;
use crate::ai_service::game_system::lighting::LightingParams;
use crate::ai_service::game_system::lighting_presets::{
    LightingPresetDraft, LightingPresetStore, PresetSort,
};

struct Fixture {
    _temp: tempfile::TempDir,
    archive: std::path::PathBuf,
    png: Vec<u8>,
}

impl Fixture {
    fn new(name: &str, origin: &str) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("source.linglight");
        let png = transparent_png();
        write_package(&archive, name, origin, &png);
        Self {
            _temp: temp,
            archive,
            png,
        }
    }
}

#[tokio::test]
async fn inspect_has_no_formal_writes_and_returns_opaque_summary() {
    let fixture = Fixture::new("Window", "origin-window");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());

    let inspection = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap();

    assert_eq!(inspection.preset.name, "Window");
    assert_eq!(inspection.assets.len(), 1);
    assert_eq!(inspection.token.len(), 32);
    assert!(!inspection.token.contains("source"));
    assert!(
        !serde_json::to_string(&inspection)
            .unwrap()
            .contains(fixture._temp.path().to_string_lossy().as_ref())
    );
    assert!(!data.path().join("game_data").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_commit_consumes_token_once_and_repeat_is_rejected() {
    let fixture = Fixture::new("Concurrent", "origin-concurrent");
    let data = tempfile::tempdir().unwrap();
    let state = Arc::new(LingLightImportState::default());
    let store = Arc::new(LightingPresetStore::new(data.path()));
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let run = |state: Arc<LingLightImportState>,
               store: Arc<LightingPresetStore>,
               barrier: Arc<tokio::sync::Barrier>,
               token: String,
               data: std::path::PathBuf| async move {
        barrier.wait().await;
        commit_linglight_import_inner(
            &token,
            ImportStrategy::KeepBoth,
            false,
            &state,
            &store,
            &data,
        )
        .await
    };
    let first = tokio::spawn(run(
        state.clone(),
        store.clone(),
        barrier.clone(),
        token.clone(),
        data.path().to_path_buf(),
    ));
    let second = tokio::spawn(run(
        state.clone(),
        store.clone(),
        barrier,
        token.clone(),
        data.path().to_path_buf(),
    ));
    let results = [first.await.unwrap(), second.await.unwrap()];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    assert!(
        commit_linglight_import_inner(
            &token,
            ImportStrategy::KeepBoth,
            false,
            &state,
            &store,
            data.path(),
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn fingerprint_change_after_inspect_is_rejected() {
    let fixture = Fixture::new("Changed", "origin-changed");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    std::fs::write(&fixture.archive, b"tampered").unwrap();

    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("发生变化"));
    assert!(!data.path().join("game_data/lighting_presets.json").exists());
}

#[tokio::test]
async fn commit_rechecks_conflicts_created_after_inspect() {
    let fixture = Fixture::new("Race", "origin-package");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    store
        .create(LightingPresetDraft {
            name: "Race".into(),
            ..Default::default()
        })
        .await
        .unwrap();

    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::OverwriteSameOrigin,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("同源"));
}

#[tokio::test]
async fn keep_both_generates_new_uuid_and_unique_name() {
    let fixture = Fixture::new("Duplicate", "origin-imported");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let existing = store
        .create(LightingPresetDraft {
            name: "Duplicate".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;

    let imported = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap()
    .preset;
    assert_ne!(imported.id, existing.id);
    assert!(imported.id.starts_with("user:"));
    assert_eq!(imported.origin_id.as_deref(), Some(imported.id.as_str()));
    assert_eq!(imported.name, "Duplicate (2)");
}

#[tokio::test]
async fn overwrite_requires_same_origin_and_preserves_id() {
    let first = Fixture::new("Original", "origin-same");
    let second = Fixture::new("Updated", "origin-same");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let first_token = inspect_linglight_path(&first.archive, &state, &store)
        .await
        .unwrap()
        .token;
    let original = commit_linglight_import_inner(
        &first_token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap()
    .preset;
    let second_token = inspect_linglight_path(&second.archive, &state, &store)
        .await
        .unwrap()
        .token;
    let updated = commit_linglight_import_inner(
        &second_token,
        ImportStrategy::OverwriteSameOrigin,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap()
    .preset;
    assert_eq!(updated.id, original.id);
    assert_eq!(updated.name, "Updated");

    let different = Fixture::new("Updated", "origin-different");
    let token = inspect_linglight_path(&different.archive, &state, &store)
        .await
        .unwrap()
        .token;
    assert!(
        commit_linglight_import_inner(
            &token,
            ImportStrategy::OverwriteSameOrigin,
            false,
            &state,
            &store,
            data.path(),
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("同源")
    );
}

#[tokio::test]
async fn builtin_preset_can_never_be_overwritten() {
    let fixture = Fixture::new("中性", "external-neutral");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let inspection = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap();
    assert!(
        inspection
            .conflicts
            .iter()
            .any(|conflict| conflict.existing_id == "builtin:neutral")
    );
    let error = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::OverwriteSameOrigin,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("内置"));
}

#[tokio::test]
async fn assets_are_content_addressed_and_deduplicated() {
    let first = Fixture::new("One", "origin-one");
    let second = Fixture::new("Two", "origin-two");
    assert_eq!(first.png, second.png);
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    for fixture in [&first, &second] {
        let token = inspect_linglight_path(&fixture.archive, &state, &store)
            .await
            .unwrap()
            .token;
        commit_linglight_import_inner(
            &token,
            ImportStrategy::KeepBoth,
            false,
            &state,
            &store,
            data.path(),
        )
        .await
        .unwrap();
    }
    let files = std::fs::read_dir(data.path().join("game_data/lighting_assets"))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].file_name().to_string_lossy().len(), 68);
}

#[tokio::test]
async fn parameter_only_strips_layers_and_returns_warning() {
    let fixture = Fixture::new("Parameters", "origin-parameters");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let inspection = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap();
    let result = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::KeepBoth,
        true,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap();
    assert!(result.preset.lighting.asset_layers.is_empty());
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.contains("仅导入参数"))
    );
    assert!(!data.path().join("game_data/lighting_assets").exists());
}

#[tokio::test]
async fn optional_future_asset_requires_parameter_only_and_leaves_no_dangling_layer() {
    let fixture = Fixture::new("Future", "origin-future");
    write_future_package(&fixture.archive, "Future", "origin-future");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());

    let inspection = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap();
    assert_eq!(inspection.assets.len(), 1);
    assert_eq!(inspection.assets[0].id, "future-1");
    assert!(
        inspection
            .warnings
            .iter()
            .any(|warning| warning.contains("video/webm"))
    );
    let error = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("仅导入参数"));

    let inspection = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap();
    let result = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::KeepBoth,
        true,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap();
    assert!(result.preset.lighting.asset_layers.is_empty());
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.contains("移除了 1 个素材层"))
    );
    assert!(!data.path().join("game_data/lighting_assets").exists());
}

#[tokio::test]
async fn preset_save_failure_preserves_old_json_and_shared_assets() {
    let fixture = Fixture::new("Failure", "origin-failure");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    store
        .create(LightingPresetDraft {
            name: "Existing".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let preset_path = data.path().join("game_data/lighting_presets.json");
    let old_json = std::fs::read(&preset_path).unwrap();
    let assets = data.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets).unwrap();
    let shared = assets.join("shared.png");
    std::fs::write(&shared, b"shared").unwrap();
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    store.fail_next_save_for_test();

    assert!(
        commit_linglight_import_inner(
            &token,
            ImportStrategy::KeepBoth,
            false,
            &state,
            &store,
            data.path(),
        )
        .await
        .is_err()
    );
    assert_eq!(std::fs::read(&preset_path).unwrap(), old_json);
    assert_eq!(std::fs::read(&shared).unwrap(), b"shared");
    assert!(std::fs::read_dir(&assets).unwrap().count() >= 2);
    assert_eq!(
        store
            .list(PresetSort::Name)
            .await
            .unwrap()
            .iter()
            .filter(|preset| preset.id.starts_with("user:"))
            .count(),
        1
    );
}

fn write_package(path: &std::path::Path, name: &str, origin: &str, png: &[u8]) {
    let hash = format!("{:x}", Sha256::digest(png));
    let mut lighting = serde_json::to_value(LightingParams::default()).unwrap();
    lighting["asset_layers"] = json!([{
        "id": "layer-1", "asset_hash": hash, "media_type": "image/png",
        "target": "both", "placement": "behind", "z_index": 0,
        "opacity": 0.75, "blend_mode": "screen", "fit": "cover", "required": false
    }]);
    let manifest = json!({
        "format": "linglight", "version": 1,
        "originId": origin, "revision": 2,
        "metadata": {
            "name": name, "description": "fixture", "aliases": [],
            "tags": ["test"], "category": "custom"
        },
        "lighting": lighting,
        "assets": [{
            "id": "layer-1", "path": "assets/untrusted-name.png", "sha256": hash,
            "mediaType": "image/png", "bytes": png.len(), "width": 2, "height": 3,
            "required": false
        }],
        "futureLayers": []
    });
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(manifest.to_string().as_bytes()).unwrap();
    zip.start_file("assets/untrusted-name.png", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(png).unwrap();
    zip.finish().unwrap();
}

fn write_future_package(path: &std::path::Path, name: &str, origin: &str) {
    let bytes = b"future webm payload";
    let hash = format!("{:x}", Sha256::digest(bytes));
    let mut lighting = serde_json::to_value(LightingParams::default()).unwrap();
    lighting["asset_layers"] = json!([{
        "id": "future-1", "asset_hash": hash, "media_type": "video/webm",
        "target": "both", "placement": "behind", "z_index": 0,
        "opacity": 0.75, "blend_mode": "screen", "fit": "cover", "required": false
    }]);
    let manifest = json!({
        "format": "linglight", "version": 1,
        "originId": origin, "revision": 2,
        "metadata": {
            "name": name, "description": "fixture", "aliases": [],
            "tags": ["test"], "category": "custom"
        },
        "lighting": lighting,
        "assets": [{
            "id": "future-1", "path": "assets/future.webm", "sha256": hash,
            "mediaType": "video/webm", "bytes": bytes.len(), "width": 2, "height": 3,
            "required": false
        }],
        "futureLayers": []
    });
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(manifest.to_string().as_bytes()).unwrap();
    zip.start_file("assets/future.webm", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(bytes).unwrap();
    zip.finish().unwrap();
}

fn transparent_png() -> Vec<u8> {
    let image = RgbaImage::from_pixel(2, 3, image::Rgba([10, 20, 30, 128]));
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(image.as_raw(), 2, 3, image::ExtendedColorType::Rgba8)
        .unwrap();
    bytes
}
