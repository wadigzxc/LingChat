use std::fs::File;
use std::io::Write;
use std::path::Path;

use image::{ImageEncoder as _, RgbaImage, codecs::png::PngEncoder};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use zip::CompressionMethod;
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

use super::{ArchiveLimits, validate_linglight};
use crate::ai_service::game_system::lighting::LightingParams;

#[test]
fn validates_normal_package_and_stages_png() {
    let fixture = PackageFixture::valid();

    let validated = validate_linglight(&fixture.archive, ArchiveLimits::default()).unwrap();

    assert_eq!(validated.manifest.format, "linglight");
    assert_eq!(validated.manifest.version, 1);
    assert_eq!(validated.assets.len(), 1);
    assert_eq!(
        std::fs::read(&validated.assets[0].staged_path).unwrap(),
        fixture.png
    );
    assert!(validated.warnings.is_empty());
}

#[test]
fn validates_legacy_v1_package_emitted_by_previous_exporter() {
    let fixture = PackageFixture::legacy_v1_exporter();

    let validated = validate_linglight(&fixture.archive, ArchiveLimits::default()).unwrap();

    assert_eq!(validated.manifest.format, "linglight");
    assert_eq!(validated.manifest.version, 1);
    assert_eq!(
        validated.manifest.origin_id.as_deref(),
        Some("origin-fixture")
    );
    assert_eq!(validated.manifest.revision, 2);
    assert_eq!(validated.manifest.metadata.name, "Warm window");
    assert_eq!(validated.manifest.assets[0].media_type, "image/png");
    assert_eq!(
        validated.manifest.assets[0].byte_size,
        fixture.png.len() as u64
    );
    assert_eq!(validated.assets.len(), 1);
    assert_eq!(
        std::fs::read(&validated.assets[0].staged_path).unwrap(),
        fixture.png
    );
}

#[test]
fn both_v1_shapes_reject_unknown_fields_and_asset_tampering() {
    for legacy in [false, true] {
        for pointer in if legacy {
            vec![
                "",
                "/preset",
                "/origin",
                "/assets/0",
                "/preset/lighting",
                "/preset/lighting/main_light",
            ]
        } else {
            vec![
                "",
                "/metadata",
                "/assets/0",
                "/lighting",
                "/lighting/main_light",
            ]
        } {
            let mut fixture = if legacy {
                PackageFixture::legacy_v1_exporter()
            } else {
                PackageFixture::valid()
            };
            fixture.manifest.pointer_mut(pointer).unwrap()["unknown_field"] = json!(true);
            fixture.rewrite_current();
            assert!(
                validate_linglight(&fixture.archive, ArchiveLimits::default()).is_err(),
                "accepted unknown field at {pointer}"
            );
        }
        for field in [
            "sha256",
            if legacy { "byte_size" } else { "bytes" },
            "width",
            "path",
        ] {
            let mut fixture = if legacy {
                PackageFixture::legacy_v1_exporter()
            } else {
                PackageFixture::valid()
            };
            fixture.manifest["assets"][0][field] = match field {
                "sha256" => json!("a".repeat(64)),
                "path" => json!("../evil.png"),
                _ => json!(999),
            };
            fixture.rewrite_current();
            assert!(
                validate_linglight(&fixture.archive, ArchiveLimits::default()).is_err(),
                "accepted tampered {field}"
            );
        }
    }
}

#[test]
fn legacy_v1_checks_duplicated_layout_and_required_capabilities() {
    for (field, value) in [
        ("opacity", json!(0.1)),
        ("target", json!("character")),
        ("fit", json!("stretch")),
        ("target", json!("unknown-target")),
        ("placement", json!("unknown-placement")),
        ("blend_mode", json!("unknown-blend")),
        ("fit", json!("unknown-fit")),
    ] {
        let mut fixture = PackageFixture::legacy_v1_exporter();
        fixture.manifest["assets"][0][field] = value;
        fixture.rewrite_current();
        assert!(validate_linglight(&fixture.archive, ArchiveLimits::default()).is_err());
    }
    let mut fixture = PackageFixture::legacy_v1_exporter();
    fixture.manifest["required_capabilities"] = json!(["animation"]);
    fixture.rewrite_current();
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::UnsupportedRequiredFutureLayer(_)
    ));
    fixture.manifest["required_capabilities"] = json!([]);
    fixture.manifest["optional_capabilities"] = json!(["animation"]);
    fixture.rewrite_current();
    assert_eq!(
        validate_linglight(&fixture.archive, ArchiveLimits::default())
            .unwrap()
            .warnings
            .len(),
        1
    );
}

