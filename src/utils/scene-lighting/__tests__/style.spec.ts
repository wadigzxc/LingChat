import { expect, it } from "vitest";
import { createNeutralLighting } from "../defaults";
import { compileLighting } from "../style";

it("keeps legacy correction order including glow before sepia", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.character = {
    brightness: 1.2,
    contrast: 0.8,
    saturation: 0.5,
    glow_radius: 4,
    glow_color: "#ffaa33",
    sepia: 0.2,
  };
  expect(compileLighting(input, "character").filter).toBe(
    "brightness(1.2) contrast(0.8) saturate(0.5) drop-shadow(0 0 4px #ffaa33) sepia(0.2)"
  );
  expect(compileLighting(input, "background").filter).toBe("none");
  expect(compileLighting(input, "both").filter).toBe("none");
});

it("maps every blend mode explicitly and only add may fall back by capability", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.main_light.enabled = true;
  input.main_light.opacity = 0.5;
  for (const [wire, css] of [
    ["normal", "normal"],
    ["screen", "screen"],
    ["add", "plus-lighter"],
    ["overlay", "overlay"],
    ["soft_light", "soft-light"],
    ["multiply", "multiply"],
  ] as const) {
    input.main_light.blend_mode = wire;
    expect(compileLighting(input, "both").mainLight?.mixBlendMode).toBe(css);
    const fallback = compileLighting(input, "both", { supportsPlusLighter: false });
    expect(fallback.mainLight?.mixBlendMode).toBe(wire === "add" ? "screen" : css);
    expect(fallback.warnings).toEqual(wire === "add" ? ["add-blend-fallback"] : []);
  }
});

it("routes each target to exactly one character/background/overall slot", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.main_light.enabled = true;
  input.main_light.opacity = 1;
  for (const target of ["character", "background", "both"] as const) {
    input.main_light.target = target;
    for (const surface of ["character", "background", "both"] as const) {
      expect(compileLighting(input, surface).mainLight !== null).toBe(target === surface);
    }
  }
});

it("compiles radial normalized center and radius", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  Object.assign(input.main_light, { enabled: true, opacity: 0.4, x: 0.25, y: 0.75, radius: 0.6 });
  expect(compileLighting(input, "both").mainLight?.background).toBe(
    "radial-gradient(circle at 25% 75%, #ffffff 0%, #00000000 60%)"
  );
});

it("projects linear center onto CSS angle and uses normalized transition radius", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  Object.assign(input.main_light, {
    enabled: true,
    opacity: 1,
    shape: "linear",
    angle: 90,
    x: 0.25,
    y: 0.75,
    radius: 0.2,
  });
  expect(compileLighting(input, "both").mainLight?.background).toBe(
    "linear-gradient(90deg, #ffffff 15%, #00000000 35%)"
  );
  input.main_light.angle = 0;
  expect(compileLighting(input, "both").mainLight?.background).toBe(
    "linear-gradient(0deg, #ffffff 15%, #00000000 35%)"
  );
});

it("scales master intensity without changing correction sources or light geometry", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.master_intensity = 0.5;
  Object.assign(input.character, {
    brightness: 2,
    contrast: 0.5,
    saturation: 0,
    sepia: 0.4,
    glow_radius: 4,
  });
  Object.assign(input.main_light, { enabled: true, opacity: 0.8 });
  const before = structuredClone(input);
  expect(compileLighting(input, "character").filter).toBe(
    "brightness(1.5) contrast(0.75) saturate(0.5) drop-shadow(0 0 4px rgba(255, 170, 51, 0.5)) sepia(0.2)"
  );
  expect(compileLighting(input, "both").mainLight?.opacity).toBe(0.4);
  input.master_intensity = 2;
  expect(compileLighting(input, "both").mainLight?.opacity).toBe(1);
  input.master_intensity = 0.5;
  expect(input).toEqual(before);
});

it("builds directional rim shadows from transparent image edges", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  Object.assign(input.rim_light, {
    enabled: true,
    intensity: 0.5,
    width: 2,
    softness: 3,
    offset: 4,
    angle: 90,
  });
  expect(compileLighting(input, "character").filter).toBe(
    "drop-shadow(4px 0px 3px rgba(255, 255, 255, 0.5)) drop-shadow(6px 0px 3px rgba(255, 255, 255, 0.5))"
  );
  input.rim_light.angle = 180;
  expect(compileLighting(input, "character").filter).toContain("drop-shadow(0px 4px 3px");
  expect(compileLighting(input, "background").filter).toBe("none");
  expect(compileLighting(input, "both").filter).toBe("none");
});

