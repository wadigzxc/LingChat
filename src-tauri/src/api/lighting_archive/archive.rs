use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use zip::ZipArchive;

use super::limits::ArchiveLimits;
use super::path::{normalize_archive_path, staging_path};
use super::validate::LingLightError;

pub(crate) fn verify_zip_magic_and_size(
    path: &Path,
    max_archive_bytes: u64,
) -> Result<(), LingLightError> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > max_archive_bytes {
        return Err(LingLightError::ArchiveTooLarge {
            limit: max_archive_bytes,
        });
    }
    let mut file = File::open(path)?;
    let mut magic = [0_u8; 4];
    if file.read_exact(&mut magic).is_err()
        || (magic != [0x50, 0x4b, 0x03, 0x04] && magic != [0x50, 0x4b, 0x05, 0x06])
    {
        return Err(LingLightError::NotZip);
    }
    Ok(())
}

pub(crate) fn validate_central_directory_paths(
    path: &Path,
    max_entries: usize,
) -> Result<(), LingLightError> {
    let bytes = std::fs::read(path)?;
    let eocd = bytes
        .windows(4)
        .rposition(|window| window == b"PK\x05\x06")
        .ok_or_else(|| LingLightError::Zip("missing end of central directory".to_string()))?;
    if eocd + 22 > bytes.len() {
        return Err(LingLightError::Zip(
            "truncated end of central directory".to_string(),
        ));
    }
    let entry_count = u16::from_le_bytes([bytes[eocd + 10], bytes[eocd + 11]]) as usize;
    let central_offset = u32::from_le_bytes([
        bytes[eocd + 16],
        bytes[eocd + 17],
        bytes[eocd + 18],
        bytes[eocd + 19],
    ]) as usize;
    if entry_count > max_entries {
        return Err(LingLightError::TooManyEntries);
    }
    let mut cursor = central_offset;
    let mut raw_paths = HashSet::new();
    let mut normalized_paths = HashSet::new();
    let mut manifest_count = 0;
    for _ in 0..entry_count {
        if cursor + 46 > bytes.len() || !bytes[cursor..].starts_with(b"PK\x01\x02") {
            return Err(LingLightError::Zip(
                "invalid central directory entry".to_string(),
            ));
        }
        let name_len = u16::from_le_bytes([bytes[cursor + 28], bytes[cursor + 29]]) as usize;
        let extra_len = u16::from_le_bytes([bytes[cursor + 30], bytes[cursor + 31]]) as usize;
        let comment_len = u16::from_le_bytes([bytes[cursor + 32], bytes[cursor + 33]]) as usize;
        let name_start = cursor + 46;
        let next = name_start
            .checked_add(name_len + extra_len + comment_len)
            .filter(|next| *next <= bytes.len())
            .ok_or_else(|| LingLightError::Zip("truncated central directory entry".to_string()))?;
        let raw = std::str::from_utf8(&bytes[name_start..name_start + name_len])
            .map_err(|_| LingLightError::UnsafePath("non-UTF-8 entry name".to_string()))?
            .to_string();
        if raw == "manifest.json" {
            manifest_count += 1;
            if manifest_count > 1 {
                return Err(LingLightError::DuplicateManifest);
            }
        }
        if !raw_paths.insert(raw.clone()) {
            return Err(LingLightError::DuplicateRawPath(raw));
        }
        let normalized = normalize_archive_path(&raw)?;
        if !normalized_paths.insert(normalized) {
            return Err(LingLightError::NormalizedPathCollision(raw));
        }
        cursor = next;
    }
    if manifest_count == 0 {
        return Err(LingLightError::MissingManifest);
    }
    Ok(())
}

pub(crate) fn stage_archive(
    archive_path: &Path,
    staging_root: &Path,
    limits: ArchiveLimits,
) -> Result<HashMap<String, PathBuf>, LingLightError> {
    let mut archive = ZipArchive::new(File::open(archive_path)?)?;
    if archive.len() > limits.max_entries {
        return Err(LingLightError::TooManyEntries);
    }
    let mut raw_paths = HashSet::new();
    let mut normalized_paths = HashSet::new();
    let mut staged = HashMap::new();
    let mut total_actual = 0_u64;
    let mut manifest_count = 0_usize;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let raw = entry.name().to_string();
        if raw == "manifest.json" {
            manifest_count += 1;
            if manifest_count > 1 {
                return Err(LingLightError::DuplicateManifest);
            }
        }
        if !raw_paths.insert(raw.clone()) {
            return Err(LingLightError::DuplicateRawPath(raw));
        }
        let normalized = normalize_archive_path(&raw)?;
        if !normalized_paths.insert(normalized.clone()) {
            return Err(LingLightError::NormalizedPathCollision(raw));
        }
        ensure_regular_file(&entry, &raw)?;
        if normalized != "manifest.json" && !normalized.starts_with("assets/") {
            return Err(LingLightError::UnexpectedFile(raw));
        }

        let output = staging_path(staging_root, &normalized);
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut writer = File::create(&output)?;
        let mut buffer = [0_u8; 16 * 1024];
        loop {
            let read = entry.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total_actual = total_actual.saturating_add(read as u64);
            if total_actual > limits.max_total_uncompressed_bytes {
                return Err(LingLightError::TotalUncompressedTooLarge {
                    limit: limits.max_total_uncompressed_bytes,
                });
            }
            writer.write_all(&buffer[..read])?;
        }
        staged.insert(normalized, output);
    }
    if manifest_count == 0 {
        return Err(LingLightError::MissingManifest);
    }
    Ok(staged)
}

fn ensure_regular_file(entry: &zip::read::ZipFile<'_>, raw: &str) -> Result<(), LingLightError> {
    if entry.is_dir() {
        return Err(LingLightError::NonRegularFile(raw.to_string()));
    }
    if let Some(mode) = entry.unix_mode() {
        let kind = mode & 0o170000;
        if kind != 0 && kind != 0o100000 {
            return Err(LingLightError::NonRegularFile(raw.to_string()));
        }
    }
    Ok(())
}