#[test]
fn validates_parameter_only_package_without_assets() {
    let mut fixture = PackageFixture::valid();
    fixture.manifest["assets"] = json!([]);
    fixture.manifest["lighting"]["asset_layers"] = json!([]);
    let manifest = fixture.manifest.to_string();
    fixture.rewrite(&[("manifest.json", manifest.as_bytes())]);

    let validated = validate_linglight(&fixture.archive, ArchiveLimits::default()).unwrap();

    assert!(validated.assets.is_empty());
}

#[test]
fn rejects_mismatched_task2_layer_layout_semantics() {
    let mut fixture = PackageFixture::valid();
    fixture.manifest["assets"][0]["mediaType"] = json!("image/jpeg");
    fixture.rewrite_current();
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::LayerLayoutMismatch(_)
    ));
}

#[test]
fn rejects_non_zip_magic() {
    let fixture = PackageFixture::valid();
    std::fs::write(&fixture.archive, b"not a zip").unwrap();
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::NotZip
    ));
}

#[test]
fn rejects_missing_manifest() {
    let fixture = PackageFixture::valid();
    fixture.rewrite(&[("assets/window.png", &fixture.png)]);
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::MissingManifest
    ));
}

#[test]
fn rejects_duplicate_root_manifest() {
    let fixture = PackageFixture::valid();
    let manifest = fixture.manifest.to_string();
    write_zip_with_alias(
        &fixture.archive,
        &[
            ("manifest.json", manifest.as_bytes()),
            ("manifesz.json", manifest.as_bytes()),
            ("assets/window.png", &fixture.png),
        ],
        b"manifesz.json",
        b"manifest.json",
    );
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::DuplicateManifest
    ));
}

#[test]
fn rejects_path_traversal_absolute_drive_unc_backslash_nul_and_empty_segments() {
    for attack in [
        "../evil.png",
        "/evil.png",
        "C:/evil.png",
        "//server/share.png",
        "assets\\..\\evil.png",
        "assets/evil\0.png",
        "assets//evil.png",
    ] {
        let fixture = PackageFixture::valid();
        let manifest = fixture.manifest.to_string();
        fixture.rewrite(&[
            ("manifest.json", manifest.as_bytes()),
            (attack, &fixture.png),
        ]);
        assert!(
            matches!(validate_err(&fixture), super::LingLightError::UnsafePath(_)),
            "attack was accepted: {attack:?}"
        );
    }
}

#[test]
fn rejects_symlink_and_special_entries() {
    for mode in [0o120777, 0o010644] {
        let fixture = PackageFixture::valid();
        let manifest = fixture.manifest.to_string();
        write_zip_with_mode(
            &fixture.archive,
            &[
                ("manifest.json", manifest.as_bytes(), 0o100644),
                ("assets/window.png", &fixture.png, mode),
            ],
        );
        assert!(matches!(
            validate_err(&fixture),
            super::LingLightError::NonRegularFile(_)
        ));
    }
}

#[test]
fn rejects_duplicate_raw_path() {
    let fixture = PackageFixture::valid();
    let manifest = fixture.manifest.to_string();
    write_zip_with_alias(
        &fixture.archive,
        &[
            ("manifest.json", manifest.as_bytes()),
            ("assets/window.png", &fixture.png),
            ("assets/windox.png", &fixture.png),
        ],
        b"assets/windox.png",
        b"assets/window.png",
    );
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::DuplicateRawPath(_)
    ));
}

