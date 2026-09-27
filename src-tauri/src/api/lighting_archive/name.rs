use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub(crate) fn sanitize_file_stem(name: &str) -> String {
    let mut sanitized = String::with_capacity(name.len());
    for character in name.chars() {
        if character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        {
            sanitized.push('_');
        } else {
            sanitized.push(character);
        }
    }
    let sanitized = sanitized.trim().trim_end_matches([' ', '.']);
    let mut result = if sanitized.is_empty() {
        "lighting-preset".to_string()
    } else {
        sanitized.to_string()
    };
    if is_windows_reserved(&result) {
        result.insert(0, '_');
    }
    result
}

pub(crate) fn existing_file_names(directory: &Path) -> HashSet<String> {
    std::fs::read_dir(directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().to_lowercase())
        .collect()
}

pub(crate) fn unique_export_path(
    directory: &Path,
    requested_stem: &str,
    used_names: &mut HashSet<String>,
) -> PathBuf {
    let stem = sanitize_file_stem(requested_stem);
    for suffix in 1_u32.. {
        let candidate_stem = if suffix == 1 {
            stem.clone()
        } else {
            format!("{stem} ({suffix})")
        };
        let file_name = format!("{candidate_stem}.linglight");
        if used_names.insert(file_name.to_lowercase()) {
            return directory.join(file_name);
        }
    }
    unreachable!()
}

fn is_windows_reserved(name: &str) -> bool {
    let base = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
}