it("emits per-surface ambient only with positive multiplied opacity", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.master_intensity = 0.5;
  Object.assign(input.character_ambient, { enabled: true, color: "#aabbcc", opacity: 0.8 });
  expect(compileLighting(input, "character").ambient).toEqual({
    background: "#aabbcc",
    mixBlendMode: "multiply",
    opacity: 0.4,
  });
  expect(compileLighting(input, "background").ambient).toBeNull();
  expect(compileLighting(input, "both").ambient).toBeNull();
  input.character_ambient.opacity = 0;
  expect(compileLighting(input, "character").ambient).toBeNull();
});

it("routes bloom to static alpha edges or a single background/overall layer and omits zero", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.master_intensity = 0.5;
  Object.assign(input.bloom, { enabled: true, color: "#abc", radius: 12, intensity: 0.8 });
  for (const target of ["character", "background", "both"] as const) {
    input.bloom.target = target;
    for (const surface of ["character", "background", "both"] as const) {
      const result = compileLighting(input, surface);
      if (surface === "character") {
        expect(result.filter).toBe(
          target === surface ? "drop-shadow(0 0 12px rgba(170, 187, 204, 0.4))" : "none"
        );
        expect(result.bloom).toBeNull();
      } else
        expect(result.bloom).toEqual(
          target === surface
            ? {
                background: "radial-gradient(circle, #abc 0%, transparent 100%)",
                filter: "blur(12px)",
                mixBlendMode: "screen",
                opacity: 0.4,
              }
            : null
        );
    }
  }
  input.bloom.intensity = 0;
  expect(compileLighting(input, "both").bloom).toBeNull();
});

it("emits vignette only in overall slot with normalized radius and softness", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.master_intensity = 0.5;
  Object.assign(input.vignette, { enabled: true, intensity: 0.8, radius: 0.6, softness: 0.2 });
  expect(compileLighting(input, "both").vignette).toEqual({
    background: "radial-gradient(ellipse at center, transparent 60%, #000000 80%)",
    opacity: 0.4,
  });
  expect(compileLighting(input, "character").vignette).toBeNull();
  expect(compileLighting(input, "background").vignette).toBeNull();
  input.vignette.intensity = 0;
  expect(compileLighting(input, "both").vignette).toBeNull();
});

it("compiles asset fit and fixed-slot metadata without deriving URLs or changing order", () => {
  const input = createNeutralLighting();
  input.enabled = true;
  input.master_intensity = 0.5;
  input.asset_layers = ["cover", "contain", "stretch"].map((fit, index) => ({
    id: `a${index}`,
    asset_hash: "opaque-hash",
    media_type: "image/png",
    target: "both",
    placement: "behind",
    z_index: 2 - index,
    opacity: 0.8,
    blend_mode: "normal",
    fit,
    required: false,
  })) as typeof input.asset_layers;
  const before = structuredClone(input);
  const assets = compileLighting(input, "both").assets;
  expect(assets.map((a) => a.style.objectFit)).toEqual(["cover", "contain", "fill"]);
  expect(assets.map((a) => a.layer.fit)).toEqual(["cover", "contain", "stretch"]);
  expect(assets.map((a) => a.layer.id)).toEqual(["a0", "a1", "a2"]);
  expect(assets[0].style).toEqual({
    objectFit: "cover",
    opacity: 0.4,
    mixBlendMode: "normal",
    zIndex: 2,
  });
  expect(compileLighting(input, "character").assets).toEqual([]);
  expect(compileLighting(input, "background").assets).toEqual([]);
  expect(input).toEqual(before);
  input.asset_layers[0].opacity = 0;
  expect(compileLighting(input, "both").assets).toHaveLength(2);
});

it("returns explicitly neutral CSS for disabled, zero-master and invalid surfaces", () => {
  const input = createNeutralLighting();
  input.character.brightness = 2;
  input.character.glow_radius = 5;
  Object.assign(input.main_light, { enabled: true, opacity: 1, blend_mode: "add" });
  Object.assign(input.rim_light, { enabled: true, intensity: 1 });
  Object.assign(input.character_ambient, { enabled: true, opacity: 1 });
  Object.assign(input.bloom, { enabled: true, intensity: 1 });
  Object.assign(input.vignette, { enabled: true, intensity: 1 });
  const neutral = {
    filter: "none",
    mainLight: null,
    ambient: null,
    bloom: null,
    vignette: null,
    assets: [],
    warnings: [],
  };
  for (const surface of ["character", "background", "both"] as const)
    expect(compileLighting(input, surface, { supportsPlusLighter: false })).toEqual(neutral);
  input.enabled = true;
  input.master_intensity = 0;
  for (const surface of ["character", "background", "both"] as const)
    expect(compileLighting(input, surface)).toEqual(neutral);
  input.master_intensity = 1;
  expect(compileLighting(input, "bad" as "character")).toEqual(neutral);
  expect(compileLighting(null, "both")).toEqual(neutral);
});