#[test]
fn rejects_normalized_path_collision() {
    let fixture = PackageFixture::valid();
    let manifest = fixture.manifest.to_string();
    fixture.rewrite(&[
        ("manifest.json", manifest.as_bytes()),
        ("assets/Window.png", &fixture.png),
        ("assets/window.png", &fixture.png),
    ]);
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::NormalizedPathCollision(_)
    ));
}

#[test]
fn rejects_actual_streamed_total_over_injected_limit() {
    let fixture = PackageFixture::valid();
    let limits = ArchiveLimits {
        max_total_uncompressed_bytes: 32,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&fixture.archive, limits).unwrap_err(),
        super::LingLightError::TotalUncompressedTooLarge { .. }
    ));
}

#[test]
fn rejects_actual_streamed_total_when_zip_header_underreports() {
    let fixture = PackageFixture::valid();
    patch_central_uncompressed_sizes(&fixture.archive, 1);
    let limits = ArchiveLimits {
        max_total_uncompressed_bytes: 32,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&fixture.archive, limits).unwrap_err(),
        super::LingLightError::TotalUncompressedTooLarge { .. }
    ));
}

#[test]
fn rejects_high_compression_ratio_before_staging() {
    let mut fixture = PackageFixture::valid();
    fixture.manifest["assets"] = json!([]);
    fixture.manifest["lighting"]["asset_layers"] = json!([]);
    fixture.manifest["metadata"]["description"] = json!("x".repeat(16 * 1024));
    let manifest = fixture.manifest.to_string();
    write_zip_deflated(&fixture.archive, &[("manifest.json", manifest.as_bytes())]);
    let limits = ArchiveLimits {
        max_compression_ratio: 2,
        ..ArchiveLimits::default()
    };

    assert!(matches!(
        validate_linglight(&fixture.archive, limits).unwrap_err(),
        super::LingLightError::CompressionRatioTooHigh { .. }
    ));
}

#[test]
fn rejects_archive_body_over_injected_limit() {
    let fixture = PackageFixture::valid();
    let limits = ArchiveLimits {
        max_archive_bytes: 4,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&fixture.archive, limits).unwrap_err(),
        super::LingLightError::ArchiveTooLarge { .. }
    ));
}

#[test]
fn rejects_manifest_over_its_independent_limit() {
    let fixture = PackageFixture::valid();
    let limits = ArchiveLimits {
        max_manifest_bytes: 32,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&fixture.archive, limits).unwrap_err(),
        super::LingLightError::ManifestTooLarge { .. }
    ));
}

#[test]
fn rejects_oversized_manifest_text_and_list_fields() {
    let mut long_text = PackageFixture::valid();
    long_text.manifest["metadata"]["description"] = json!("x".repeat(33));
    long_text.rewrite_current();
    let limits = ArchiveLimits {
        max_text_bytes: 32,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&long_text.archive, limits).unwrap_err(),
        super::LingLightError::InvalidManifest(_)
    ));

    let mut too_many_tags = PackageFixture::valid();
    too_many_tags.manifest["metadata"]["tags"] = json!(["a", "b", "c"]);
    too_many_tags.rewrite_current();
    let limits = ArchiveLimits {
        max_metadata_items: 2,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&too_many_tags.archive, limits).unwrap_err(),
        super::LingLightError::InvalidManifest(_)
    ));
}

#[test]
fn rejects_png_over_injected_byte_limit() {
    let fixture = PackageFixture::valid();
    let limits = ArchiveLimits {
        max_png_bytes: fixture.png.len() as u64 - 1,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&fixture.archive, limits).unwrap_err(),
        super::LingLightError::PngTooLarge { .. }
    ));
}

