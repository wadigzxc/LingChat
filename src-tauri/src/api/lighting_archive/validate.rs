use std::collections::HashSet;
use std::path::{Path, PathBuf};

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
    pub warnings: Vec<String>,
    pub staging: TempDir,
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
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("unsupported required format {format} version {version}")]
    UnsupportedFormat { format: String, version: u32 },
    #[error("unsupported required capability: {0}")]
    UnsupportedRequiredCapability(String),
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
    validate_central_directory_paths(archive_path, limits.max_entries)?;
    let staging = tempfile::tempdir()?;
    let staged_files = stage_archive(archive_path, staging.path(), limits)?;
    let manifest_path = staged_files
        .get("manifest.json")
        .ok_or(LingLightError::MissingManifest)?;
    let manifest_bytes = std::fs::read(manifest_path)?;
    let manifest: LingLightManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| LingLightError::InvalidManifest(error.to_string()))?;
    validate_manifest_header(&manifest)?;
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

    let warnings = manifest
        .optional_capabilities
        .iter()
        .map(|capability| {
            format!("optional capability '{capability}' is not supported and was ignored")
        })
        .collect();

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
        assets.push(validate_asset(declared, staged_path, limits)?);
    }
    validate_layer_layouts(&manifest)?;

    Ok(ValidatedLingLight {
        manifest,
        assets,
        warnings,
        staging,
    })
}

fn validate_manifest_header(manifest: &LingLightManifest) -> Result<(), LingLightError> {
    if manifest.format != LINGLIGHT_FORMAT || manifest.version != LINGLIGHT_VERSION {
        return Err(LingLightError::UnsupportedFormat {
            format: manifest.format.clone(),
            version: manifest.version,
        });
    }
    if let Some(capability) = manifest.required_capabilities.first() {
        return Err(LingLightError::UnsupportedRequiredCapability(
            capability.clone(),
        ));
    }
    Ok(())
}

fn validate_layer_layouts(manifest: &LingLightManifest) -> Result<(), LingLightError> {
    if manifest.preset.lighting.asset_layers.len() != manifest.assets.len() {
        return Err(LingLightError::LayerLayoutMismatch(
            "preset layer count differs from asset declarations".to_string(),
        ));
    }
    for asset in &manifest.assets {
        let Some(layer) = manifest
            .preset
            .lighting
            .asset_layers
            .iter()
            .find(|layer| layer.id == asset.id)
        else {
            return Err(LingLightError::LayerLayoutMismatch(asset.id.clone()));
        };
        if layer.asset_hash != asset.sha256
            || layer.media_type != "image/png"
            || layer.target != asset.target
            || layer.placement != asset.placement
            || layer.z_index != asset.z_index
            || layer.opacity != asset.opacity
            || layer.blend_mode != asset.blend_mode
            || layer.fit != asset.fit
            || layer.required != asset.required
        {
            return Err(LingLightError::LayerLayoutMismatch(asset.id.clone()));
        }
    }
    Ok(())
}
