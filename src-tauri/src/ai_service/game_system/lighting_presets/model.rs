use serde::{Deserialize, Serialize};

use crate::ai_service::game_system::lighting::LightingParams;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresetKind {
    BuiltIn,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresetSort {
    FavoriteFirst,
    RecentlyUsed,
    Name,
}

impl Default for PresetSort {
    fn default() -> Self {
        Self::Name
    }
}

impl Default for PresetKind {
    fn default() -> Self {
        Self::User
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LightingPreset {
    pub id: String,
    pub origin_id: Option<String>,
    pub revision: u32,
    pub kind: PresetKind,
    pub name: String,
    pub i18n_key: Option<String>,
    pub description: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub category: String,
    pub favorite: bool,
    pub last_used_at: Option<String>,
    pub lighting: LightingParams,
    pub created_at: String,
    pub updated_at: String,
}

impl Default for LightingPreset {
    fn default() -> Self {
        Self {
            id: String::new(),
            origin_id: None,
            revision: 1,
            kind: PresetKind::User,
            name: String::new(),
            i18n_key: None,
            description: String::new(),
            aliases: Vec::new(),
            tags: Vec::new(),
            category: String::new(),
            favorite: false,
            last_used_at: None,
            lighting: LightingParams::default(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LightingPresetDraft {
    pub name: String,
    pub description: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub category: String,
    pub favorite: bool,
    pub last_used_at: Option<String>,
    pub lighting: LightingParams,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LightingPresetUpdate {
    pub name: Option<String>,
    pub description: Option<String>,
    pub aliases: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub category: Option<String>,
    pub favorite: Option<bool>,
    pub last_used_at: Option<Option<String>>,
    pub lighting: Option<LightingParams>,
}
