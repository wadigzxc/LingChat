use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use image::{GenericImageView as _, ImageFormat, ImageReader};
use serde::Serialize;
use sha2::{Digest, Sha256};
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

use super::{
    ArchiveLimits, LINGLIGHT_FORMAT, LINGLIGHT_VERSION, LingLightManifest, ManifestAsset,
    OriginMetadata, PresetSnapshot, validate_linglight,
};
use crate::ai_service::game_system::lighting_presets::{
    LightingPreset, LightingPresetStore, PresetKind,
};
use crate::utils::atomic_file::atomic_replace_file;

use super::name::{existing_file_names, sanitize_file_stem, unique_export_path};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportResult {
    pub preset_id: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BatchExportItem {
    pub preset_id: String,
    pub path: Option<PathBuf>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BatchExportResult {
    pub items: Vec<BatchExportItem>,
}

pub async fn export_linglight_path(
    preset_id: &str,
    target_path: &Path,
    store: &LightingPresetStore,
    data_dir: &Path,
) -> Result<ExportResult> {
    export_linglight_path_with_replacer(preset_id, target_path, store, data_dir, |path, bytes| {
        atomic_replace_file(path, bytes)
    })
    .await
}

pub(crate) async fn export_linglight_path_with_replacer<F>(
    preset_id: &str,
    target_path: &Path,
    store: &LightingPresetStore,
    data_dir: &Path,
    replace: F,
) -> Result<ExportResult>
where
    F: FnOnce(&Path, &[u8]) -> Result<()>,
{
    export_linglight_path_with_hooks(preset_id, target_path, store, data_dir, |_| Ok(()), replace)
        .await
}

pub(crate) async fn export_linglight_path_with_hooks<W, R>(
    preset_id: &str,
    target_path: &Path,
    store: &LightingPresetStore,
    data_dir: &Path,
    before_write: W,
    replace: R,
) -> Result<ExportResult>
where
    W: FnOnce(&mut std::fs::File) -> Result<()>,
    R: FnOnce(&Path, &[u8]) -> Result<()>,
{
    let preset = store
        .get(preset_id)
        .await?
        .with_context(|| format!("光影预设不存在: {preset_id}"))?;
    if preset.kind != PresetKind::User {
        bail!("内置光影预设不能直接导出，请先另存为用户副本");
    }
    let target_path = normalize_extension(target_path);
    let parent = target_path
        .parent()
        .with_context(|| format!("导出目标没有父目录: {target_path:?}"))?;
    std::fs::create_dir_all(parent).with_context(|| format!("创建导出目录失败: {parent:?}"))?;
    let mut staged = tempfile::Builder::new()
        .prefix(".linglight-")
        .tempfile_in(parent)
        .with_context(|| format!("创建同目录临时 ZIP 失败: {parent:?}"))?;
    before_write(staged.as_file_mut()).context("写入临时 ZIP 失败")?;
    write_package(&preset, data_dir, staged.as_file_mut())?;
    validate_linglight(staged.path(), ArchiveLimits::default())
        .map_err(anyhow::Error::new)
        .context("导出的 .linglight 未通过自校验")?;
    let bytes = std::fs::read(staged.path()).context("读取完成的临时 ZIP 失败")?;
    replace(&target_path, &bytes)
        .with_context(|| format!("原子写入 .linglight 失败: {target_path:?}"))?;
    Ok(ExportResult {
        preset_id: preset.id,
        path: target_path,
    })
}

pub async fn export_linglights_to_dir(
    preset_ids: &[String],
    target_dir: &Path,
    store: &LightingPresetStore,
    data_dir: &Path,
) -> BatchExportResult {
    let mut used_names = existing_file_names(target_dir);
    let mut items = Vec::with_capacity(preset_ids.len());
    for preset_id in preset_ids {
        let preset = match store.get(preset_id).await {
            Ok(Some(preset)) => preset,
            Ok(None) => {
                items.push(BatchExportItem {
                    preset_id: preset_id.clone(),
                    path: None,
                    error: Some(format!("光影预设不存在: {preset_id}")),
                });
                continue;
            },
            Err(error) => {
                items.push(BatchExportItem {
                    preset_id: preset_id.clone(),
                    path: None,
                    error: Some(format!("读取光影预设失败: {error:#}")),
                });
                continue;
            },
        };
        let target = unique_export_path(target_dir, &preset.name, &mut used_names);
        match export_linglight_path(preset_id, &target, store, data_dir).await {
            Ok(result) => items.push(BatchExportItem {
                preset_id: preset_id.clone(),
                path: Some(result.path),
                error: None,
            }),
            Err(error) => items.push(BatchExportItem {
                preset_id: preset_id.clone(),
                path: None,
                error: Some(format!("导出 .linglight 失败: {error:#}")),
            }),
        }
    }
    BatchExportResult { items }
}

fn write_package(
    preset: &LightingPreset,
    data_dir: &Path,
    output: &mut std::fs::File,
) -> Result<()> {
    let prepared_assets = prepare_assets(preset, data_dir)?;
    let manifest = LingLightManifest {
        format: LINGLIGHT_FORMAT.to_string(),
        version: LINGLIGHT_VERSION,
        required_capabilities: Vec::new(),
        optional_capabilities: Vec::new(),
        preset: PresetSnapshot {
            name: preset.name.clone(),
            description: preset.description.clone(),
            aliases: preset.aliases.clone(),
            tags: preset.tags.clone(),
            category: preset.category.clone(),
            lighting: preset.lighting.clone(),
        },
        origin: OriginMetadata {
            id: preset
                .origin_id
                .clone()
                .unwrap_or_else(|| preset.id.clone()),
            revision: preset.revision,
            created_by: None,
        },
        assets: prepared_assets
            .iter()
            .map(|asset| asset.manifest.clone())
            .collect(),
    };
    let mut zip = ZipWriter::new(output);
    zip.start_file("manifest.json", SimpleFileOptions::default())?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    for asset in prepared_assets {
        zip.start_file(&asset.manifest.path, SimpleFileOptions::default())?;
        zip.write_all(&asset.bytes)?;
    }
    let output = zip.finish()?;
    output.flush()?;
    output.sync_all()?;
    Ok(())
}

struct PreparedAsset {
    manifest: ManifestAsset,
    bytes: Vec<u8>,
}

fn prepare_assets(preset: &LightingPreset, data_dir: &Path) -> Result<Vec<PreparedAsset>> {
    let limits = ArchiveLimits::default();
    let mut prepared = Vec::with_capacity(preset.lighting.asset_layers.len());
    for layer in &preset.lighting.asset_layers {
        if layer.asset_hash.len() != 64
            || !layer
                .asset_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            bail!("光影素材哈希格式无效: {}", layer.id);
        }
        if layer.media_type != "image/png" {
            bail!("光影素材 {} 不是受支持的 PNG", layer.id);
        }
        let source = data_dir
            .join("game_data/lighting_assets")
            .join(format!("{}.png", layer.asset_hash));
        let bytes = std::fs::read(&source)
            .with_context(|| format!("读取光影素材失败: {}", layer.asset_hash))?;
        if bytes.len() as u64 > limits.max_png_bytes {
            bail!("光影素材过大: {}", layer.id);
        }
        let actual_hash = format!("{:x}", Sha256::digest(&bytes));
        if actual_hash != layer.asset_hash {
            bail!("光影素材哈希与预设引用不一致: {}", layer.id);
        }
        let mut reader = ImageReader::with_format(Cursor::new(&bytes), ImageFormat::Png);
        let mut image_limits = image::Limits::default();
        image_limits.max_image_width = Some(limits.max_png_edge);
        image_limits.max_image_height = Some(limits.max_png_edge);
        image_limits.max_alloc = Some(limits.max_png_bytes.saturating_mul(8));
        reader.limits(image_limits);
        let decoded = reader
            .decode()
            .with_context(|| format!("光影素材 PNG 损坏: {}", layer.id))?;
        let (width, height) = decoded.dimensions();
        if width > limits.max_png_edge || height > limits.max_png_edge {
            bail!("光影素材尺寸过大: {}", layer.id);
        }
        if !decoded.color().has_alpha() {
            bail!("光影素材必须包含透明通道: {}", layer.id);
        }
        let path = format!("assets/{actual_hash}.png");
        prepared.push(PreparedAsset {
            manifest: ManifestAsset {
                id: layer.id.clone(),
                path,
                sha256: actual_hash,
                byte_size: bytes.len() as u64,
                width,
                height,
                target: layer.target,
                placement: layer.placement,
                z_index: layer.z_index,
                opacity: layer.opacity,
                blend_mode: layer.blend_mode,
                fit: layer.fit,
                required: layer.required,
            },
            bytes,
        });
    }
    Ok(prepared)
}

fn normalize_extension(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy())
        .unwrap_or_default();
    parent.join(format!("{}.linglight", sanitize_file_stem(&stem)))
}

#[tauri::command]
pub async fn export_linglight(
    preset_id: String,
    target_path: String,
    store: tauri::State<'_, LightingPresetStore>,
) -> Result<ExportResult, String> {
    export_linglight_path(
        &preset_id,
        Path::new(&target_path),
        &store,
        &crate::api::data_dir(),
    )
    .await
    .map_err(display_error)
}

#[tauri::command]
pub async fn export_linglights(
    preset_ids: Vec<String>,
    target_dir: String,
    store: tauri::State<'_, LightingPresetStore>,
) -> Result<BatchExportResult, String> {
    Ok(export_linglights_to_dir(
        &preset_ids,
        Path::new(&target_dir),
        &store,
        &crate::api::data_dir(),
    )
    .await)
}

fn display_error(error: anyhow::Error) -> String {
    format!("导出 .linglight 失败: {error:#}")
}
