use crate::ai_service::game_system::lighting::{
    BlendMode, LightShape, LightingParams, LightingTarget,
};

use super::model::{LightingPreset, PresetKind};

const BUILTIN_TIMESTAMP: &str = "2026-01-01T00:00:00Z";

pub fn builtin_presets() -> Vec<LightingPreset> {
    vec![
        builtin(
            "builtin:neutral",
            "中性",
            "lighting.presets.neutral",
            &["中性", "Neutral"],
            "neutral",
            LightingParams::default(),
        ),
        builtin(
            "builtin:cold-backlight",
            "冷色逆光",
            "lighting.presets.cold_backlight",
            &["冷色逆光", "Cold Backlight"],
            "cinematic",
            cold_backlight(),
        ),
        builtin(
            "builtin:warm-side",
            "暖阳侧光",
            "lighting.presets.warm_side",
            &["暖阳侧光", "Warm Side Light"],
            "natural",
            warm_side(),
        ),
        builtin(
            "builtin:moonlight",
            "月夜",
            "lighting.presets.moonlight",
            &["月夜", "Moonlight"],
            "night",
            moonlight(),
        ),
        builtin(
            "builtin:indoor-soft",
            "室内柔光",
            "lighting.presets.indoor_soft",
            &["室内柔光", "Indoor Soft Light"],
            "indoor",
            indoor_soft(),
        ),
    ]
}

fn builtin(
    id: &str,
    name: &str,
    i18n_key: &str,
    aliases: &[&str],
    category: &str,
    mut lighting: LightingParams,
) -> LightingPreset {
    lighting.normalize();
    LightingPreset {
        id: id.to_string(),
        origin_id: Some(id.to_string()),
        revision: 1,
        kind: PresetKind::BuiltIn,
        name: name.to_string(),
        i18n_key: Some(i18n_key.to_string()),
        description: String::new(),
        aliases: aliases.iter().map(|alias| (*alias).to_string()).collect(),
        tags: vec![category.to_string()],
        category: category.to_string(),
        favorite: false,
        last_used_at: None,
        lighting,
        created_at: BUILTIN_TIMESTAMP.to_string(),
        updated_at: BUILTIN_TIMESTAMP.to_string(),
    }
}

fn cold_backlight() -> LightingParams {
    let mut lighting = LightingParams::default();
    lighting.enabled = true;
    lighting.rim_light.enabled = true;
    lighting.rim_light.color = "#8ac7ff".to_string();
    lighting.rim_light.intensity = 1.25;
    lighting.rim_light.width = 18.0;
    lighting.rim_light.softness = 12.0;
    lighting.rim_light.angle = 180.0;
    lighting.background_ambient.enabled = true;
    lighting.background_ambient.color = "#142b4a".to_string();
    lighting.background_ambient.opacity = 0.35;
    lighting
}

fn warm_side() -> LightingParams {
    let mut lighting = LightingParams::default();
    lighting.enabled = true;
    lighting.main_light.enabled = true;
    lighting.main_light.shape = LightShape::Linear;
    lighting.main_light.target = LightingTarget::Both;
    lighting.main_light.x = 0.2;
    lighting.main_light.angle = 25.0;
    lighting.main_light.color_start = "#ffd39b".to_string();
    lighting.main_light.color_end = "#ff9b4a00".to_string();
    lighting.main_light.opacity = 0.65;
    lighting.main_light.blend_mode = BlendMode::SoftLight;
    lighting
}

fn moonlight() -> LightingParams {
    let mut lighting = LightingParams::default();
    lighting.enabled = true;
    lighting.character_ambient.enabled = true;
    lighting.character_ambient.color = "#7186c7".to_string();
    lighting.character_ambient.opacity = 0.32;
    lighting.background_ambient.enabled = true;
    lighting.background_ambient.color = "#182343".to_string();
    lighting.background_ambient.opacity = 0.55;
    lighting.vignette.enabled = true;
    lighting.vignette.intensity = 0.35;
    lighting.vignette.softness = 0.45;
    lighting
}

fn indoor_soft() -> LightingParams {
    let mut lighting = LightingParams::default();
    lighting.enabled = true;
    lighting.main_light.enabled = true;
    lighting.main_light.color_start = "#fff1d6".to_string();
    lighting.main_light.color_end = "#e7d2b000".to_string();
    lighting.main_light.radius = 0.75;
    lighting.main_light.opacity = 0.38;
    lighting.main_light.blend_mode = BlendMode::SoftLight;
    lighting.bloom.enabled = true;
    lighting.bloom.color = "#ffe4bd".to_string();
    lighting.bloom.radius = 18.0;
    lighting.bloom.intensity = 0.12;
    lighting
}
