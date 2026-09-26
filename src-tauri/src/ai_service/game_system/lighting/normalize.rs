use super::model::{FilterParams, LightingParams};

impl LightingParams {
    pub fn normalize(&mut self) {
        self.schema_version = super::LIGHTING_SCHEMA_VERSION;
        self.master_intensity = clamp(self.master_intensity, 0.0, 2.0, 1.0);
        normalize_filter(&mut self.character);
        normalize_filter(&mut self.background);

        self.character_ambient.opacity = clamp01(self.character_ambient.opacity);
        self.character_ambient.color = normalize_color(&self.character_ambient.color, "#ffffff");
        self.background_ambient.opacity = clamp01(self.background_ambient.opacity);
        self.background_ambient.color = normalize_color(&self.background_ambient.color, "#ffffff");

        self.main_light.x = clamp01(self.main_light.x);
        self.main_light.y = clamp01(self.main_light.y);
        self.main_light.angle = clamp(self.main_light.angle, 0.0, 360.0, 0.0);
        self.main_light.radius = clamp01(self.main_light.radius);
        self.main_light.opacity = clamp01(self.main_light.opacity);
        self.main_light.color_start = normalize_color(&self.main_light.color_start, "#ffffff");
        self.main_light.color_end = normalize_color(&self.main_light.color_end, "#00000000");

        self.rim_light.intensity = clamp(self.rim_light.intensity, 0.0, 2.0, 0.0);
        self.rim_light.width = clamp(self.rim_light.width, 0.0, 64.0, 0.0);
        self.rim_light.softness = clamp(self.rim_light.softness, 0.0, 64.0, 0.0);
        self.rim_light.angle = clamp(self.rim_light.angle, 0.0, 360.0, 0.0);
        self.rim_light.offset = clamp(self.rim_light.offset, 0.0, 64.0, 0.0);
        self.rim_light.color = normalize_color(&self.rim_light.color, "#ffffff");

        self.bloom.radius = clamp(self.bloom.radius, 0.0, 64.0, 0.0);
        self.bloom.intensity = clamp01(self.bloom.intensity);
        self.bloom.color = normalize_color(&self.bloom.color, "#ffffff");

        self.vignette.intensity = clamp01(self.vignette.intensity);
        self.vignette.radius = clamp01(self.vignette.radius);
        self.vignette.softness = clamp01(self.vignette.softness);
        self.vignette.color = normalize_color(&self.vignette.color, "#000000");

        for layer in &mut self.asset_layers {
            layer.z_index = layer.z_index.clamp(0, 7);
            layer.opacity = clamp01(layer.opacity);
        }
    }
}

fn normalize_filter(filter: &mut FilterParams) {
    filter.brightness = clamp(filter.brightness, 0.3, 2.2, 1.0);
    filter.contrast = clamp(filter.contrast, 0.5, 2.0, 1.0);
    filter.saturation = clamp(filter.saturation, 0.0, 2.5, 1.0);
    filter.sepia = clamp01(filter.sepia);
    filter.glow_radius = filter.glow_radius.clamp(0, 50);
    filter.glow_color = normalize_color(&filter.glow_color, "#ffaa33");
}

fn clamp01(value: f64) -> f64 {
    clamp(value, 0.0, 1.0, 0.0)
}

fn clamp(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

fn normalize_color(value: &str, fallback: &str) -> String {
    let value = value.trim();
    let valid = matches!(value.len(), 4 | 5 | 7 | 9)
        && value.starts_with('#')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if valid {
        value.to_ascii_lowercase()
    } else {
        fallback.to_string()
    }
}
