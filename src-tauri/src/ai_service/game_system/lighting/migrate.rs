use serde::{Deserialize, Deserializer, de};
use serde_json::Value;

use super::RelightingParams;
use super::model::*;

#[derive(Deserialize)]
#[serde(default, rename_all = "snake_case")]
struct LightingV2Wire {
    schema_version: Option<u32>,
    enabled: bool,
    master_intensity: Option<f64>,
    link_character_background: Option<bool>,
    character: FilterParams,
    background: FilterParams,
    character_ambient: AmbientParams,
    background_ambient: AmbientParams,
    main_light: MainLightParams,
    rim_light: RimLightParams,
    bloom: BloomParams,
    vignette: VignetteParams,
    asset_layers: Vec<LightingAssetLayer>,
    relighting: Option<RelightingParams>,
}

impl Default for LightingV2Wire {
    fn default() -> Self {
        Self {
            schema_version: None,
            enabled: false,
            master_intensity: None,
            link_character_background: None,
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

impl<'de> Deserialize<'de> for LightingParams {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        // 显式版本先验证；未知/错格式不能回退到旧迁移并静默丢掉新块。
        let version = match value.get("schema_version") {
            None => None,
            Some(raw) => {
                let version = raw.as_u64().ok_or_else(|| {
                    de::Error::custom("lighting schema_version must be a nonnegative integer")
                })?;
                if version > u64::from(LIGHTING_SCHEMA_VERSION) {
                    return Err(de::Error::custom("unsupported lighting schema_version"));
                }
                Some(version)
            },
        };
        let is_v2 = version == Some(u64::from(LIGHTING_SCHEMA_VERSION));
        let mut lighting = if is_v2 {
            migrate_v2(value).map_err(de::Error::custom)?
        } else if value.get("character").is_some() || value.get("background").is_some() {
            migrate_v1(value).map_err(de::Error::custom)?
        } else {
            migrate_v0(value).map_err(de::Error::custom)?
        };
        lighting.normalize();
        Ok(lighting)
    }
}

fn migrate_v2(value: Value) -> serde_json::Result<LightingParams> {
    // serde 的 struct visitor 可接受序列；wire 契约限定新块及内层对象为 JSON object。
    if let Some(block) = value.get("relighting").filter(|block| !block.is_null()) {
        let fields = block.as_object().ok_or_else(|| {
            <serde_json::Error as de::Error>::custom("relighting must be an object or null")
        })?;
        for key in ["ambient", "point_light"] {
            if fields.get(key).is_some_and(|nested| !nested.is_object()) {
                return Err(<serde_json::Error as de::Error>::custom(format!(
                    "relighting.{key} must be an object"
                )));
            }
        }
    }
    let wire: LightingV2Wire = serde_json::from_value(value)?;
    let defaults = LightingParams::default();
    let _input_schema_version = wire.schema_version;
    Ok(LightingParams {
        schema_version: LIGHTING_SCHEMA_VERSION,
        enabled: wire.enabled,
        master_intensity: wire.master_intensity.unwrap_or(defaults.master_intensity),
        link_character_background: wire
            .link_character_background
            .unwrap_or(defaults.link_character_background),
        character: wire.character,
        background: wire.background,
        character_ambient: wire.character_ambient,
        background_ambient: wire.background_ambient,
        main_light: wire.main_light,
        rim_light: wire.rim_light,
        bloom: wire.bloom,
        vignette: wire.vignette,
        asset_layers: wire.asset_layers,
        relighting: wire.relighting,
    })
}

fn migrate_v1(value: Value) -> serde_json::Result<LightingParams> {
    let character = value
        .get("character")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let background = value
        .get("background")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let main_light = migrate_legacy_main_light(&value);
    Ok(LightingParams {
        enabled: true,
        link_character_background: false,
        character,
        background,
        main_light,
        ..LightingParams::default()
    })
}

fn migrate_v0(value: Value) -> serde_json::Result<LightingParams> {
    let main_light = migrate_legacy_main_light(&value);
    let filter: FilterParams = serde_json::from_value(value)?;
    Ok(LightingParams {
        enabled: true,
        character: filter.clone(),
        background: filter,
        main_light,
        ..LightingParams::default()
    })
}

fn migrate_legacy_main_light(value: &Value) -> MainLightParams {
    MainLightParams {
        enabled: value
            .get("overlay_enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        x: legacy_percent(value, "light_x", 50.0),
        y: legacy_percent(value, "light_y", 50.0),
        radius: legacy_percent(value, "overlay_radius", 80.0),
        opacity: value
            .get("overlay_opacity")
            .and_then(Value::as_f64)
            .unwrap_or(0.5),
        color_start: legacy_string(value, "overlay_color1", "#ffb44b"),
        color_end: legacy_string(value, "overlay_color2", "#18202e"),
        target: parse_target(
            value
                .get("overlay_target")
                .and_then(Value::as_str)
                .unwrap_or("both"),
        ),
        blend_mode: parse_blend_mode(
            value
                .get("blend_mode")
                .and_then(Value::as_str)
                .unwrap_or("normal"),
        ),
        ..MainLightParams::default()
    }
}

fn legacy_percent(value: &Value, key: &str, fallback: f64) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(fallback) / 100.0
}

fn legacy_string(value: &Value, key: &str, fallback: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn parse_target(value: &str) -> LightingTarget {
    match value {
        "character" => LightingTarget::Character,
        "background" => LightingTarget::Background,
        _ => LightingTarget::Both,
    }
}

fn parse_blend_mode(value: &str) -> BlendMode {
    match value {
        "screen" => BlendMode::Screen,
        "add" => BlendMode::Add,
        "overlay" => BlendMode::Overlay,
        "soft_light" => BlendMode::SoftLight,
        "multiply" => BlendMode::Multiply,
        _ => BlendMode::Normal,
    }
}
