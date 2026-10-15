use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::{SecondsFormat, Utc};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::builtins::builtin_presets;
use super::catalog::Catalog;
use super::model::{
    LightingPreset, LightingPresetDraft, LightingPresetUpdate, PresetKind, PresetSort,
};

use crate::utils::atomic_file::atomic_replace_file;

pub struct LightingPresetStore {
    path: PathBuf,
    mutation_lock: Mutex<()>,
    #[cfg(test)]
    fail_next_save: std::sync::atomic::AtomicBool,
}

impl LightingPresetStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("game_data").join("lighting_presets.json"),
            mutation_lock: Mutex::new(()),
            #[cfg(test)]
            fail_next_save: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// Runs an import mutation while holding the same lock as CRUD operations.
    /// The callback may stage content-addressed assets, but the preset JSON save
    /// remains the sole visibility commit point.
    pub(crate) async fn import_transaction<F>(&self, operation: F) -> Result<LightingPreset>
    where
        F: FnOnce(&mut Vec<LightingPreset>, &[LightingPreset]) -> Result<LightingPreset>,
    {
        let _guard = self.mutation_lock.lock().await;
        let mut catalog = self.load_catalog()?;
        let builtins: Vec<_> = builtin_presets()
            .into_iter()
            .map(|p| catalog.project(p))
            .collect();
        let imported = operation(&mut catalog.users, &builtins)?;
        catalog
            .favorites
            .insert(imported.id.clone(), imported.favorite);
        self.save_catalog(&catalog)?;
        Ok(catalog.project(imported))
    }

    #[cfg(test)]
    pub(crate) fn fail_next_save_for_test(&self) {
        self.fail_next_save
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// Changes only favorite metadata, never effect identity or recent use.
    pub async fn set_favorite(&self, id: &str, favorite: bool) -> Result<LightingPreset> {
        let _guard = self.mutation_lock.lock().await;
        let mut catalog = self.load_catalog()?;
        let preset = builtin_presets()
            .into_iter()
            .chain(catalog.users.iter().cloned())
            .find(|preset| !id.is_empty() && preset.id == id)
            .with_context(|| format!("光影预设不存在: {id}"))?;
        let mut preset = catalog.project(preset);
        let changed = preset.favorite != favorite;
        preset.favorite = favorite;
        if changed {
            catalog.favorites.insert(id.to_string(), favorite);
            self.save_catalog(&catalog)?;
        }
        Ok(preset)
    }

    pub async fn create(&self, draft: LightingPresetDraft) -> Result<LightingPreset> {
        let _guard = self.mutation_lock.lock().await;
        let mut catalog = self.load_catalog()?;
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
            last_used_at: None,
            lighting,
            created_at: now.clone(),
            updated_at: now,
        };
        catalog.favorites.insert(preset.id.clone(), preset.favorite);
        catalog.users.push(preset.clone());
        self.save_catalog(&catalog)?;
        Ok(preset)
    }

    pub async fn get(&self, id: &str) -> Result<Option<LightingPreset>> {
        let _guard = self.mutation_lock.lock().await;
        let catalog = self.load_catalog()?;
        if let Some(preset) = builtin_presets().into_iter().find(|preset| preset.id == id) {
            return Ok(Some(catalog.project(preset)));
        }
        Ok(catalog.users.into_iter().find(|preset| preset.id == id))
    }

    /// Caller owns the service guard. Hold catalog lock from snapshot through
    /// operation/publication and the atomic usage write. Missing historical
    /// sources remain optional for scene saves; strict apply validates in callback.
    /// Usage-save failure does not roll back already committed runtime/scene I/O.
    pub(crate) async fn with_successful_use<T, F, Fut>(
        &self,
        id: Option<&str>,
        operation: F,
    ) -> std::result::Result<T, String>
    where
        F: FnOnce(Option<LightingPreset>) -> Fut,
        Fut: std::future::Future<Output = std::result::Result<T, String>>,
    {
        self.with_successful_use_if(id, |preset| async move {
            operation(preset).await.map(|result| (result, true))
        })
        .await
    }

    /// Scene updates decide save intent from the locked previous/final snapshots.
    pub(crate) async fn with_successful_use_if<T, F, Fut>(
        &self,
        id: Option<&str>,
        operation: F,
    ) -> std::result::Result<T, String>
    where
        F: FnOnce(Option<LightingPreset>) -> Fut,
        Fut: std::future::Future<Output = std::result::Result<(T, bool), String>>,
    {
        let _guard = self.mutation_lock.lock().await;
        let mut catalog = self.load_catalog().map_err(|e| e.to_string())?;
        let preset = builtin_presets()
            .into_iter()
            .chain(catalog.users.iter().cloned())
            .find(|p| id.is_some_and(|id| !id.is_empty() && p.id == id))
            .map(|p| catalog.project(p));
        let used_id = preset.as_ref().map(|p| p.id.clone());
        let (result, record_usage) = operation(preset).await?;
        if let Some(id) = used_id.filter(|_| record_usage) {
            // Millisecond logical clock: later successful operations are strictly
            // newer even when wall time ties or moves backwards. Wire DTO stays ISO.
            let latest = catalog
                .recent
                .values()
                .filter_map(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.timestamp_millis())
                .max();
            let millis = latest.map_or(Utc::now().timestamp_millis(), |latest| {
                Utc::now().timestamp_millis().max(latest.saturating_add(1))
            });
            let timestamp = chrono::DateTime::from_timestamp_millis(millis)
                .ok_or_else(|| "最近使用时间超出范围".to_string())?
                .to_rfc3339_opts(SecondsFormat::Millis, true);
            catalog.recent.insert(id, timestamp);
            self.save_catalog(&catalog).map_err(|e| e.to_string())?;
        }
        Ok(result)
    }

    pub async fn list(&self, sort: PresetSort) -> Result<Vec<LightingPreset>> {
        let _guard = self.mutation_lock.lock().await;
        let catalog = self.load_catalog()?;
        let mut presets: Vec<_> = builtin_presets()
            .into_iter()
            .map(|p| catalog.project(p))
            .collect();
        presets.extend(catalog.users);
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
                    .is_some()
                    .cmp(&left.last_used_at.is_some())
                    .then_with(|| {
                        let instant = |p: &LightingPreset| {
                            p.last_used_at
                                .as_deref()
                                .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok())
                        };
                        instant(right).cmp(&instant(left))
                    })
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
        let mut catalog = self.load_catalog()?;
        let preset = catalog
            .users
            .iter_mut()
            .find(|preset| preset.id == id)
            .with_context(|| format!("光影预设不存在: {id}"))?;
        apply_update(preset, update);
        preset.revision = preset.revision.saturating_add(1);
        preset.updated_at = now();
        let result = preset.clone();
        catalog.favorites.insert(result.id.clone(), result.favorite);
        self.save_catalog(&catalog)?;
        Ok(result)
    }

    pub async fn delete(&self, id: &str) -> Result<Option<LightingPreset>> {
        let _guard = self.mutation_lock.lock().await;
        if id.starts_with("builtin:") {
            bail!("内置光影预设不可删除: {id}");
        }
        let mut catalog = self.load_catalog()?;
        let Some(index) = catalog.users.iter().position(|preset| preset.id == id) else {
            return Ok(None);
        };
        let removed = catalog.users.remove(index);
        catalog.favorites.remove(id);
        catalog.recent.remove(id);
        self.save_catalog(&catalog)?;
        Ok(Some(removed))
    }

    fn load_catalog(&self) -> Result<Catalog> {
        if !self.path.exists() {
            return Ok(Catalog::default());
        }
        let bytes = std::fs::read(&self.path)
            .with_context(|| format!("读取光影预设失败: {:?}", self.path))?;
        Catalog::from_bytes(&bytes).with_context(|| format!("解析光影预设失败: {:?}", self.path))
    }

    fn save_catalog(&self, catalog: &Catalog) -> Result<()> {
        #[cfg(test)]
        if self
            .fail_next_save
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            bail!("injected preset save failure");
        }
        let parent = self.path.parent().context("光影预设路径没有父目录")?;
        std::fs::create_dir_all(parent)?;
        atomic_replace_file(&self.path, &catalog.to_bytes()?)
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
    // last_used_at remains in the DTO for compatibility, but only successful
    // application/scene-save transactions may change authoritative usage.
    if let Some(mut lighting) = update.lighting {
        lighting.normalize();
        preset.lighting = lighting;
    }
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