#[test]
fn rejects_more_than_eight_layers() {
    let mut fixture = PackageFixture::valid();
    let asset = fixture.manifest["assets"][0].clone();
    let layer = fixture.manifest["lighting"]["asset_layers"][0].clone();
    fixture.manifest["assets"] = Value::Array(
        (0..9)
            .map(|i| {
                let mut value = asset.clone();
                value["id"] = json!(format!("layer-{i}"));
                value["path"] = json!(format!("assets/{i}.png"));
                value
            })
            .collect(),
    );
    fixture.manifest["lighting"]["asset_layers"] = Value::Array(
        (0..9)
            .map(|i| {
                let mut value = layer.clone();
                value["id"] = json!(format!("layer-{i}"));
                value
            })
            .collect(),
    );
    let manifest = fixture.manifest.to_string();
    let names: Vec<String> = (0..9).map(|i| format!("assets/{i}.png")).collect();
    write_zip_owned(&fixture.archive, &manifest, &names, &fixture.png);
    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::TooManyLayers { .. }
    ));
}

#[test]
fn rejects_png_dimensions_over_injected_limit() {
    let fixture = PackageFixture::valid();
    let limits = ArchiveLimits {
        max_png_edge: 1,
        ..ArchiveLimits::default()
    };
    assert!(matches!(
        validate_linglight(&fixture.archive, limits).unwrap_err(),
        super::LingLightError::PngDimensionsTooLarge { .. }
    ));
}

#[test]
fn rejects_truncated_and_corrupt_png_streams() {
    for mut bad in [fixture_truncated_png(), fixture_corrupt_png()] {
        refresh_asset_metadata(&mut bad.manifest, &bad.png, 2, 3);
        bad.rewrite_current();
        assert!(matches!(
            validate_err(&bad),
            super::LingLightError::InvalidPng { .. }
        ));
    }
}

#[test]
fn rejects_extension_and_magic_mismatch() {
    let mut wrong_extension = PackageFixture::valid();
    wrong_extension.manifest["assets"][0]["path"] = json!("assets/window.jpg");
    let manifest = wrong_extension.manifest.to_string();
    wrong_extension.rewrite(&[
        ("manifest.json", manifest.as_bytes()),
        ("assets/window.jpg", &wrong_extension.png),
    ]);
    assert!(matches!(
        validate_err(&wrong_extension),
        super::LingLightError::InvalidPngExtension(_)
    ));

    let mut wrong_magic = PackageFixture::valid();
    wrong_magic.png = b"not a png stream".to_vec();
    refresh_asset_metadata(&mut wrong_magic.manifest, &wrong_magic.png, 2, 3);
    wrong_magic.rewrite_current();
    assert!(matches!(
        validate_err(&wrong_magic),
        super::LingLightError::InvalidPngMagic(_)
    ));
}

#[test]
fn rejects_hash_size_and_dimension_mismatches() {
    for field in ["sha256", "bytes", "width"] {
        let mut fixture = PackageFixture::valid();
        fixture.manifest["assets"][0][field] = match field {
            "sha256" => json!("00"),
            _ => json!(999),
        };
        if field == "sha256" {
            fixture.manifest["lighting"]["asset_layers"][0]["asset_hash"] = json!("00");
        }
        fixture.rewrite_current();
        assert!(matches!(
            validate_err(&fixture),
            super::LingLightError::AssetMetadataMismatch { .. }
        ));
    }
}

#[test]
fn rejects_unknown_required_format_version_and_capability() {
    for (field, value) in [("format", json!("other")), ("version", json!(2))] {
        let mut fixture = PackageFixture::valid();
        fixture.manifest[field] = value;
        fixture.rewrite_current();
        assert!(validate_linglight(&fixture.archive, ArchiveLimits::default()).is_err());
    }
}

#[test]
fn warns_for_unknown_optional_future_capability() {
    let mut fixture = PackageFixture::valid();
    fixture.manifest["futureLayers"] = json!([{
        "id": "animated_layers",
        "required": false
    }]);
    fixture.rewrite_current();
    let result = validate_linglight(&fixture.archive, ArchiveLimits::default()).unwrap();
    assert_eq!(result.warnings.len(), 1);
    assert!(result.warnings[0].contains("animated_layers"));
}

#[test]
fn rejects_unknown_required_future_layer() {
    let mut fixture = PackageFixture::valid();
    fixture.manifest["futureLayers"] = json!([{
        "id": "animated_layers",
        "required": true
    }]);
    fixture.rewrite_current();

    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::UnsupportedRequiredFutureLayer(_)
    ));
}

