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

#[tokio::test]
async fn task20_q7_existing_oversize_cas_rejects_before_read_and_preserves_state() {
    let fixture = Fixture::new("Oversize CAS", "origin-cas-limit");
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
    let json_path = data.path().join("game_data/lighting_presets.json");
    let old_json = std::fs::read(&json_path).unwrap();
    let hash = format!("{:x}", Sha256::digest(&fixture.png));
    let assets = data.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets).unwrap();
    let cas = assets.join(format!("{hash}.png"));
    std::fs::write(&cas, &fixture.png).unwrap();
    let limit = super::ArchiveLimits::default().max_png_bytes;
    File::options()
        .write(true)
        .open(&cas)
        .unwrap()
        .set_len(limit + 1)
        .unwrap();
    let old_cas = Sha256::digest(std::fs::read(&cas).unwrap());
    let old_metadata = std::fs::metadata(&cas).unwrap();
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    let probe = super::tests::bounded_io::ReadProbe::new(&cas, None);
    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert_eq!(std::fs::read(&json_path).unwrap(), old_json);
    assert_eq!(Sha256::digest(std::fs::read(&cas).unwrap()), old_cas);
    assert_eq!(
        std::fs::metadata(&cas).unwrap().modified().unwrap(),
        old_metadata.modified().unwrap()
    );
    assert_eq!(std::fs::read_dir(&assets).unwrap().count(), 1);
    assert_eq!(
        store
            .list(PresetSort::Name)
            .await
            .unwrap()
            .iter()
            .filter(|p| p.id.starts_with("user:"))
            .count(),
        1
    );
    let retry = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(retry.to_string().contains("已被使用"), "{retry}");
    assert_eq!(
        probe.bytes_read(),
        0,
        "existing CAS must reject before reading"
    );
    assert!(format!("{error:#}").contains("大小超出上限"), "{error:#}");
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

#[tokio::test]
async fn task20_q7_existing_cas_growth_stops_at_limit_plus_one_without_json_write() {
    let fixture = Fixture::new("Growing CAS", "origin-cas-growth");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    let hash = format!("{:x}", Sha256::digest(&fixture.png));
    let assets = data.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets).unwrap();
    let cas = assets.join(format!("{hash}.png"));
    std::fs::write(&cas, &fixture.png).unwrap();
    let unrelated = assets.join("shared.png");
    std::fs::write(&unrelated, b"shared").unwrap();
    let limit = super::ArchiveLimits::default().max_png_bytes;
    let probe = super::tests::bounded_io::ReadProbe::new(&cas, Some(limit + 64));
    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(!data.path().join("game_data/lighting_presets.json").exists());
    assert_eq!(std::fs::read(&unrelated).unwrap(), b"shared");
    let mut expected_cas = fixture.png.clone();
    expected_cas.resize((limit + 64) as usize, 0);
    assert_eq!(std::fs::read(&cas).unwrap(), expected_cas);
    assert_eq!(std::fs::read_dir(&assets).unwrap().count(), 2);
    let retry = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(retry.to_string().contains("已被使用"), "{retry}");
    assert_eq!(probe.opened_size(), Some(fixture.png.len() as u64));
    assert_eq!(
        probe.bytes_read(),
        limit + 1,
        "read-time growth must be bounded"
    );
    assert!(format!("{error:#}").contains("大小超出上限"), "{error:#}");
}

#[tokio::test]
async fn task20_q7_staged_oversize_png_rejects_before_read_without_formal_write() {
    let fixture = Fixture::new("Oversize staged", "origin-staged-limit");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let validated =
        super::validate_linglight(&fixture.archive, super::ArchiveLimits::default()).unwrap();
    let staged = validated.assets[0].staged_path.clone();
    let fingerprint = super::import_state::SourceFingerprint::capture(&fixture.archive).unwrap();
    let (token, _) = state.insert(validated, fingerprint).unwrap();
    let limit = super::ArchiveLimits::default().max_png_bytes;
    File::options()
        .write(true)
        .open(&staged)
        .unwrap()
        .set_len(limit + 1)
        .unwrap();
    let probe = super::tests::bounded_io::ReadProbe::new(&staged, None);
    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(!data.path().join("game_data/lighting_presets.json").exists());
    assert_eq!(
        std::fs::read_dir(data.path().join("game_data/lighting_assets"))
            .unwrap()
            .count(),
        0
    );
    let retry = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(retry.to_string().contains("已被使用"), "{retry}");
    assert_eq!(probe.bytes_read(), 0);
    assert!(format!("{error:#}").contains("大小超出上限"), "{error:#}");
}

