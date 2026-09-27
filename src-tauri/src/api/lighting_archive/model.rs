use serde::{Deserialize, Serialize};

use crate::ai_service::game_system::lighting::{
    AssetFit, AssetPlacement, BlendMode, LightingParams, LightingTarget,
};

pub const LINGLIGHT_FORMAT: &str = "linglight";
pub const LINGLIGHT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LingLightManifest {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub required_capabilities: Vec<String>,
    #[serde(default)]
    pub optional_capabilities: Vec<String>,
    pub preset: PresetSnapshot,
    pub origin: OriginMetadata,
    #[serde(default)]
    pub assets: Vec<ManifestAsset>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PresetSnapshot {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub category: String,
    pub lighting: LightingParams,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OriginMetadata {
    pub id: String,
    #[serde(default = "default_revision")]
    pub revision: u32,
    #[serde(default)]
    pub created_by: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestAsset {
    pub id: String,
    pub path: String,
    pub sha256: String,
    pub byte_size: u64,
    pub width: u32,
    pub height: u32,
    pub target: LightingTarget,
    pub placement: AssetPlacement,
    pub z_index: i32,
    pub opacity: f64,
    pub blend_mode: BlendMode,
    pub fit: AssetFit,
    #[serde(default)]
    pub required: bool,
}

fn default_revision() -> u32 {
    1
}