#[test]
fn inspect_validation_keeps_optional_future_asset_as_warning() {
    let mut fixture = PackageFixture::valid();
    let webm = b"future webm payload";
    let hash = hex_sha256(webm);
    fixture.manifest["assets"][0]["path"] = json!("assets/animated.webm");
    fixture.manifest["assets"][0]["sha256"] = json!(hash);
    fixture.manifest["assets"][0]["bytes"] = json!(webm.len());
    fixture.manifest["assets"][0]["mediaType"] = json!("video/webm");
    fixture.manifest["assets"][0]["width"] = json!(1920);
    fixture.manifest["assets"][0]["height"] = json!(1080);
    fixture.manifest["lighting"]["asset_layers"][0]["asset_hash"] = json!(hash);
    fixture.manifest["lighting"]["asset_layers"][0]["media_type"] = json!("video/webm");
    let manifest = fixture.manifest.to_string();
    fixture.rewrite(&[
        ("manifest.json", manifest.as_bytes()),
        ("assets/animated.webm", webm),
    ]);

    let validated = validate_linglight(&fixture.archive, ArchiveLimits::default()).unwrap();

    assert!(validated.assets.is_empty());
    assert_eq!(validated.unsupported_assets.len(), 1);
    assert_eq!(validated.unsupported_assets[0].id, "layer-1");
    assert!(
        validated
            .warnings
            .iter()
            .any(|warning| warning.contains("video/webm"))
    );
}

#[test]
fn rejects_optional_future_asset_with_bad_size_or_hash() {
    for field in ["bytes", "sha256"] {
        let mut fixture = PackageFixture::valid();
        let webm = b"future webm payload";
        let hash = hex_sha256(webm);
        fixture.manifest["assets"][0]["path"] = json!("assets/animated.webm");
        fixture.manifest["assets"][0]["sha256"] = json!(hash);
        fixture.manifest["assets"][0]["mediaType"] = json!("video/webm");
        fixture.manifest["assets"][0]["bytes"] = json!(webm.len());
        fixture.manifest["lighting"]["asset_layers"][0]["asset_hash"] = json!(hash);
        fixture.manifest["lighting"]["asset_layers"][0]["media_type"] = json!("video/webm");
        if field == "bytes" {
            fixture.manifest["assets"][0][field] = json!(999);
        } else {
            fixture.manifest["assets"][0][field] = json!("00");
            fixture.manifest["lighting"]["asset_layers"][0]["asset_hash"] = json!("00");
        }
        let manifest = fixture.manifest.to_string();
        fixture.rewrite(&[
            ("manifest.json", manifest.as_bytes()),
            ("assets/animated.webm", webm),
        ]);

        assert!(matches!(
            validate_err(&fixture),
            super::LingLightError::AssetMetadataMismatch { .. }
        ));
    }
}

#[test]
fn rejects_required_unknown_asset_format() {
    let mut fixture = PackageFixture::valid();
    let webm = b"required future payload";
    let hash = hex_sha256(webm);
    fixture.manifest["assets"][0]["path"] = json!("assets/required.webm");
    fixture.manifest["assets"][0]["sha256"] = json!(hash);
    fixture.manifest["assets"][0]["mediaType"] = json!("video/webm");
    fixture.manifest["assets"][0]["bytes"] = json!(webm.len());
    fixture.manifest["assets"][0]["required"] = json!(true);
    fixture.manifest["lighting"]["asset_layers"][0]["asset_hash"] = json!(hash);
    fixture.manifest["lighting"]["asset_layers"][0]["media_type"] = json!("video/webm");
    fixture.manifest["lighting"]["asset_layers"][0]["required"] = json!(true);
    let manifest = fixture.manifest.to_string();
    fixture.rewrite(&[
        ("manifest.json", manifest.as_bytes()),
        ("assets/required.webm", webm),
    ]);

    assert!(matches!(
        validate_err(&fixture),
        super::LingLightError::UnsupportedRequiredAssetFormat { .. }
    ));
}

