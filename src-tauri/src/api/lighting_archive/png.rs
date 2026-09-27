use std::path::Path;

use image::{GenericImageView as _, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};

use super::limits::ArchiveLimits;
use super::model::ManifestAsset;
use super::validate::{LingLightError, StagedAsset};

const PNG_MAGIC: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

pub(crate) fn validate_asset(
    declared: &ManifestAsset,
    staged_path: &Path,
    limits: ArchiveLimits,
) -> Result<StagedAsset, LingLightError> {
    if !declared.path.ends_with(".png") {
        return Err(LingLightError::InvalidPngExtension(declared.path.clone()));
    }
    let bytes = std::fs::read(staged_path)?;
    if bytes.len() as u64 > limits.max_png_bytes {
        return Err(LingLightError::PngTooLarge {
            path: declared.path.clone(),
            limit: limits.max_png_bytes,
        });
    }
    if !bytes.starts_with(PNG_MAGIC) {
        return Err(LingLightError::InvalidPngMagic(declared.path.clone()));
    }

    let (probed_width, probed_height) =
        ImageReader::with_format(std::io::Cursor::new(&bytes), ImageFormat::Png)
            .into_dimensions()
            .map_err(|error| LingLightError::InvalidPng {
                path: declared.path.clone(),
                reason: error.to_string(),
            })?;
    if probed_width > limits.max_png_edge || probed_height > limits.max_png_edge {
        return Err(LingLightError::PngDimensionsTooLarge {
            path: declared.path.clone(),
            limit: limits.max_png_edge,
        });
    }

    let mut reader = ImageReader::with_format(std::io::Cursor::new(&bytes), ImageFormat::Png);
    let mut image_limits = image::Limits::default();
    image_limits.max_image_width = Some(limits.max_png_edge);
    image_limits.max_image_height = Some(limits.max_png_edge);
    image_limits.max_alloc = Some(limits.max_png_bytes.saturating_mul(8));
    reader.limits(image_limits);
    let decoded = reader
        .decode()
        .map_err(|error| LingLightError::InvalidPng {
            path: declared.path.clone(),
            reason: error.to_string(),
        })?;
    let (width, height) = decoded.dimensions();
    if width > limits.max_png_edge || height > limits.max_png_edge {
        return Err(LingLightError::PngDimensionsTooLarge {
            path: declared.path.clone(),
            limit: limits.max_png_edge,
        });
    }
    if !decoded.color().has_alpha() {
        return Err(LingLightError::PngNotTransparent(declared.path.clone()));
    }

    let actual_hash = format!("{:x}", Sha256::digest(&bytes));
    if declared.sha256 != actual_hash {
        return Err(LingLightError::AssetMetadataMismatch {
            path: declared.path.clone(),
            field: "sha256",
        });
    }
    if declared.byte_size != bytes.len() as u64 {
        return Err(LingLightError::AssetMetadataMismatch {
            path: declared.path.clone(),
            field: "byte_size",
        });
    }
    if declared.width != width || declared.height != height {
        return Err(LingLightError::AssetMetadataMismatch {
            path: declared.path.clone(),
            field: "dimensions",
        });
    }

    Ok(StagedAsset {
        id: declared.id.clone(),
        archive_path: declared.path.clone(),
        staged_path: staged_path.to_path_buf(),
        sha256: actual_hash,
        byte_size: bytes.len() as u64,
        width,
        height,
    })
}
