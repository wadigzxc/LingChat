import type { LightingParams } from "@/types/scene-lighting";

export function createNeutralLighting(): LightingParams {
  const filter = () => ({
    brightness: 1,
    contrast: 1,
    saturation: 1,
    sepia: 0,
    glow_radius: 0,
    glow_color: "#ffaa33",
  });
  return {
    schema_version: 2,
    enabled: false,
    master_intensity: 1,
    link_character_background: true,
    character: filter(),
    background: filter(),
    character_ambient: { enabled: false, color: "#ffffff", opacity: 0 },
    background_ambient: { enabled: false, color: "#ffffff", opacity: 0 },
    main_light: {
      enabled: false,
      shape: "radial",
      target: "both",
      x: 0.5,
      y: 0.5,
      angle: 0,
      radius: 0.8,
      color_start: "#ffffff",
      color_end: "#00000000",
      opacity: 0,
      blend_mode: "normal",
    },
    rim_light: {
      enabled: false,
      color: "#ffffff",
      intensity: 0,
      width: 0,
      softness: 0,
      angle: 0,
      offset: 0,
    },
    bloom: { enabled: false, target: "both", color: "#ffffff", radius: 0, intensity: 0 },
    vignette: { enabled: false, color: "#000000", intensity: 0, radius: 0.8, softness: 0 },
    asset_layers: [],
  };
}
