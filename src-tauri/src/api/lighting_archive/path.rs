use std::path::PathBuf;

use super::LingLightError;

pub(crate) fn normalize_archive_path(raw: &str) -> Result<String, LingLightError> {
    if raw.is_empty() || raw.contains('\0') {
        return Err(LingLightError::UnsafePath(raw.to_string()));
    }
    if raw.contains('\\') || raw.starts_with('/') || raw.starts_with("//") {
        return Err(LingLightError::UnsafePath(raw.to_string()));
    }
    let bytes = raw.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err(LingLightError::UnsafePath(raw.to_string()));
    }

    let mut normalized = Vec::new();
    for component in raw.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(LingLightError::UnsafePath(raw.to_string()));
        }
        let windows_normalized = component.trim_end_matches([' ', '.']).to_lowercase();
        if windows_normalized.is_empty() {
            return Err(LingLightError::UnsafePath(raw.to_string()));
        }
        normalized.push(windows_normalized);
    }
    Ok(normalized.join("/"))
}

pub(crate) fn staging_path(root: &std::path::Path, normalized: &str) -> PathBuf {
    root.join(normalized)
}
