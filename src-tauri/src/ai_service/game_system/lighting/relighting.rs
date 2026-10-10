use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelightingMode {
    Relight,
    #[default]
    #[serde(other)]
    Original,
}

/// both 选择两个 source，各处理一次；不复用旧 overall 槽的枚举语义。
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelightingTarget {
    Character,
    Background,
    #[default]
    #[serde(other)]
    Both,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct RelightingAmbientParams {
    pub intensity: f64,
    pub color: String,
}

impl Default for RelightingAmbientParams {
    fn default() -> Self {
        Self {
            intensity: 1.0,
            color: "#ffffff".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct RelightingPointLightParams {
    pub enabled: bool,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub softness: f64,
    pub intensity: f64,
    pub color: String,
}

impl Default for RelightingPointLightParams {
    fn default() -> Self {
        Self {
            enabled: true,
            x: 0.5,
            y: 0.5,
            radius: 0.75,
            softness: 0.8,
            intensity: 0.85,
            color: "#fff1d2".into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct RelightingParams {
    pub enabled: bool,
    pub mode: RelightingMode,
    pub target: RelightingTarget,
    pub ambient: RelightingAmbientParams,
    pub point_light: RelightingPointLightParams,
}

impl Default for RelightingParams {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: RelightingMode::Original,
            target: RelightingTarget::Both,
            ambient: RelightingAmbientParams::default(),
            point_light: RelightingPointLightParams::default(),
        }
    }
}

impl RelightingParams {
    pub fn normalize(&mut self) {
        let defaults = Self::default();
        self.ambient.intensity =
            bounded(self.ambient.intensity, 0.0, 2.0, defaults.ambient.intensity);
        self.ambient.color = opaque_color(&self.ambient.color, &defaults.ambient.color);
        self.point_light.x = bounded(self.point_light.x, 0.0, 1.0, defaults.point_light.x);
        self.point_light.y = bounded(self.point_light.y, 0.0, 1.0, defaults.point_light.y);
        self.point_light.radius = bounded(
            self.point_light.radius,
            0.01,
            2.0,
            defaults.point_light.radius,
        );
        self.point_light.softness = bounded(
            self.point_light.softness,
            0.0,
            1.0,
            defaults.point_light.softness,
        );
        self.point_light.intensity = bounded(
            self.point_light.intensity,
            0.0,
            4.0,
            defaults.point_light.intensity,
        );
        self.point_light.color = opaque_color(&self.point_light.color, &defaults.point_light.color);
    }
}

fn bounded(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

fn opaque_color(value: &str, fallback: &str) -> String {
    // 对齐 JS String.trim：包括 BOM，不把 Unicode NEL 当作可裁剪空白。
    let value =
        value.trim_matches(|ch: char| (ch.is_whitespace() && ch != '\u{0085}') || ch == '\u{feff}');
    if value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        value.to_ascii_lowercase()
    } else {
        fallback.to_string()
    }
}
