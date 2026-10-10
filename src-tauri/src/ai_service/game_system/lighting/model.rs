use super::RelightingParams;
use serde::{Deserialize, Serialize};

pub const LIGHTING_SCHEMA_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct FilterParams {
    #[serde(default = "one")]
    pub brightness: f64,
    #[serde(default = "one")]
    pub contrast: f64,
    #[serde(default = "one")]
    pub saturation: f64,
    #[serde(default)]
    pub sepia: f64,
    #[serde(default)]
    pub glow_radius: i32,
    #[serde(default = "default_glow_color")]
    pub glow_color: String,
}

impl Default for FilterParams {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            contrast: 1.0,
            saturation: 1.0,
            sepia: 0.0,
            glow_radius: 0,
            glow_color: default_glow_color(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LightShape {
    Linear,
    #[serde(other)]
    Radial,
}

impl Default for LightShape {
    fn default() -> Self {
        Self::Radial
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LightingTarget {
    Character,
    Background,
    #[serde(other)]
    Both,
}

impl Default for LightingTarget {
    fn default() -> Self {
        Self::Both
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlendMode {
    Screen,
    Add,
    Overlay,
    SoftLight,
    Multiply,
    #[serde(other)]
    Normal,
}

impl Default for BlendMode {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetPlacement {
    Front,
    #[serde(other)]
    Behind,
}

impl Default for AssetPlacement {
    fn default() -> Self {
        Self::Behind
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetFit {
    Contain,
    Stretch,
    #[serde(other)]
    Cover,
}

impl Default for AssetFit {
    fn default() -> Self {
        Self::Cover
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AmbientParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_white")]
    pub color: String,
    #[serde(default)]
    pub opacity: f64,
}

impl Default for AmbientParams {
    fn default() -> Self {
        Self {
            enabled: false,
            color: default_white(),
            opacity: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MainLightParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub shape: LightShape,
    #[serde(default)]
    pub target: LightingTarget,
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "half")]
    pub y: f64,
    #[serde(default)]
    pub angle: f64,
    #[serde(default = "default_main_radius")]
    pub radius: f64,
    #[serde(default = "default_white")]
    pub color_start: String,
    #[serde(default = "default_transparent_black")]
    pub color_end: String,
    #[serde(default)]
    pub opacity: f64,
    #[serde(default)]
    pub blend_mode: BlendMode,
}

impl Default for MainLightParams {
    fn default() -> Self {
        Self {
            enabled: false,
            shape: LightShape::Radial,
            target: LightingTarget::Both,
            x: 0.5,
            y: 0.5,
            angle: 0.0,
            radius: 0.8,
            color_start: default_white(),
            color_end: default_transparent_black(),
            opacity: 0.0,
            blend_mode: BlendMode::Normal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RimLightParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_white")]
    pub color: String,
    #[serde(default)]
    pub intensity: f64,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub softness: f64,
    #[serde(default)]
    pub angle: f64,
    #[serde(default)]
    pub offset: f64,
}

impl Default for RimLightParams {
    fn default() -> Self {
        Self {
            enabled: false,
            color: default_white(),
            intensity: 0.0,
            width: 0.0,
            softness: 0.0,
            angle: 0.0,
            offset: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BloomParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub target: LightingTarget,
    #[serde(default = "default_white")]
    pub color: String,
    #[serde(default)]
    pub radius: f64,
    #[serde(default)]
    pub intensity: f64,
}

impl Default for BloomParams {
    fn default() -> Self {
        Self {
            enabled: false,
            target: LightingTarget::Both,
            color: default_white(),
            radius: 0.0,
            intensity: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct VignetteParams {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_black")]
    pub color: String,
    #[serde(default)]
    pub intensity: f64,
    #[serde(default = "default_main_radius")]
    pub radius: f64,
    #[serde(default)]
    pub softness: f64,
}

impl Default for VignetteParams {
    fn default() -> Self {
        Self {
            enabled: false,
            color: default_black(),
            intensity: 0.0,
            radius: 0.8,
            softness: 0.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct LightingAssetLayer {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub asset_hash: String,
    #[serde(default = "default_png_media_type")]
    pub media_type: String,
    #[serde(default)]
    pub target: LightingTarget,
    #[serde(default)]
    pub placement: AssetPlacement,
    #[serde(default)]
    pub z_index: i32,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub blend_mode: BlendMode,
    #[serde(default)]
    pub fit: AssetFit,
    #[serde(default)]
    pub required: bool,
}

impl Default for LightingAssetLayer {
    fn default() -> Self {
        Self {
            id: String::new(),
            asset_hash: String::new(),
            media_type: default_png_media_type(),
            target: LightingTarget::Both,
            placement: AssetPlacement::Behind,
            z_index: 0,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            fit: AssetFit::Cover,
            required: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct LightingParams {
    pub schema_version: u32,
    pub enabled: bool,
    pub master_intensity: f64,
    pub link_character_background: bool,
    pub character: FilterParams,
    pub background: FilterParams,
    pub character_ambient: AmbientParams,
    pub background_ambient: AmbientParams,
    pub main_light: MainLightParams,
    pub rim_light: RimLightParams,
    pub bloom: BloomParams,
    pub vignette: VignetteParams,
    pub asset_layers: Vec<LightingAssetLayer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relighting: Option<RelightingParams>,
}

impl Default for LightingParams {
    fn default() -> Self {
        Self {
            schema_version: LIGHTING_SCHEMA_VERSION,
            enabled: false,
            master_intensity: 1.0,
            link_character_background: true,
            character: FilterParams::default(),
            background: FilterParams::default(),
            character_ambient: AmbientParams::default(),
            background_ambient: AmbientParams::default(),
            main_light: MainLightParams::default(),
            rim_light: RimLightParams::default(),
            bloom: BloomParams::default(),
            vignette: VignetteParams::default(),
            asset_layers: Vec::new(),
            relighting: None,
        }
    }
}

fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}
fn default_main_radius() -> f64 {
    0.8
}
fn default_white() -> String {
    "#ffffff".to_string()
}
fn default_black() -> String {
    "#000000".to_string()
}
fn default_transparent_black() -> String {
    "#00000000".to_string()
}
fn default_glow_color() -> String {
    "#ffaa33".to_string()
}
fn default_png_media_type() -> String {
    "image/png".to_string()
}
