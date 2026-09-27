use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ResolvedLightingAsset {
    pub hash: String,
    pub supported: bool,
    pub asset_protocol_path: Option<String>,
    pub warning: Option<String>,
}

pub(crate) fn resolve_lighting_asset_in(data_dir: &Path, hash: &str) -> Result<PathBuf, String> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("光影素材 hash 必须是 64 位小写十六进制".to_string());
    }

    let game_data = data_dir.join("game_data");
    let canonical_game_data = game_data
        .canonicalize()
        .map_err(|_| "游戏数据目录不存在".to_string())?;
    let root = game_data.join("lighting_assets");
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "光影素材目录不存在".to_string())?;
    if canonical_root.parent() != Some(canonical_game_data.as_path()) {
        return Err("光影素材目录路径越界".to_string());
    }
    let candidate = root.join(format!("{hash}.png"));
    let canonical = candidate
        .canonicalize()
        .map_err(|_| format!("光影素材不存在: {hash}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("光影素材路径越界".to_string());
    }
    if !canonical.is_file() {
        return Err(format!("光影素材不是文件: {hash}"));
    }
    Ok(canonical)
}

#[tauri::command]
pub fn resolve_lighting_asset(hash: String) -> Result<ResolvedLightingAsset, String> {
    #[cfg(desktop)]
    {
        let path = resolve_lighting_asset_in(&crate::api::data_dir(), &hash)?;
        return Ok(ResolvedLightingAsset {
            hash,
            supported: true,
            asset_protocol_path: Some(path.to_string_lossy().into_owned()),
            warning: None,
        });
    }

    #[cfg(not(desktop))]
    {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("光影素材 hash 必须是 64 位小写十六进制".to_string());
        }
        Ok(ResolvedLightingAsset {
            hash,
            supported: false,
            asset_protocol_path: None,
            warning: Some("移动端不支持本地光影素材层".to_string()),
        })
    }
}
