import { expect, it } from "vitest";
import { createNeutralLighting } from "../defaults";
import { normalizeLighting } from "../normalize";

it("clamps V2 numeric ranges and hex colors without mutating input", () => {
  const input = createNeutralLighting();
  input.master_intensity = Infinity;
  Object.assign(input.character, {
    brightness: -1,
    contrast: 9,
    saturation: NaN,
    sepia: 2,
    glow_radius: 99,
    glow_color: " #ABCD ",
  });
  Object.assign(input.main_light, {
    x: NaN,
    y: 2,
    radius: -1,
    angle: 900,
    opacity: 2,
    color_start: "red",
    color_end: " #AABBCCDD ",
  });
  Object.assign(input.rim_light, {
    width: 99,
    softness: -1,
    offset: NaN,
    intensity: 4,
    angle: -10,
  });
  Object.assign(input.bloom, { radius: 90, intensity: Infinity });
  Object.assign(input.vignette, { radius: NaN, softness: 2, intensity: -1 });
  input.character_ambient.opacity = 5;
  input.background_ambient.color = "url(evil)";
  const result = normalizeLighting(input);
  expect(result.master_intensity).toBe(1);
  expect(result.character).toEqual({
    brightness: 0.3,
    contrast: 2,
    saturation: 1,
    sepia: 1,
    glow_radius: 50,
    glow_color: "#abcd",
  });
  expect(result.main_light).toMatchObject({
    x: 0,
    y: 1,
    radius: 0,
    angle: 360,
    opacity: 1,
    color_start: "#ffffff",
    color_end: "#aabbccdd",
  });
  expect(result.rim_light).toMatchObject({
    width: 64,
    softness: 0,
    offset: 0,
    intensity: 2,
    angle: 0,
  });
  expect(result.bloom).toMatchObject({ radius: 64, intensity: 0 });
  expect(result.vignette).toMatchObject({ radius: 0, softness: 1, intensity: 0 });
  expect(result.character_ambient.opacity).toBe(1);
  expect(result.background_ambient.color).toBe("#ffffff");
  expect(input.character.brightness).toBe(-1);
  expect(input.main_light.x).toBeNaN();
  expect(normalizeLighting(null)).toEqual(createNeutralLighting());
});

it("preserves supported enums and normalizes asset records with Rust defaults", () => {
  const result = normalizeLighting({
    main_light: { shape: "linear", target: "character", blend_mode: "soft_light" },
    bloom: { target: "background" },
    asset_layers: [
      {
        id: "a",
        asset_hash: "hash",
        target: "character",
        placement: "front",
        fit: "stretch",
        blend_mode: "add",
        z_index: 99,
        opacity: 4,
      },
      {
        target: "unknown",
        fit: "unknown",
        placement: "unknown",
        blend_mode: "unknown",
        z_index: -1,
        opacity: NaN,
      },
    ],
  });
  expect(result.main_light).toMatchObject({
    shape: "linear",
    target: "character",
    blend_mode: "soft_light",
  });
  expect(result.bloom.target).toBe("background");
  expect(result.asset_layers[0]).toEqual({
    id: "a",
    asset_hash: "hash",
    media_type: "image/png",
    target: "character",
    placement: "front",
    fit: "stretch",
    blend_mode: "add",
    z_index: 7,
    opacity: 1,
    required: false,
  });
  expect(result.asset_layers[1]).toMatchObject({
    target: "both",
    fit: "cover",
    placement: "behind",
    blend_mode: "normal",
    z_index: 0,
    opacity: 0,
  });
  expect(
    normalizeLighting({
      main_light: { shape: "unknown", target: "unknown", blend_mode: "unknown" },
      asset_layers: "bad",
    })
  ).toEqual(createNeutralLighting());
});
