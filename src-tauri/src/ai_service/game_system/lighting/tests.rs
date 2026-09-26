use super::*;

#[test]
fn migrates_legacy_top_level_filters() {
    let lighting: LightingParams = serde_json::from_str(
        r##"{
            "brightness": 1.2,
            "contrast": 0.8,
            "saturation": 1.4,
            "sepia": 0.25,
            "glow_radius": 12,
            "glow_color": "#ABCDEF"
        }"##,
    )
    .unwrap();

    assert!(lighting.enabled);
    assert_eq!(lighting.schema_version, 2);
    assert_eq!(lighting.character, lighting.background);
    assert_eq!(lighting.character.brightness, 1.2);
    assert_eq!(lighting.character.glow_radius, 12);
    assert_eq!(lighting.character.glow_color, "#abcdef");
}

#[test]
fn migrates_legacy_top_level_overlay() {
    let lighting: LightingParams = serde_json::from_str(
        r##"{
            "brightness": 1.2,
            "overlay_enabled": true,
            "blend_mode": "screen",
            "light_x": 10,
            "light_y": 90,
            "overlay_color1": "#AABBCC",
            "overlay_color2": "#102030",
            "overlay_radius": 40,
            "overlay_opacity": 0.3,
            "overlay_target": "background"
        }"##,
    )
    .unwrap();

    assert!(lighting.main_light.enabled);
    assert_eq!(lighting.main_light.target, LightingTarget::Background);
    assert_eq!(lighting.main_light.blend_mode, BlendMode::Screen);
    assert_eq!(lighting.main_light.x, 0.1);
    assert_eq!(lighting.main_light.y, 0.9);
    assert_eq!(lighting.main_light.radius, 0.4);
    assert_eq!(lighting.main_light.opacity, 0.3);
    assert_eq!(lighting.main_light.color_start, "#aabbcc");
    assert_eq!(lighting.main_light.color_end, "#102030");
}

#[test]
fn migrates_v1_overlay_to_v2_main_light() {
    let lighting: LightingParams = serde_json::from_str(
        r##"{
            "character": {"brightness": 1.1},
            "background": {"contrast": 1.2},
            "overlay_enabled": true,
            "blend_mode": "soft_light",
            "light_x": 25,
            "light_y": 75,
            "overlay_color1": "#FFEEDD",
            "overlay_color2": "#11223344",
            "overlay_radius": 60,
            "overlay_opacity": 0.7,
            "overlay_target": "character"
        }"##,
    )
    .unwrap();

    assert!(lighting.enabled);
    assert!(lighting.main_light.enabled);
    assert_eq!(lighting.main_light.shape, LightShape::Radial);
    assert_eq!(lighting.main_light.target, LightingTarget::Character);
    assert_eq!(lighting.main_light.x, 0.25);
    assert_eq!(lighting.main_light.y, 0.75);
    assert_eq!(lighting.main_light.radius, 0.6);
    assert_eq!(lighting.main_light.opacity, 0.7);
    assert_eq!(lighting.main_light.blend_mode, BlendMode::SoftLight);
    assert_eq!(lighting.main_light.color_start, "#ffeedd");
    assert_eq!(lighting.main_light.color_end, "#11223344");
    assert_eq!(lighting.character.brightness, 1.1);
    assert_eq!(lighting.background.contrast, 1.2);
}

#[test]
fn normalizes_ranges_and_colors() {
    let mut lighting = LightingParams::default();
    lighting.master_intensity = 9.0;
    lighting.character.brightness = -1.0;
    lighting.character.contrast = 9.0;
    lighting.character.saturation = -1.0;
    lighting.character.sepia = 9.0;
    lighting.character.glow_radius = 99;
    lighting.character.glow_color = " #ABCDEF ".into();
    lighting.character_ambient.opacity = -1.0;
    lighting.main_light.x = -1.0;
    lighting.main_light.y = 2.0;
    lighting.main_light.angle = 725.0;
    lighting.main_light.radius = 2.0;
    lighting.main_light.opacity = 3.0;
    lighting.rim_light.intensity = 3.0;
    lighting.rim_light.width = 100.0;
    lighting.rim_light.softness = -5.0;
    lighting.rim_light.angle = -10.0;
    lighting.rim_light.offset = 100.0;
    lighting.bloom.radius = 100.0;
    lighting.bloom.intensity = 2.0;
    lighting.vignette.intensity = 2.0;
    lighting.vignette.radius = -1.0;
    lighting.vignette.softness = 2.0;
    lighting.asset_layers.push(LightingAssetLayer {
        z_index: 99,
        opacity: -1.0,
        ..LightingAssetLayer::default()
    });

    lighting.normalize();

    assert_eq!(lighting.master_intensity, 2.0);
    assert_eq!(lighting.character.brightness, 0.3);
    assert_eq!(lighting.character.contrast, 2.0);
    assert_eq!(lighting.character.saturation, 0.0);
    assert_eq!(lighting.character.sepia, 1.0);
    assert_eq!(lighting.character.glow_radius, 50);
    assert_eq!(lighting.character.glow_color, "#abcdef");
    assert_eq!(lighting.character_ambient.opacity, 0.0);
    assert_eq!(lighting.main_light.x, 0.0);
    assert_eq!(lighting.main_light.y, 1.0);
    assert_eq!(lighting.main_light.angle, 360.0);
    assert_eq!(lighting.main_light.radius, 1.0);
    assert_eq!(lighting.main_light.opacity, 1.0);
    assert_eq!(lighting.rim_light.intensity, 2.0);
    assert_eq!(lighting.rim_light.width, 64.0);
    assert_eq!(lighting.rim_light.softness, 0.0);
    assert_eq!(lighting.rim_light.angle, 0.0);
    assert_eq!(lighting.rim_light.offset, 64.0);
    assert_eq!(lighting.bloom.radius, 64.0);
    assert_eq!(lighting.bloom.intensity, 1.0);
    assert_eq!(lighting.vignette.intensity, 1.0);
    assert_eq!(lighting.vignette.radius, 0.0);
    assert_eq!(lighting.vignette.softness, 1.0);
    assert_eq!(lighting.asset_layers[0].z_index, 7);
    assert_eq!(lighting.asset_layers[0].opacity, 0.0);
}

