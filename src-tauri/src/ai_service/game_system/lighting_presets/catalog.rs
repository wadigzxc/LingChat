use std::collections::{BTreeMap, HashSet};

use anyhow::{Result, bail};
use serde::Deserialize;
use serde_json::{Value, json};

use super::model::{LightingPreset, PresetKind};

/// Local storage only. DTOs and portable archives retain their existing shape.
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Catalog {
    pub version: u32,
    pub users: Vec<LightingPreset>,
    pub favorites: BTreeMap<String, bool>,
}

impl Catalog {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        let value: Value = serde_json::from_slice(bytes)?;
        let records = if value.is_array() {
            &value
        } else if value.is_object() {
            &value["users"]
        } else {
            bail!("光影预设 catalog 必须是对象或旧版数组");
        };
        let Some(records) = records.as_array() else {
            bail!("光影预设 users 必须是数组");
        };
        let mut ids = HashSet::new();
        for record in records {
            let Some(id) = record
                .as_object()
                .and_then(|p| p.get("id"))
                .and_then(Value::as_str)
            else {
                bail!("光影预设记录必须是带有 id 的对象");
            };
            if id.is_empty() || !ids.insert(id) {
                bail!("光影预设 id 为空或重复: {id}");
            }
        }
        let mut catalog = if value.is_array() {
            let users: Vec<LightingPreset> = serde_json::from_value(value)?;
            let users: Vec<_> = users
                .into_iter()
                .filter(|p| p.kind == PresetKind::User)
                .collect();
            let favorites = users.iter().map(|p| (p.id.clone(), p.favorite)).collect();
            Self {
                version: 1,
                users,
                favorites,
            }
        } else {
            let catalog = serde_json::from_value::<Self>(value)?;
            if catalog
                .users
                .iter()
                .any(|p| p.kind != PresetKind::User || p.id.starts_with("builtin:"))
            {
                bail!("光影预设 catalog users 不得包含内置预设");
            }
            catalog
        };
        if catalog.version != 1 {
            bail!("不支持的光影预设 catalog 版本: {}", catalog.version);
        }
        for preset in &mut catalog.users {
            preset.favorite = catalog.favorites.get(&preset.id).copied().unwrap_or(false);
        }
        Ok(catalog)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut users = serde_json::to_value(&self.users)?;
        for preset in users.as_array_mut().expect("serialized user vector") {
            preset
                .as_object_mut()
                .expect("serialized preset object")
                .remove("favorite");
        }
        Ok(serde_json::to_vec_pretty(&json!({
            "version": 1, "users": users, "favorites": self.favorites,
        }))?)
    }

    pub fn project(&self, mut preset: LightingPreset) -> LightingPreset {
        preset.favorite = self.favorites.get(&preset.id).copied().unwrap_or(false);
        preset
    }
}
