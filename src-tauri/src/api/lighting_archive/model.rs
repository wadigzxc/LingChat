use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ai_service::game_system::lighting::LightingParams;

pub const LINGLIGHT_FORMAT: &str = "linglight";
pub const LINGLIGHT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "ManifestWire")]
pub struct LingLightManifest {
    pub format: String,
    pub version: u32,
    #[serde(rename = "originId")]
    pub origin_id: Option<String>,
    #[serde(default = "default_revision")]
    pub revision: u32,
    pub metadata: PresetSnapshot,
    pub lighting: LightingParams,
    #[serde(default)]
    pub assets: Vec<ManifestAsset>,
    #[serde(rename = "futureLayers", default)]
    pub future_layers: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestAsset {
    pub id: String,
    pub path: String,
    pub sha256: String,
    #[serde(rename = "mediaType")]
    pub media_type: String,
    #[serde(rename = "bytes")]
    pub byte_size: u64,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub required: bool,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ManifestWire {
    Standard(StandardManifest),
    Legacy(LegacyManifest),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StandardManifest {
    format: String,
    version: u32,
    #[serde(rename = "originId")]
    origin_id: Option<String>,
    #[serde(default = "default_revision")]
    revision: u32,
    metadata: PresetSnapshot,
    #[serde(deserialize_with = "deserialize_archive_lighting")]
    lighting: LightingParams,
    #[serde(default)]
    assets: Vec<ManifestAsset>,
    #[serde(rename = "futureLayers", default)]
    future_layers: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyManifest {
    format: String,
    version: u32,
    #[serde(default)]
    required_capabilities: Vec<String>,
    #[serde(default)]
    optional_capabilities: Vec<String>,
    preset: LegacyPreset,
    origin: LegacyOrigin,
    #[serde(default)]
    assets: Vec<LegacyAsset>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyPreset {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    category: String,
    #[serde(deserialize_with = "deserialize_archive_lighting")]
    lighting: LightingParams,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyOrigin {
    id: String,
    #[serde(default = "default_revision")]
    revision: u32,
    #[serde(default)]
    created_by: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyAsset {
    id: String,
    path: String,
    sha256: String,
    byte_size: u64,
    width: u32,
    height: u32,
    #[serde(deserialize_with = "deserialize_archive_enum")]
    target: crate::ai_service::game_system::lighting::LightingTarget,
    #[serde(deserialize_with = "deserialize_archive_enum")]
    placement: crate::ai_service::game_system::lighting::AssetPlacement,
    z_index: i32,
    opacity: f64,
    #[serde(deserialize_with = "deserialize_archive_enum")]
    blend_mode: crate::ai_service::game_system::lighting::BlendMode,
    #[serde(deserialize_with = "deserialize_archive_enum")]
    fit: crate::ai_service::game_system::lighting::AssetFit,
    #[serde(default)]
    required: bool,
}

impl TryFrom<ManifestWire> for LingLightManifest {
    type Error = String;

    fn try_from(wire: ManifestWire) -> Result<Self, Self::Error> {
        match wire {
            ManifestWire::Standard(m) => Ok(Self {
                format: m.format,
                version: m.version,
                origin_id: m.origin_id,
                revision: m.revision,
                metadata: m.metadata,
                lighting: m.lighting,
                assets: m.assets,
                future_layers: m.future_layers,
            }),
            ManifestWire::Legacy(m) => {
                // Legacy assets duplicate layout data; do not silently discard mismatches.
                let mut assets = Vec::with_capacity(m.assets.len());
                for asset in m.assets {
                    let layer = m
                        .preset
                        .lighting
                        .asset_layers
                        .iter()
                        .find(|l| l.id == asset.id)
                        .ok_or_else(|| format!("legacy asset has no layer: {}", asset.id))?;
                    if layer.media_type != "image/png"
                        || layer.asset_hash != asset.sha256
                        || layer.target != asset.target
                        || layer.placement != asset.placement
                        || layer.z_index != asset.z_index
                        || layer.opacity != asset.opacity
                        || layer.blend_mode != asset.blend_mode
                        || layer.fit != asset.fit
                        || layer.required != asset.required
                    {
                        return Err(format!("legacy asset layout mismatch: {}", asset.id));
                    }
                    assets.push(ManifestAsset {
                        id: asset.id,
                        path: asset.path,
                        sha256: asset.sha256,
                        media_type: "image/png".into(),
                        byte_size: asset.byte_size,
                        width: asset.width,
                        height: asset.height,
                        required: asset.required,
                    });
                }
                // Capabilities retain their required/optional semantics in the new validator.
                let future_layers = m
                    .required_capabilities
                    .into_iter()
                    .map(|id| serde_json::json!({"id": id, "required": true}))
                    .chain(
                        m.optional_capabilities
                            .into_iter()
                            .map(|id| serde_json::json!({"id": id, "required": false})),
                    )
                    .collect();
                let _created_by = m.origin.created_by;
                Ok(Self {
                    format: m.format,
                    version: m.version,
                    origin_id: Some(m.origin.id),
                    revision: m.origin.revision,
                    metadata: PresetSnapshot {
                        name: m.preset.name,
                        description: m.preset.description,
                        aliases: m.preset.aliases,
                        tags: m.preset.tags,
                        category: m.preset.category,
                    },
                    lighting: m.preset.lighting,
                    assets,
                    future_layers,
                })
            },
        }
    }
}

fn deserialize_archive_enum<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned + Serialize,
{
    let wire = Value::deserialize(deserializer)?;
    let typed: T = serde_json::from_value(wire.clone()).map_err(serde::de::Error::custom)?;
    if serde_json::to_value(&typed).map_err(serde::de::Error::custom)? != wire {
        return Err(serde::de::Error::custom("unsupported legacy asset enum"));
    }
    Ok(typed)
}

// Runtime DTOs intentionally accept extra fields/default unknown enum strings. Archives
// must not: compare each supplied field against the typed serialization, recursively.
fn deserialize_archive_lighting<'de, D>(deserializer: D) -> Result<LightingParams, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let mut wire = Value::deserialize(deserializer)?;
    let lighting: LightingParams =
        serde_json::from_value(wire.clone()).map_err(serde::de::Error::custom)?;
    let typed = serde_json::to_value(&lighting).map_err(serde::de::Error::custom)?;
    // 仅已声明的 lighting 根 nullable 字段可省略；通用递归比较器仍拒绝其他 null/未知键。
    if lighting.relighting.is_none() {
        if let Some(fields) = wire.as_object_mut() {
            if fields.get("relighting").is_some_and(Value::is_null) {
                fields.remove("relighting");
            }
        }
    }
    validate_supplied_fields(&wire, &typed).map_err(serde::de::Error::custom)?;
    Ok(lighting)
}

fn validate_supplied_fields(wire: &Value, typed: &Value) -> Result<(), String> {
    match (wire, typed) {
        (Value::Object(fields), Value::Object(known)) => {
            for (key, value) in fields {
                let expected = known
                    .get(key)
                    .ok_or_else(|| format!("unknown lighting field: {key}"))?;
                validate_supplied_fields(value, expected)?;
            }
            Ok(())
        },
        (Value::Array(values), Value::Array(expected)) if values.len() == expected.len() => {
            for (value, expected) in values.iter().zip(expected) {
                validate_supplied_fields(value, expected)?;
            }
            Ok(())
        },
        (Value::Number(value), Value::Number(expected)) if value.as_f64() == expected.as_f64() => {
            Ok(())
        },
        _ if wire == typed => Ok(()),
        _ => Err("unsupported lighting value".into()),
    }
}

fn default_revision() -> u32 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn v1_manifest_uses_the_documented_wire_contract() {
        let wire = json!({
            "format": "linglight",
            "version": 1,
            "originId": "origin-1",
            "revision": 3,
            "metadata": {
                "name": "Cold Backlight",
                "description": "fixture",
                "aliases": ["cold backlight"],
                "tags": ["cold", "backlight"],
                "category": "cinematic"
            },
            "lighting": LightingParams::default(),
            "assets": [{
                "id": "flare-1",
                "path": "assets/hash.png",
                "sha256": "a".repeat(64),
                "mediaType": "image/png",
                "bytes": 1234,
                "width": 1920,
                "height": 1080,
                "required": true
            }],
            "futureLayers": []
        });

        let manifest: LingLightManifest = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(manifest).unwrap(), wire);
    }

    #[test]
    fn v1_manifest_normalizes_legacy_nested_wire_shape() {
        let legacy = json!({
            "format": "linglight",
            "version": 1,
            "preset": {
                "name": "legacy",
                "lighting": LightingParams::default()
            },
            "origin": { "id": "legacy", "revision": 1 },
            "assets": []
        });

        let manifest: LingLightManifest = serde_json::from_value(legacy).unwrap();
        let normalized = serde_json::to_value(manifest).unwrap();
        assert_eq!(normalized["originId"], "legacy");
        assert_eq!(normalized["metadata"]["name"], "legacy");
        assert!(normalized.get("preset").is_none());
        assert!(normalized.get("origin").is_none());
    }
}