#[test]
fn validation_never_writes_formal_game_data_directories() {
    let fixture = PackageFixture::valid();
    let formal = fixture._temp.path().join("game_data");
    assert!(!formal.exists());
    let result = validate_linglight(&fixture.archive, ArchiveLimits::default()).unwrap();
    assert!(!formal.exists());
    assert!(
        result.assets[0]
            .staged_path
            .starts_with(result.staging.path())
    );
}

fn validate_err(fixture: &PackageFixture) -> super::LingLightError {
    validate_linglight(&fixture.archive, ArchiveLimits::default()).unwrap_err()
}

struct PackageFixture {
    _temp: TempDir,
    archive: std::path::PathBuf,
    png: Vec<u8>,
    manifest: Value,
}

impl PackageFixture {
    // Exact HEAD exporter contract, including duplicated asset layout fields.
    fn legacy_v1_exporter() -> Self {
        let mut fixture = Self::valid();
        let mut preset = fixture.manifest["metadata"].clone();
        preset["lighting"] = fixture.manifest["lighting"].clone();
        let mut asset = fixture.manifest["assets"][0].clone();
        let bytes = asset.as_object_mut().unwrap().remove("bytes").unwrap();
        asset.as_object_mut().unwrap().remove("mediaType");
        asset["byte_size"] = bytes;
        for field in [
            "target",
            "placement",
            "z_index",
            "opacity",
            "blend_mode",
            "fit",
        ] {
            asset[field] = fixture.manifest["lighting"]["asset_layers"][0][field].clone();
        }
        fixture.manifest = json!({
            "format": "linglight", "version": 1,
            "required_capabilities": [], "optional_capabilities": [],
            "preset": preset,
            "origin": { "id": "origin-fixture", "revision": 2, "created_by": null },
            "assets": [asset]
        });
        fixture.rewrite_current();
        fixture
    }

    fn valid() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let archive = temp.path().join("fixture.linglight");
        let png = transparent_png(2, 3);
        let hash = hex_sha256(&png);
        let mut lighting = serde_json::to_value(LightingParams::default()).unwrap();
        lighting["asset_layers"] = json!([{
            "id": "layer-1", "asset_hash": hash, "media_type": "image/png",
            "target": "both", "placement": "behind", "z_index": 0,
            "opacity": 0.75, "blend_mode": "screen", "fit": "cover", "required": false
        }]);
        let manifest = json!({
            "format": "linglight",
            "version": 1,
            "originId": "origin-fixture",
            "revision": 2,
            "metadata": {
                "name": "Warm window", "description": "fixture", "aliases": [],
                "tags": ["warm"], "category": "custom"
            },
            "lighting": lighting,
            "assets": [{
                "id": "layer-1", "path": "assets/window.png", "sha256": hash,
                "mediaType": "image/png", "bytes": png.len(), "width": 2, "height": 3,
                "required": false
            }],
            "futureLayers": []
        });
        write_zip(
            &archive,
            &[
                ("manifest.json", manifest.to_string().as_bytes()),
                ("assets/window.png", &png),
            ],
        );
        Self {
            _temp: temp,
            archive,
            png,
            manifest,
        }
    }

    fn rewrite(&self, entries: &[(&str, &[u8])]) {
        write_zip(&self.archive, entries);
    }

    fn rewrite_current(&self) {
        let manifest = self.manifest.to_string();
        self.rewrite(&[
            ("manifest.json", manifest.as_bytes()),
            ("assets/window.png", &self.png),
        ]);
    }
}

fn fixture_truncated_png() -> PackageFixture {
    let mut fixture = PackageFixture::valid();
    fixture.png.truncate(fixture.png.len() / 2);
    fixture
}

fn fixture_corrupt_png() -> PackageFixture {
    let mut fixture = PackageFixture::valid();
    let idat = fixture
        .png
        .windows(4)
        .position(|window| window == b"IDAT")
        .unwrap();
    fixture.png[idat + 5] ^= 0xff;
    fixture
}

