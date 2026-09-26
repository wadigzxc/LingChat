use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::{SecondsFormat, Utc};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::builtins::builtin_presets;
use super::model::{
    LightingPreset, LightingPresetDraft, LightingPresetUpdate, PresetKind, PresetSort,
};
use crate::ai_service::game_system::lighting::LightingParams;
use crate::utils::atomic_file::atomic_replace_file;

pub struct LightingPresetStore {
    path: PathBuf,
    mutation_lock: Mutex<()>,
}

impl LightingPresetStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("game_data").join("lighting_presets.json"),
            mutation_lock: Mutex::new(()),
        }
    }

    pub async fn create(&self, draft: LightingPresetDraft) -> Result<LightingPreset> {
        let _guard = self.mutation_lock.lock().await;
        let mut users = self.load_users()?;
        let id = format!("user:{}", Uuid::new_v4());
        let now = now();
        let mut lighting = draft.lighting;
        lighting.normalize();
        let preset = LightingPreset {
            id: id.clone(),
            origin_id: Some(id),
            revision: 1,
            kind: PresetKind::User,
            name: draft.name,
            i18n_key: None,
            description: draft.description,
            aliases: draft.aliases,
            tags: draft.tags,
            category: draft.category,
            favorite: draft.favorite,
            last_used_at: draft.last_used_at,
            lighting,
            created_at: now.clone(),
            updated_at: now,
        };
        users.push(preset.clone());
        self.save_users(&users)?;
        Ok(preset)
    }

    pub async fn get(&self, id: &str) -> Result<Option<LightingPreset>> {
        let _guard = self.mutation_lock.lock().await;
        if let Some(preset) = builtin_presets().into_iter().find(|preset| preset.id == id) {
            return Ok(Some(preset));
        }
        Ok(self
            .load_users()?
            .into_iter()
            .find(|preset| preset.id == id))
    }

    pub async fn lighting_for_application(&self, id: &str) -> Result<Option<LightingParams>> {
        Ok(self.get(id).await?.map(|preset| preset.lighting))
    }

    pub async fn list(&self, sort: PresetSort) -> Result<Vec<LightingPreset>> {
        let _guard = self.mutation_lock.lock().await;
        let mut presets = builtin_presets();
        presets.extend(self.load_users()?);
        match sort {
            PresetSort::Name => presets.sort_by(compare_name_then_id),
            PresetSort::FavoriteFirst => presets.sort_by(|left, right| {
                right
                    .favorite
                    .cmp(&left.favorite)
                    .then_with(|| compare_name_then_id(left, right))
            }),
            PresetSort::RecentlyUsed => presets.sort_by(|left, right| {
                right
                    .last_used_at
                    .cmp(&left.last_used_at)
                    .then_with(|| compare_name_then_id(left, right))
            }),
        }
        Ok(presets)
    }

    pub async fn update(&self, id: &str, update: LightingPresetUpdate) -> Result<LightingPreset> {
        let _guard = self.mutation_lock.lock().await;
        if id.starts_with("builtin:") {
            bail!("内置光影预设不可更新: {id}");
        }
        let mut users = self.load_users()?;
        let preset = users
            .iter_mut()
            .find(|preset| preset.id == id)
            .with_context(|| format!("光影预设不存在: {id}"))?;
        apply_update(preset, update);
        preset.revision = preset.revision.saturating_add(1);
        preset.updated_at = now();
        let result = preset.clone();
        self.save_users(&users)?;
        Ok(result)
    }

    pub async fn delete(&self, id: &str) -> Result<Option<LightingPreset>> {
        let _guard = self.mutation_lock.lock().await;
        if id.starts_with("builtin:") {
            bail!("内置光影预设不可删除: {id}");
        }
        let mut users = self.load_users()?;
        let Some(index) = users.iter().position(|preset| preset.id == id) else {
            return Ok(None);
        };
        let removed = users.remove(index);
        self.save_users(&users)?;
        Ok(Some(removed))
    }

    fn load_users(&self) -> Result<Vec<LightingPreset>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let bytes = std::fs::read(&self.path)
            .with_context(|| format!("读取光影预设失败: {:?}", self.path))?;
        let users: Vec<LightingPreset> = serde_json::from_slice(&bytes)
            .with_context(|| format!("解析光影预设失败: {:?}", self.path))?;
        Ok(users
            .into_iter()
            .filter(|preset| preset.kind == PresetKind::User)
            .collect())
    }

    fn save_users(&self, users: &[LightingPreset]) -> Result<()> {
        let parent = self.path.parent().context("光影预设路径没有父目录")?;
        std::fs::create_dir_all(parent)?;
        atomic_replace_file(&self.path, &serde_json::to_vec_pretty(users)?)
            .with_context(|| format!("写入光影预设失败: {:?}", self.path))
    }
}

fn compare_name_then_id(left: &LightingPreset, right: &LightingPreset) -> std::cmp::Ordering {
    left.name
        .to_lowercase()
        .cmp(&right.name.to_lowercase())
        .then_with(|| left.id.cmp(&right.id))
}

fn apply_update(preset: &mut LightingPreset, update: LightingPresetUpdate) {
    if let Some(name) = update.name {
        preset.name = name;
    }
    if let Some(description) = update.description {
        preset.description = description;
    }
    if let Some(aliases) = update.aliases {
        preset.aliases = aliases;
    }
    if let Some(tags) = update.tags {
        preset.tags = tags;
    }
    if let Some(category) = update.category {
        preset.category = category;
    }
    if let Some(favorite) = update.favorite {
        preset.favorite = favorite;
    }
    if let Some(last_used_at) = update.last_used_at {
        preset.last_used_at = last_used_at;
    }
    if let Some(mut lighting) = update.lighting {
        lighting.normalize();
        preset.lighting = lighting;
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