#[test]
fn falls_back_unknown_enum_values() {
    let lighting: LightingParams = serde_json::from_str(
        r#"{
            "schema_version": 2,
            "main_light": {
                "shape": "future_shape",
                "target": "future_target",
                "blend_mode": "future_blend"
            },
            "bloom": {"target": "future_target"},
            "asset_layers": [{
                "target": "future_target",
                "placement": "future_placement",
                "blend_mode": "future_blend",
                "fit": "future_fit"
            }]
        }"#,
    )
    .unwrap();

    assert_eq!(lighting.main_light.shape, LightShape::Radial);
    assert_eq!(lighting.main_light.target, LightingTarget::Both);
    assert_eq!(lighting.main_light.blend_mode, BlendMode::Normal);
    assert_eq!(lighting.bloom.target, LightingTarget::Both);
    assert_eq!(lighting.asset_layers[0].target, LightingTarget::Both);
    assert_eq!(lighting.asset_layers[0].placement, AssetPlacement::Behind);
    assert_eq!(lighting.asset_layers[0].blend_mode, BlendMode::Normal);
    assert_eq!(lighting.asset_layers[0].fit, AssetFit::Cover);
}

#[test]
fn round_trips_v2_without_loss() {
    let mut lighting = LightingParams::default();
    lighting.enabled = true;
    lighting.master_intensity = 1.5;
    lighting.link_character_background = false;
    lighting.main_light = MainLightParams {
        enabled: true,
        shape: LightShape::Linear,
        target: LightingTarget::Background,
        x: 0.2,
        y: 0.7,
        angle: 135.0,
        radius: 0.6,
        color_start: "#abcdef".into(),
        color_end: "#12345678".into(),
        opacity: 0.75,
        blend_mode: BlendMode::Overlay,
    };
    lighting.asset_layers.push(LightingAssetLayer {
        id: "flare".into(),
        asset_hash: "abc123".into(),
        media_type: "image/png".into(),
        target: LightingTarget::Character,
        placement: AssetPlacement::Front,
        z_index: 4,
        opacity: 0.8,
        blend_mode: BlendMode::Add,
        fit: AssetFit::Contain,
        required: true,
    });

    let json = serde_json::to_string(&lighting).unwrap();
    let decoded: LightingParams = serde_json::from_str(&json).unwrap();

    assert_eq!(decoded, lighting);
}

#[test]
fn uses_snake_case_blend_mode_wire_values() {
    let cases = [
        (BlendMode::Normal, "\"normal\""),
        (BlendMode::Screen, "\"screen\""),
        (BlendMode::Add, "\"add\""),
        (BlendMode::Overlay, "\"overlay\""),
        (BlendMode::SoftLight, "\"soft_light\""),
        (BlendMode::Multiply, "\"multiply\""),
    ];

    for (mode, expected) in cases {
        assert_eq!(serde_json::to_string(&mode).unwrap(), expected);
        assert_eq!(serde_json::from_str::<BlendMode>(expected).unwrap(), mode);
    }
}

#[test]
fn defaults_missing_v2_fields() {
    let lighting: LightingParams = serde_json::from_str(r#"{"schema_version":2}"#).unwrap();

    assert_eq!(lighting, LightingParams::default());
    assert_eq!(lighting.schema_version, 2);
    assert_eq!(lighting.master_intensity, 1.0);
    assert_eq!(lighting.main_light.x, 0.5);
    assert_eq!(lighting.main_light.y, 0.5);
    assert_eq!(lighting.main_light.radius, 0.8);
    assert_eq!(lighting.asset_layers.len(), 0);
}
