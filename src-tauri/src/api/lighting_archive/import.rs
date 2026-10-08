use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use uuid::Uuid;

use super::import_state::{ImportStateError, LingLightImportState, SourceFingerprint};
use super::{ArchiveLimits, ValidatedLingLight, validate_linglight};
use crate::ai_service::game_system::lighting_presets::{
    LightingPreset, LightingPresetStore, PresetKind, PresetSort,
};
use crate::utils::atomic_file::atomic_replace_file;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportStrategy {
    KeepBoth,
    OverwriteSameOrigin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportConflictKind {
    BuiltIn,
    SameOrigin,
    Name,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportConflict {
    pub kind: ImportConflictKind,
    pub existing_id: String,
    pub existing_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportPresetSummary {
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub category: String,
    pub origin_id: String,
    pub revision: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportAssetSummary {
    pub id: String,
    pub sha256: String,
    pub byte_size: u64,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportInspection {
    pub token: String,
    pub preset: ImportPresetSummary,
    pub assets: Vec<ImportAssetSummary>,
    pub warnings: Vec<String>,
    pub conflicts: Vec<ImportConflict>,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportCommitResult {
    pub preset: LightingPreset,
    pub warnings: Vec<String>,
}

pub async fn inspect_linglight_path(
    path: &Path,
    state: &LingLightImportState,
    store: &LightingPresetStore,
) -> Result<ImportInspection> {
    let fingerprint = SourceFingerprint::capture(path).map_err(anyhow::Error::new)?;
    let validated =
        validate_linglight(path, ArchiveLimits::default()).map_err(anyhow::Error::new)?;

    // Never hold the import-state mutex while awaiting the preset-store mutex.
    let presets = store.list(PresetSort::Name).await?;
    let conflicts = detect_conflicts(&validated, &presets);
    let mut warnings = validated.warnings.clone();
    if !validated.manifest.lighting.asset_layers.is_empty() {
        warnings.push(format!(
            "仅导入参数将移除 {} 个素材层和全部资源引用",
            validated.manifest.lighting.asset_layers.len()
        ));
    }
    let preset = ImportPresetSummary {
        name: validated.manifest.metadata.name.clone(),
        description: validated.manifest.metadata.description.clone(),
        tags: validated.manifest.metadata.tags.clone(),
        category: validated.manifest.metadata.category.clone(),
        origin_id: validated.manifest.origin_id.clone().unwrap_or_default(),
        revision: validated.manifest.revision,
    };
    let assets = validated
        .manifest
        .assets
        .iter()
        .map(|asset| ImportAssetSummary {
            id: asset.id.clone(),
            sha256: asset.sha256.clone(),
            byte_size: asset.byte_size,
            width: asset.width,
            height: asset.height,
        })
        .collect();
    let (token, expires_at) = state
        .insert(validated, fingerprint)
        .map_err(anyhow::Error::new)?;
    Ok(ImportInspection {
        token,
        preset,
        assets,
        warnings,
        conflicts,
        expires_at,
    })
}

pub async fn commit_linglight_import_inner(
    token: &str,
    strategy: ImportStrategy,
    parameter_only: bool,
    state: &LingLightImportState,
    store: &LightingPresetStore,
    data_dir: &Path,
) -> Result<ImportCommitResult> {
    // Fixed lock order: consume under import-state lock, release it, then acquire
    // the preset-store lock. cancel/cleanup only ever acquire the first lock.
    let pending = state.consume(token).map_err(anyhow::Error::new)?;
    pending
        .fingerprint
        .verify_unchanged()
        .map_err(anyhow::Error::new)?;

    if !parameter_only && !pending.validated.unsupported_assets.is_empty() {
        bail!("包中包含不支持的可选素材；必须明确选择仅导入参数");
    }

    let mut warnings = pending.validated.warnings.clone();
    if parameter_only && !pending.validated.manifest.lighting.asset_layers.is_empty() {
        warnings.push(format!(
            "已仅导入参数；移除了 {} 个素材层和全部资源引用",
            pending.validated.manifest.lighting.asset_layers.len()
        ));
    }
    let assets_root = data_dir.join("game_data").join("lighting_assets");
    let validated = pending.validated;
    let preset = store
        .import_transaction(|users, builtins| {
            let conflicts = detect_conflicts_from_sets(&validated, users, builtins);
            let mut imported =
                build_imported_preset(&validated, users, builtins, strategy, &conflicts)?;
            if parameter_only {
                imported.lighting.asset_layers.clear();
            } else {
                copy_assets_content_addressed(&validated, &assets_root)?;
            }
            upsert_user(users, imported.clone());
            Ok(imported)
        })
        .await?;

    Ok(ImportCommitResult { preset, warnings })
}

fn detect_conflicts(
    validated: &ValidatedLingLight,
    presets: &[LightingPreset],
) -> Vec<ImportConflict> {
    let users: Vec<_> = presets
        .iter()
        .filter(|preset| preset.kind == PresetKind::User)
        .cloned()
        .collect();
    let builtins: Vec<_> = presets
        .iter()
        .filter(|preset| preset.kind == PresetKind::BuiltIn)
        .cloned()
        .collect();
    detect_conflicts_from_sets(validated, &users, &builtins)
}

fn detect_conflicts_from_sets(
    validated: &ValidatedLingLight,
    users: &[LightingPreset],
    builtins: &[LightingPreset],
) -> Vec<ImportConflict> {
    let origin = validated.manifest.origin_id.as_deref();
    let name = &validated.manifest.metadata.name;
    let mut seen = HashSet::new();
    let mut conflicts = Vec::new();
    for preset in builtins {
        if origin.is_some_and(|origin| preset.id == origin)
            || (origin.is_some() && preset.origin_id.as_deref() == origin)
            || names_equal(&preset.name, name)
        {
            seen.insert(preset.id.clone());
            conflicts.push(ImportConflict {
                kind: ImportConflictKind::BuiltIn,
                existing_id: preset.id.clone(),
                existing_name: preset.name.clone(),
            });
        }
    }
    for preset in users {
        if origin.is_some() && preset.origin_id.as_deref() == origin {
            seen.insert(preset.id.clone());
            conflicts.push(ImportConflict {
                kind: ImportConflictKind::SameOrigin,
                existing_id: preset.id.clone(),
                existing_name: preset.name.clone(),
            });
        } else if names_equal(&preset.name, name) && seen.insert(preset.id.clone()) {
            conflicts.push(ImportConflict {
                kind: ImportConflictKind::Name,
                existing_id: preset.id.clone(),
                existing_name: preset.name.clone(),
            });
        }
    }
    conflicts
}

fn build_imported_preset(
    validated: &ValidatedLingLight,
    users: &[LightingPreset],
    builtins: &[LightingPreset],
    strategy: ImportStrategy,
    conflicts: &[ImportConflict],
) -> Result<LightingPreset> {
    let builtin_conflict = conflicts
        .iter()
        .any(|conflict| conflict.kind == ImportConflictKind::BuiltIn);
    let origin = validated.manifest.origin_id.as_deref();
    let same_origin: Vec<_> = users
        .iter()
        .filter(|preset| origin.is_some() && preset.origin_id.as_deref() == origin)
        .collect();
    if strategy == ImportStrategy::OverwriteSameOrigin && builtin_conflict {
        bail!("内置光影预设不可被导入覆盖");
    }
    if strategy == ImportStrategy::OverwriteSameOrigin && same_origin.len() != 1 {
        if same_origin.is_empty() {
            bail!("未找到同源光影预设，不能覆盖；新建请使用 keep_both");
        }
        bail!("存在多个同源光影预设，无法安全覆盖");
    }

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let snapshot = &validated.manifest.metadata;
    let (id, origin_id, name, created_at, favorite, last_used_at) = match strategy {
        ImportStrategy::KeepBoth => {
            let used_names = users
                .iter()
                .chain(builtins.iter())
                .map(|preset| preset.name.as_str())
                .collect::<Vec<_>>();
            let name = if conflicts.is_empty() {
                snapshot.name.clone()
            } else {
                unique_name(&snapshot.name, &used_names)
            };
            let id = format!("user:{}", Uuid::new_v4());
            let origin_id = if conflicts.is_empty() {
                validated
                    .manifest
                    .origin_id
                    .clone()
                    .unwrap_or_else(|| id.clone())
            } else {
                // keep_both is a fork: give it a new portable identity so a
                // later overwrite_same_origin never sees two matching users.
                id.clone()
            };
            (id, origin_id, name, now.clone(), false, None)
        },
        ImportStrategy::OverwriteSameOrigin => {
            let existing = same_origin[0];
            (
                existing.id.clone(),
                validated
                    .manifest
                    .origin_id
                    .clone()
                    .expect("same-origin overwrite requires originId"),
                snapshot.name.clone(),
                existing.created_at.clone(),
                existing.favorite,
                existing.last_used_at.clone(),
            )
        },
    };
    let mut lighting = validated.manifest.lighting.clone();
    lighting.normalize();
    Ok(LightingPreset {
        id,
        origin_id: Some(origin_id),
        revision: validated.manifest.revision.max(1),
        kind: PresetKind::User,
        name,
        i18n_key: None,
        description: snapshot.description.clone(),
        aliases: snapshot.aliases.clone(),
        tags: snapshot.tags.clone(),
        category: snapshot.category.clone(),
        favorite,
        last_used_at,
        lighting,
        created_at,
        updated_at: now,
    })
}

fn upsert_user(users: &mut Vec<LightingPreset>, imported: LightingPreset) {
    if let Some(existing) = users.iter_mut().find(|preset| preset.id == imported.id) {
        *existing = imported;
    } else {
        users.push(imported);
    }
}

fn unique_name(base: &str, used: &[&str]) -> String {
    if !used.iter().any(|name| names_equal(name, base)) {
        return base.to_string();
    }
    for suffix in 2_u32.. {
        let candidate = format!("{base} ({suffix})");
        if !used.iter().any(|name| names_equal(name, &candidate)) {
            return candidate;
        }
    }
    unreachable!()
}

fn names_equal(left: &str, right: &str) -> bool {
    left.trim().to_lowercase() == right.trim().to_lowercase()
}

fn copy_assets_content_addressed(validated: &ValidatedLingLight, assets_root: &Path) -> Result<()> {
    if validated.assets.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(assets_root)
        .with_context(|| format!("创建光影素材目录失败: {assets_root:?}"))?;
    for asset in &validated.assets {
        let destination: PathBuf = assets_root.join(format!("{}.png", asset.sha256));
        let bytes = read_staged_asset(&asset.staged_path)
            .with_context(|| format!("读取已验证素材失败: {}", asset.id))?;
        if destination.exists() {
            let existing_hash = hash_existing_asset(&destination)
                .with_context(|| format!("读取既有共享素材失败: {}", asset.sha256))?;
            if existing_hash != asset.sha256 {
                bail!("既有光影素材内容与其哈希文件名不一致");
            }
            continue;
        }
        atomic_replace_file(&destination, &bytes)
            .with_context(|| format!("复制光影素材失败: {}", asset.id))?;
    }
    Ok(())
}

fn read_staged_asset(path: &Path) -> Result<Vec<u8>> {
    let limit = ArchiveLimits::default().max_png_bytes;
    let (file, _) = super::bounded_read::open_file(path, limit)?;
    #[cfg(test)]
    let file = super::tests::bounded_io::observe(file, path);
    let mut file = file;
    let mut bytes = Vec::new();
    super::bounded_read::read_chunks(&mut file, limit, |chunk| bytes.extend_from_slice(chunk))?;
    Ok(bytes)
}

fn hash_existing_asset(path: &Path) -> Result<String> {
    let (file, _) = super::bounded_read::open_file(path, ArchiveLimits::default().max_png_bytes)?;
    #[cfg(test)]
    let file = super::tests::bounded_io::observe(file, path);
    let mut file = file;
    let mut hasher = sha2::Sha256::new();
    super::bounded_read::read_chunks(&mut file, ArchiveLimits::default().max_png_bytes, |chunk| {
        hasher.update(chunk);
    })?;
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn inspect_linglight(
    path: String,
    state: tauri::State<'_, LingLightImportState>,
    store: tauri::State<'_, LightingPresetStore>,
) -> Result<ImportInspection, String> {
    inspect_linglight_path(Path::new(&path), &state, &store)
        .await
        .map_err(display_error)
}

#[tauri::command]
pub async fn commit_linglight_import(
    token: String,
    strategy: ImportStrategy,
    parameter_only: bool,
    state: tauri::State<'_, LingLightImportState>,
    store: tauri::State<'_, LightingPresetStore>,
) -> Result<ImportCommitResult, String> {
    commit_linglight_import_inner(
        &token,
        strategy,
        parameter_only,
        &state,
        &store,
        &crate::api::data_dir(),
    )
    .await
    .map_err(display_error)
}

#[tauri::command]
pub fn cancel_linglight_import(
    token: String,
    state: tauri::State<'_, LingLightImportState>,
) -> Result<(), String> {
    state.cancel(&token).map_err(|error| error.to_string())
}

fn display_error(error: anyhow::Error) -> String {
    if let Some(state_error) = error.downcast_ref::<ImportStateError>() {
        return state_error.to_string();
    }
    format!("导入 .linglight 失败: {error:#}")
}