#[tokio::test]
async fn task20_q7_staged_read_time_growth_is_bounded_without_formal_write() {
    let fixture = Fixture::new("Growing staged", "origin-staged-growth");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let validated =
        super::validate_linglight(&fixture.archive, super::ArchiveLimits::default()).unwrap();
    let staged = validated.assets[0].staged_path.clone();
    let fingerprint = super::import_state::SourceFingerprint::capture(&fixture.archive).unwrap();
    let (token, _) = state.insert(validated, fingerprint).unwrap();
    let limit = super::ArchiveLimits::default().max_png_bytes;
    let probe = super::tests::bounded_io::ReadProbe::new(&staged, Some(limit + 64));
    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(!data.path().join("game_data/lighting_presets.json").exists());
    assert_eq!(
        std::fs::read_dir(data.path().join("game_data/lighting_assets"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(probe.opened_size(), Some(fixture.png.len() as u64));
    assert_eq!(probe.bytes_read(), limit + 1);
    let retry = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(retry.to_string().contains("已被使用"), "{retry}");
    assert!(format!("{error:#}").contains("大小超出上限"), "{error:#}");
}

#[tokio::test]
async fn task20_q7_exact_cap_existing_cas_reaches_hash_check_without_mutation() {
    let fixture = Fixture::new("Exact CAS", "origin-cas-exact");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    let assets = data.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets).unwrap();
    let hash = format!("{:x}", Sha256::digest(&fixture.png));
    let cas = assets.join(format!("{hash}.png"));
    let limit = super::ArchiveLimits::default().max_png_bytes;
    let mut bytes = fixture.png.clone();
    bytes.resize(limit as usize, 0);
    std::fs::write(&cas, &bytes).unwrap();
    let probe = super::tests::bounded_io::ReadProbe::new(&cas, None);
    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("哈希文件名不一致"), "{error:#}");
    assert_eq!(probe.bytes_read(), limit);
    assert_eq!(std::fs::read(&cas).unwrap(), bytes);
    assert!(!data.path().join("game_data/lighting_presets.json").exists());
}

#[tokio::test]
async fn task20_q6_inspect_source_growth_rejects_without_formal_writes() {
    let fixture = Fixture::new("Growing archive", "origin-archive-growth");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let original_size = std::fs::metadata(&fixture.archive).unwrap().len();
    let limit = super::ArchiveLimits::default().max_archive_bytes;
    let probe = super::tests::bounded_io::ReadProbe::new(&fixture.archive, Some(limit + 64));
    let error = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap_err();
    assert!(
        matches!(error.downcast_ref::<super::LingLightError>(), Some(super::LingLightError::ArchiveTooLarge { limit: actual }) if *actual == limit)
    );
    assert_eq!(probe.opened_size(), Some(original_size));
    assert_eq!(probe.bytes_read(), limit + 1);
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
async fn task20_source_growth_after_inspect_rejects_commit_without_formal_writes() {
    let fixture = Fixture::new("Grown", "origin-grown");
    let data = tempfile::tempdir().unwrap();
    let state = LingLightImportState::default();
    let store = LightingPresetStore::new(data.path());
    let token = inspect_linglight_path(&fixture.archive, &state, &store)
        .await
        .unwrap()
        .token;
    std::fs::OpenOptions::new()
        .write(true)
        .open(&fixture.archive)
        .unwrap()
        .set_len(super::ArchiveLimits::default().max_archive_bytes + 1)
        .unwrap();
    let error = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("大小超出上限"), "{error}");
    assert!(!data.path().join("game_data").exists());
    let retry = commit_linglight_import_inner(
        &token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        data.path(),
    )
    .await
    .unwrap_err();
    assert!(retry.to_string().contains("已被使用"), "{retry}");
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
