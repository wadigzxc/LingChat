use std::collections::HashSet;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tempfile::TempDir;

use super::archive::{stage_archive, validate_central_directory_paths, verify_zip_magic_and_size};
use super::limits::ArchiveLimits;
use super::model::{LINGLIGHT_FORMAT, LINGLIGHT_VERSION, LingLightManifest};
use super::path::normalize_archive_path;
use super::png::validate_asset;

#[derive(Debug)]
pub struct ValidatedLingLight {
    pub manifest: LingLightManifest,
    pub assets: Vec<StagedAsset>,
    pub unsupported_assets: Vec<UnsupportedAsset>,
    pub warnings: Vec<String>,
    pub staging: TempDir,
}

#[derive(Debug, Clone)]
pub struct UnsupportedAsset {
    pub id: String,
    pub media_type: String,
}

#[derive(Debug, Clone)]
pub struct StagedAsset {
    pub id: String,
    pub archive_path: String,
    pub staged_path: PathBuf,
    pub sha256: String,
    pub byte_size: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum LingLightError {
    #[error("not a ZIP archive")]
    NotZip,
    #[error("archive body exceeds {limit} bytes")]
    ArchiveTooLarge { limit: u64 },
    #[error("archive has no root manifest.json")]
    MissingManifest,
    #[error("archive has more than one root manifest.json")]
    DuplicateManifest,
    #[error("unsafe archive path: {0}")]
    UnsafePath(String),
    #[error("duplicate raw archive path: {0}")]
    DuplicateRawPath(String),
    #[error("normalized archive path collision: {0}")]
    NormalizedPathCollision(String),
    #[error("archive entry is not a regular file: {0}")]
    NonRegularFile(String),
    #[error("archive contains an unrecognized file: {0}")]
    UnexpectedFile(String),
    #[error("archive has too many entries")]
    TooManyEntries,
    #[error("actual uncompressed data exceeds {limit} bytes")]
    TotalUncompressedTooLarge { limit: u64 },
    #[error("manifest.json exceeds {limit} bytes")]
    ManifestTooLarge { limit: u64 },
    #[error("archive entry compression ratio exceeds {limit}: {path}")]
    CompressionRatioTooHigh { path: String, limit: u64 },
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("unsupported required format {format} version {version}")]
    UnsupportedFormat { format: String, version: u32 },
    #[error("unsupported required future layer: {0}")]
    UnsupportedRequiredFutureLayer(String),
    #[error("unsupported required asset format for {id}: {media_type}")]
    UnsupportedRequiredAssetFormat { id: String, media_type: String },
    #[error("too many asset layers: {actual}, limit {limit}")]
    TooManyLayers { actual: usize, limit: usize },
    #[error("asset is missing from archive: {0}")]
    MissingAsset(String),
    #[error("PNG asset exceeds {limit} bytes: {path}")]
    PngTooLarge { path: String, limit: u64 },
    #[error("asset must use a .png extension: {0}")]
    InvalidPngExtension(String),
    #[error("asset does not have PNG magic: {0}")]
    InvalidPngMagic(String),
    #[error("invalid PNG content for {path}: {reason}")]
    InvalidPng { path: String, reason: String },
    #[error("PNG dimensions exceed {limit}x{limit}: {path}")]
    PngDimensionsTooLarge { path: String, limit: u32 },
    #[error("PNG must have an alpha channel: {0}")]
    PngNotTransparent(String),
    #[error("asset metadata mismatch for {path}: {field}")]
    AssetMetadataMismatch { path: String, field: &'static str },
    #[error("asset layer layout mismatch: {0}")]
    LayerLayoutMismatch(String),
    #[error("duplicate asset id: {0}")]
    DuplicateAssetId(String),
    #[error("ZIP error: {0}")]
    Zip(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<zip::result::ZipError> for LingLightError {
    fn from(value: zip::result::ZipError) -> Self {
        Self::Zip(value.to_string())
    }
}

pub fn validate_linglight(
    archive_path: &Path,
    limits: ArchiveLimits,
) -> Result<ValidatedLingLight, LingLightError> {
    verify_zip_magic_and_size(archive_path, limits.max_archive_bytes)?;
    validate_central_directory_paths(archive_path, limits.max_entries, limits.max_archive_bytes)?;
    let staging = tempfile::tempdir()?;
    let staged_files = stage_archive(archive_path, staging.path(), limits)?;
    let manifest_path = staged_files
        .get("manifest.json")
        .ok_or(LingLightError::MissingManifest)?;
    let manifest_bytes = std::fs::read(manifest_path)?;
    let manifest: LingLightManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| LingLightError::InvalidManifest(error.to_string()))?;
    validate_manifest_header(&manifest)?;
    validate_manifest_shape(&manifest, limits)?;
    if manifest.assets.len() > limits.max_layers {
        return Err(LingLightError::TooManyLayers {
            actual: manifest.assets.len(),
            limit: limits.max_layers,
        });
    }

    let expected_file_count = manifest.assets.len() + 1;
    if staged_files.len() != expected_file_count {
        let unexpected = staged_files
            .keys()
            .find(|path| {
                *path != "manifest.json" && !manifest.assets.iter().any(|a| &a.path == *path)
            })
            .cloned()
            .unwrap_or_else(|| "duplicate asset declaration".to_string());
        return Err(LingLightError::UnexpectedFile(unexpected));
    }

    let (mut warnings, mut unsupported_assets) = validate_future_layers(&manifest)?;

    validate_layer_layouts(&manifest)?;
    let mut ids = HashSet::new();
    let mut assets = Vec::with_capacity(manifest.assets.len());
    for declared in &manifest.assets {
        if !ids.insert(declared.id.clone()) {
            return Err(LingLightError::DuplicateAssetId(declared.id.clone()));
        }
        let normalized = normalize_archive_path(&declared.path)?;
        if normalized != declared.path {
            return Err(LingLightError::UnsafePath(declared.path.clone()));
        }
        if !declared.path.starts_with("assets/") {
            return Err(LingLightError::UnexpectedFile(declared.path.clone()));
        }
        let staged_path = staged_files
            .get(&declared.path)
            .ok_or_else(|| LingLightError::MissingAsset(declared.path.clone()))?;
        if declared.media_type != "image/png" {
            if declared.required {
                return Err(LingLightError::UnsupportedRequiredAssetFormat {
                    id: declared.id.clone(),
                    media_type: declared.media_type.clone(),
                });
            }
            validate_unsupported_asset_metadata(declared, staged_path)?;
            warnings.push(format!(
                "optional asset '{}' uses unsupported format '{}' and requires parameter-only import",
                declared.id, declared.media_type
            ));
            unsupported_assets.push(UnsupportedAsset {
                id: declared.id.clone(),
                media_type: declared.media_type.clone(),
            });
        } else {
            assets.push(validate_asset(declared, staged_path, limits)?);
        }
    }

    Ok(ValidatedLingLight {
        manifest,
        assets,
        unsupported_assets,
        warnings,
        staging,
    })
}

fn validate_unsupported_asset_metadata(
    declared: &super::model::ManifestAsset,
    staged_path: &Path,
) -> Result<(), LingLightError> {
    let bytes = std::fs::read(staged_path)?;
    if declared.byte_size != bytes.len() as u64 {
        return Err(LingLightError::AssetMetadataMismatch {
            path: declared.path.clone(),
            field: "byte_size",
        });
    }
    let actual_hash = format!("{:x}", Sha256::digest(&bytes));
    if declared.sha256 != actual_hash {
        return Err(LingLightError::AssetMetadataMismatch {
            path: declared.path.clone(),
            field: "sha256",
        });
    }
    Ok(())
}

fn validate_manifest_header(manifest: &LingLightManifest) -> Result<(), LingLightError> {
    if manifest.format != LINGLIGHT_FORMAT || manifest.version != LINGLIGHT_VERSION {
        return Err(LingLightError::UnsupportedFormat {
            format: manifest.format.clone(),
            version: manifest.version,
        });
    }
    Ok(())
}

fn validate_manifest_shape(
    manifest: &LingLightManifest,
    limits: ArchiveLimits,
) -> Result<(), LingLightError> {
    let metadata = &manifest.metadata;
    for (field, value) in [
        ("originId", manifest.origin_id.as_deref().unwrap_or("")),
        ("metadata.name", metadata.name.as_str()),
        ("metadata.description", metadata.description.as_str()),
        ("metadata.category", metadata.category.as_str()),
    ] {
        validate_text(field, value, limits.max_text_bytes)?;
    }
    for (field, values) in [
        ("metadata.aliases", metadata.aliases.as_slice()),
        ("metadata.tags", metadata.tags.as_slice()),
    ] {
        if values.len() > limits.max_metadata_items {
            return Err(LingLightError::InvalidManifest(format!(
                "{field} has too many items"
            )));
        }
        for value in values {
            validate_text(field, value, limits.max_text_bytes)?;
        }
    }
    if manifest.future_layers.len() > limits.max_layers {
        return Err(LingLightError::InvalidManifest(
            "futureLayers has too many items".to_string(),
        ));
    }
    for asset in &manifest.assets {
        for (field, value) in [
            ("assets[].id", asset.id.as_str()),
            ("assets[].path", asset.path.as_str()),
            ("assets[].sha256", asset.sha256.as_str()),
            ("assets[].mediaType", asset.media_type.as_str()),
        ] {
            validate_text(field, value, limits.max_text_bytes)?;
        }
    }
    Ok(())
}

fn validate_text(field: &str, value: &str, max_bytes: usize) -> Result<(), LingLightError> {
    if value.len() > max_bytes {
        return Err(LingLightError::InvalidManifest(format!(
            "{field} exceeds {max_bytes} bytes"
        )));
    }
    Ok(())
}

fn validate_future_layers(
    manifest: &LingLightManifest,
) -> Result<(Vec<String>, Vec<UnsupportedAsset>), LingLightError> {
    let mut warnings = Vec::with_capacity(manifest.future_layers.len());
    let mut unsupported = Vec::with_capacity(manifest.future_layers.len());
    for (index, layer) in manifest.future_layers.iter().enumerate() {
        let name = layer
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or("unnamed");
        if layer.get("required").and_then(|value| value.as_bool()) != Some(false) {
            return Err(LingLightError::UnsupportedRequiredFutureLayer(format!(
                "{name} at index {index}"
            )));
        }
        warnings.push(format!(
            "optional future layer '{name}' is unsupported and requires parameter-only import"
        ));
        unsupported.push(UnsupportedAsset {
            id: name.to_string(),
            media_type: layer
                .get("mediaType")
                .and_then(|value| value.as_str())
                .unwrap_or("future-layer")
                .to_string(),
        });
    }
    Ok((warnings, unsupported))
}

fn validate_layer_layouts(manifest: &LingLightManifest) -> Result<(), LingLightError> {
    if manifest.lighting.asset_layers.len() != manifest.assets.len() {
        return Err(LingLightError::LayerLayoutMismatch(
            "preset layer count differs from asset declarations".to_string(),
        ));
    }
    for asset in &manifest.assets {
        let Some(layer) = manifest
            .lighting
            .asset_layers
            .iter()
            .find(|layer| layer.id == asset.id)
        else {
            return Err(LingLightError::LayerLayoutMismatch(asset.id.clone()));
        };
        if layer.asset_hash != asset.sha256
            || layer.media_type != asset.media_type
            || layer.required != asset.required
        {
            return Err(LingLightError::LayerLayoutMismatch(asset.id.clone()));
        }
    }
    Ok(())
}