fn refresh_asset_metadata(manifest: &mut Value, png: &[u8], width: u32, height: u32) {
    let hash = hex_sha256(png);
    manifest["assets"][0]["sha256"] = json!(hash);
    manifest["assets"][0]["bytes"] = json!(png.len());
    manifest["assets"][0]["width"] = json!(width);
    manifest["assets"][0]["height"] = json!(height);
    manifest["lighting"]["asset_layers"][0]["asset_hash"] = json!(hash);
}

fn write_zip_owned(path: &Path, manifest: &str, names: &[String], png: &[u8]) {
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(manifest.as_bytes()).unwrap();
    for name in names {
        zip.start_file(name, SimpleFileOptions::default()).unwrap();
        zip.write_all(png).unwrap();
    }
    zip.finish().unwrap();
}

fn write_zip_with_mode(path: &Path, entries: &[(&str, &[u8], u32)]) {
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    for (name, bytes, mode) in entries {
        if mode & 0o170000 == 0o120000 {
            zip.add_symlink(*name, "target", SimpleFileOptions::default())
                .unwrap();
        } else {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
    }
    zip.finish().unwrap();
    if let Some((name, _, mode)) = entries
        .iter()
        .find(|(_, _, mode)| mode & 0o170000 != 0o100000 && mode & 0o170000 != 0o120000)
    {
        patch_central_mode(path, name.as_bytes(), *mode);
    }
}

fn write_zip_with_alias(path: &Path, entries: &[(&str, &[u8])], from: &[u8], to: &[u8]) {
    assert_eq!(from.len(), to.len());
    write_zip(path, entries);
    let mut bytes = std::fs::read(path).unwrap();
    let mut replacements = 0;
    for index in 0..=bytes.len() - from.len() {
        if &bytes[index..index + from.len()] == from {
            bytes[index..index + from.len()].copy_from_slice(to);
            replacements += 1;
        }
    }
    assert_eq!(
        replacements, 2,
        "local and central names must both be patched"
    );
    std::fs::write(path, bytes).unwrap();
}

fn patch_central_mode(path: &Path, name: &[u8], mode: u32) {
    let mut bytes = std::fs::read(path).unwrap();
    let mut cursor = 0;
    let mut patched = false;
    while cursor + 46 <= bytes.len() {
        if bytes[cursor..].starts_with(b"PK\x01\x02") {
            let name_len = u16::from_le_bytes([bytes[cursor + 28], bytes[cursor + 29]]) as usize;
            let name_start = cursor + 46;
            if name_start + name_len <= bytes.len()
                && &bytes[name_start..name_start + name_len] == name
            {
                bytes[cursor + 5] = 3;
                bytes[cursor + 38..cursor + 42].copy_from_slice(&(mode << 16).to_le_bytes());
                patched = true;
                break;
            }
        }
        cursor += 1;
    }
    assert!(patched);
    std::fs::write(path, bytes).unwrap();
}

fn patch_central_uncompressed_sizes(path: &Path, declared_size: u32) {
    let mut bytes = std::fs::read(path).unwrap();
    let mut cursor = 0;
    let mut patched = 0;
    while cursor + 46 <= bytes.len() {
        if bytes[cursor..].starts_with(b"PK\x01\x02") {
            bytes[cursor + 24..cursor + 28].copy_from_slice(&declared_size.to_le_bytes());
            patched += 1;
        }
        cursor += 1;
    }
    assert!(patched >= 2);
    std::fs::write(path, bytes).unwrap();
}

fn transparent_png(width: u32, height: u32) -> Vec<u8> {
    let image = RgbaImage::from_pixel(width, height, image::Rgba([10, 20, 30, 128]));
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(
            image.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
    bytes
}

fn hex_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    for (name, bytes) in entries {
        zip.start_file(*name, SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}

fn write_zip_deflated(path: &Path, entries: &[(&str, &[u8])]) {
    let file = File::create(path).unwrap();
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, bytes) in entries {
        zip.start_file(*name, options).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}
