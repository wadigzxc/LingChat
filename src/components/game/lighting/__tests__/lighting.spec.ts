import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { tauriMocks } from "@/test/setup";
import {
  LightingOverlay,
  LightingAssetStack,
  StaticCharacterLightingFrame,
  FinalLightingOverlay,
} from "../index";
import type { LightingAssetLayer, AssetPlacement, LightingTarget } from "@/types/scene-lighting";

function asset(
  id: string,
  placement: AssetPlacement,
  z_index: number,
  target: LightingTarget = "character"
): LightingAssetLayer {
  return {
    id,
    placement,
    z_index,
    target,
    asset_hash: id,
    media_type: "image/png",
    opacity: 0.8,
    blend_mode: "normal",
    fit: "contain",
    required: true,
  };
}
const resolveAsset = (layer: LightingAssetLayer) => `/verified/${layer.id}.png`;
// Vue may auto-prefix filter in jsdom; assert the applied DOM declaration either way.
const filterOf = (element: HTMLElement) =>
  element.style.getPropertyValue("filter") || element.style.getPropertyValue("-webkit-filter");

function lighting() {
  const value = createNeutralLighting();
  value.enabled = true;
  value.main_light = { ...value.main_light, enabled: true, opacity: 0.6, target: "character" };
  return value;
}

describe("shared lighting DOM", () => {
  it("visual slot fills host-supplied frame bounds for absolute portrait presentations", () => {
    const wrapper = mount(StaticCharacterLightingFrame, {
      props: { lighting: lighting() },
      attrs: { style: { width: "320px", height: "640px" } },
      slots: { default: '<img data-portrait style="position: absolute; inset: 0" />' },
    });
    const visual = wrapper.get("[data-lighting-visual]").element as HTMLElement;
    expect(visual.style.width).toBe("100%");
    expect(visual.style.height).toBe("100%");
    expect(visual.style.position).toBe("relative");
    expect((wrapper.element as HTMLElement).style.height).toBe("640px");
  });
  it.each(["character", "background", "both"] as const)(
    "PNG %s surface is exact rather than a both wildcard (compiler regression)",
    (surface) => {
      const value = lighting();
      value.asset_layers = [
        asset("character", "front", 0),
        asset("background", "front", 0, "background"),
        asset("both", "front", 0, "both"),
      ];
      const wrapper = mount(LightingAssetStack, {
        props: { lighting: value, surface, placement: "front", resolveAsset },
      });
      expect(wrapper.findAll("img").map((img) => img.attributes("src"))).toEqual([
        `/verified/${surface}.png`,
      ]);
    }
  );
  it("disabled and zero-master props remove all lighting without changing the visual slot (compiler regression)", async () => {
    const value = lighting();
    value.character.brightness = 1.2;
    value.vignette.enabled = true;
    value.vignette.intensity = 0.5;
    value.asset_layers = [asset("character", "front", 0), asset("overall", "front", 0, "both")];
    value.enabled = false;
    const frame = mount(StaticCharacterLightingFrame, {
      props: { lighting: value, resolveAsset },
      slots: { default: "<img data-portrait />" },
    });
    const final = mount(FinalLightingOverlay, { props: { lighting: value, resolveAsset } });
    for (const wrapper of [frame, final])
      expect(wrapper.find("[data-lighting-effect], [data-lighting-assets]").exists()).toBe(false);
    expect(filterOf(frame.get("[data-lighting-visual]").element as HTMLElement)).toBe("none");
    expect(frame.find("[data-portrait]").exists()).toBe(true);
    value.enabled = true;
    value.master_intensity = 0;
    await frame.setProps({ lighting: { ...value } });
    await final.setProps({ lighting: { ...value } });
    for (const wrapper of [frame, final])
      expect(wrapper.find("[data-lighting-effect], [data-lighting-assets]").exists()).toBe(false);
    expect(filterOf(frame.get("[data-lighting-visual]").element as HTMLElement)).toBe("none");
  });
  it("forwards add capability options without IO, storage writes or prop mutation (compiler regression)", async () => {
    const value = lighting();
    value.main_light.blend_mode = "add";
    value.asset_layers = [{ ...asset("front", "front", 0), blend_mode: "add" }];
    const before = JSON.stringify(value);
    const wrapper = mount(StaticCharacterLightingFrame, {
      props: { lighting: value, resolveAsset, options: { supportsPlusLighter: false } },
    });
    expect(wrapper.get('[data-lighting-effect="main"]').attributes("style")).toContain(
      "mix-blend-mode: screen"
    );
    expect(wrapper.get("img").attributes("style")).toContain("mix-blend-mode: screen");
    await wrapper.setProps({ options: { supportsPlusLighter: true } });
    expect(wrapper.get('[data-lighting-effect="main"]').attributes("style")).toContain(
      "mix-blend-mode: plus-lighter"
    );
    expect(JSON.stringify(value)).toBe(before);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(tauriMocks.listen).not.toHaveBeenCalled();
    expect(tauriMocks.emit).not.toHaveBeenCalled();
    expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
  });
  it("simplified final keeps vignette but removes overall PNGs", async () => {
    const value = lighting();
    value.vignette.enabled = true;
    value.vignette.intensity = 0.5;
    value.asset_layers = [asset("front", "front", 0, "both")];
    const wrapper = mount(FinalLightingOverlay, {
      props: { lighting: value, simplified: true, resolveAsset },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(true);
    await wrapper.setProps({ simplified: false });
    expect(wrapper.find("img").exists()).toBe(true);
  });
  it("simplified frame removes edge bloom and PNGs without mutating input or losing rim", async () => {
    const value = lighting();
    value.character.brightness = 1.2;
    value.rim_light = {
      enabled: true,
      color: "#ff0000",
      intensity: 1,
      width: 3,
      softness: 2,
      angle: 90,
      offset: 4,
    };
    value.bloom = { enabled: true, target: "character", color: "#ffffff", radius: 8, intensity: 1 };
    value.asset_layers = [asset("front", "front", 0)];
    const before = JSON.stringify(value);
    const wrapper = mount(StaticCharacterLightingFrame, {
      props: { lighting: value, simplified: true, resolveAsset },
    });
    expect(filterOf(wrapper.get("[data-lighting-visual]").element as HTMLElement)).toBe(
      "brightness(1.2) drop-shadow(4px 0px 2px #ff0000) drop-shadow(7px 0px 2px #ff0000)"
    );
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
    expect(JSON.stringify(value)).toBe(before);
    await wrapper.setProps({ simplified: false });
    expect(filterOf(wrapper.get("[data-lighting-visual]").element as HTMLElement)).toContain(
      "drop-shadow(0 0 8px #ffffff)"
    );
    expect(wrapper.find("img").exists()).toBe(true);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("simplified asset stack skips PNGs and does not invoke resource resolution", async () => {
    const value = lighting();
    value.asset_layers = [asset("front", "front", 0)];
    const resolver = vi.fn(resolveAsset);
    const wrapper = mount(LightingAssetStack, {
      props: {
        lighting: value,
        surface: "character",
        placement: "front",
        simplified: true,
        resolveAsset: resolver,
      },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
    await wrapper.setProps({ simplified: false });
    expect(wrapper.get("img").attributes("src")).toBe("/verified/front.png");
  });
  it("simplified overlay suppresses bloom but preserves ambient and main", async () => {
    const value = lighting();
    value.main_light.target = "background";
    value.background_ambient = { enabled: true, color: "#ffffff", opacity: 0.3 };
    value.bloom = {
      enabled: true,
      target: "background",
      color: "#ffffff",
      radius: 8,
      intensity: 1,
    };
    const wrapper = mount(LightingOverlay, {
      props: { lighting: value, surface: "background", simplified: true },
    });
    expect(wrapper.find('[data-lighting-effect="bloom"]').exists()).toBe(false);
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
    expect(wrapper.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
    await wrapper.setProps({ simplified: false });
    expect(wrapper.find('[data-lighting-effect="bloom"]').exists()).toBe(true);
  });
  it("final behind can be mounted below stage without front PNGs or repeated vignette", async () => {
    const value = lighting();
    value.vignette.enabled = true;
    value.vignette.intensity = 0.5;
    value.asset_layers = [
      asset("overall-front", "front", 0, "both"),
      asset("overall-behind", "behind", 7, "both"),
    ];
    const wrapper = mount(FinalLightingOverlay, {
      props: { lighting: value, placement: "behind", resolveAsset },
    });
    expect(wrapper.findAll("img").map((img) => img.attributes("src"))).toEqual([
      "/verified/overall-behind.png",
    ]);
    expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(false);
    await wrapper.setProps({ placement: "front", showVignette: false });
    expect(wrapper.findAll("img").map((img) => img.attributes("src"))).toEqual([
      "/verified/overall-front.png",
    ]);
    expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(false);
  });
  it("final front renders only overall PNG and vignette, never repeats procedural light", () => {
    const value = lighting();
    value.main_light.target = "both";
    value.bloom = { enabled: true, target: "both", color: "#ffffff", radius: 8, intensity: 1 };
    value.vignette = {
      enabled: true,
      color: "#000000",
      intensity: 0.7,
      radius: 0.6,
      softness: 0.2,
    };
    value.asset_layers = [
      asset("overall-front", "front", 7, "both"),
      asset("overall-behind", "behind", 0, "both"),
      asset("character", "front", 0),
      asset("background", "front", 0, "background"),
    ];
    const wrapper = mount(FinalLightingOverlay, { props: { lighting: value, resolveAsset } });
    expect(wrapper.findAll("img").map((img) => img.attributes("src"))).toEqual([
      "/verified/overall-front.png",
    ]);
    const vignette = wrapper.get('[data-lighting-effect="vignette"]').element as HTMLElement;
    expect(vignette.style.opacity).toBe("0.7");
    expect(vignette.style.zIndex).toBe("3");
    expect(vignette.style.pointerEvents).toBe("none");
    expect(wrapper.findAll("[data-lighting-effect]")).toHaveLength(1);
    expect((wrapper.element as HTMLElement).style.pointerEvents).toBe("none");
  });
  it("lights only an actually visible unready Live2D fallback through readiness transitions", async () => {
    const value = lighting();
    value.character.brightness = 1.4;
    value.asset_layers = [asset("fallback", "front", 0)];
    const wrapper = mount(StaticCharacterLightingFrame, {
      props: {
        lighting: value,
        live2d: true,
        live2dReady: false,
        fallbackVisible: true,
        resolveAsset,
      },
      slots: { default: "<img data-fallback />" },
    });
    expect(filterOf(wrapper.get("[data-lighting-visual]").element as HTMLElement)).toBe(
      "brightness(1.4)"
    );
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
    expect(wrapper.find('img[src="/verified/fallback.png"]').exists()).toBe(true);
    await wrapper.setProps({ fallbackVisible: false });
    expect(filterOf(wrapper.get("[data-lighting-visual]").element as HTMLElement)).toBe("none");
    expect(wrapper.find("[data-lighting-effect]").exists()).toBe(false);
    expect(wrapper.find("[data-lighting-assets]").exists()).toBe(false);
    await wrapper.setProps({ fallbackVisible: true, live2dReady: true });
    expect(filterOf(wrapper.get("[data-lighting-visual]").element as HTMLElement)).toBe("none");
    expect(wrapper.find("[data-lighting-effect]").exists()).toBe(false);
    await wrapper.setProps({ live2dReady: false });
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
  });
  it("does not light a ready Live2D model even when fallback-visible is stale", () => {
    const value = lighting();
    value.character.brightness = 1.4;
    value.asset_layers = [asset("character", "front", 0)];
    const wrapper = mount(StaticCharacterLightingFrame, {
      props: {
        lighting: value,
        live2d: true,
        live2dReady: true,
        fallbackVisible: true,
        resolveAsset,
      },
      slots: { default: "<canvas data-model />" },
    });
    expect(filterOf(wrapper.get("[data-lighting-visual]").element as HTMLElement)).toBe("none");
    expect(wrapper.find("[data-lighting-effect]").exists()).toBe(false);
    expect(wrapper.find("[data-lighting-assets]").exists()).toBe(false);
    expect(wrapper.find("[data-model]").exists()).toBe(true);
  });
  it("composes character behind, visual, effects and front in fixed local slots", () => {
    const value = lighting();
    value.character_ambient = { enabled: true, color: "#123456", opacity: 0.4 };
    value.asset_layers = [
      asset("behind", "behind", 7),
      asset("front", "front", 0),
      asset("overall", "front", 0, "both"),
    ];
    const wrapper = mount(StaticCharacterLightingFrame, {
      props: { lighting: value, resolveAsset },
      slots: { default: "<img data-portrait />" },
    });
    expect(
      Array.from((wrapper.element as HTMLElement).children).map(
        (el) =>
          el.getAttribute("data-lighting-assets") ||
          (el.hasAttribute("data-lighting-visual") ? "visual" : "effects")
      )
    ).toEqual(["behind", "visual", "effects", "front"]);
    expect(wrapper.findAll("img[src]").map((img) => img.attributes("src"))).toEqual([
      "/verified/behind.png",
      "/verified/front.png",
    ]);
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
    expect(wrapper.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
    expect(wrapper.get("[data-lighting-visual]").find("[data-lighting-effect]").exists()).toBe(
      false
    );
    const effects = wrapper.get("[data-lighting-character-effects]").element as HTMLElement;
    expect(effects.style.zIndex).toBe("1");
    expect(effects.style.pointerEvents).toBe("none");
  });
  it("filters only static visual slot with compiler color, rim and edge bloom", () => {
    const value = lighting();
    value.character.brightness = 1.3;
    value.rim_light = {
      enabled: true,
      color: "#ff0000",
      intensity: 1,
      width: 3,
      softness: 2,
      angle: 90,
      offset: 4,
    };
    value.bloom = { enabled: true, target: "character", color: "#ffffff", radius: 8, intensity: 1 };
    const wrapper = mount(StaticCharacterLightingFrame, {
      props: { lighting: value },
      slots: {
        default: '<img data-portrait src="/portrait.png" />',
        accessories: "<div data-bubble>Bubble</div><div data-effects>Effects</div>",
      },
    });
    const visual = wrapper.get("[data-lighting-visual]").element as HTMLElement;
    expect(filterOf(visual)).toBe(
      "brightness(1.3) drop-shadow(4px 0px 2px #ff0000) drop-shadow(7px 0px 2px #ff0000) drop-shadow(0 0 8px #ffffff)"
    );
    expect(visual.querySelector("[data-portrait]")).not.toBeNull();
    expect(visual.querySelector("[data-bubble]")).toBeNull();
    expect(visual.querySelector("[data-effects]")).toBeNull();
    expect((wrapper.element as HTMLElement).style.filter).toBe("");
    expect(wrapper.find('[data-lighting-effect="bloom"]').exists()).toBe(false);
  });
  it("omits unresolved resources instead of guessing URLs or rendering empty images", () => {
    const value = lighting();
    value.asset_layers = [asset("missing", "front", 0)];
    const wrapper = mount(LightingAssetStack, {
      props: {
        lighting: value,
        surface: "character",
        placement: "front",
        resolveAsset: () => null,
      },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("[data-lighting-assets]").exists()).toBe(false);
  });
  it("sorts PNGs stably within a selected isolated placement, never across slots", async () => {
    const value = lighting();
    value.asset_layers = [
      asset("front-high", "front", 7),
      asset("behind-high", "behind", 7),
      asset("behind-first", "behind", 1),
      asset("behind-second", "behind", 1),
      asset("other-target", "behind", 0, "both"),
    ];
    const wrapper = mount(LightingAssetStack, {
      props: { lighting: value, surface: "character", placement: "behind", resolveAsset },
    });
    expect(wrapper.findAll("img").map((img) => img.attributes("src"))).toEqual([
      "/verified/behind-first.png",
      "/verified/behind-second.png",
      "/verified/behind-high.png",
    ]);
    const stack = wrapper.get('[data-lighting-assets="behind"]').element as HTMLElement;
    expect(stack.style.isolation).toBe("isolate");
    expect(stack.style.zIndex).toBe("0");
    expect(stack.style.pointerEvents).toBe("none");
    expect((wrapper.findAll("img")[2].element as HTMLElement).style.zIndex).toBe("7");
    await wrapper.setProps({ placement: "front" });
    expect(wrapper.findAll("img").map((img) => img.attributes("src"))).toEqual([
      "/verified/front-high.png",
    ]);
    expect(
      (wrapper.get('[data-lighting-assets="front"]').element as HTMLElement).style.zIndex
    ).toBe("2");
  });
  it("renders local ambient and bloom as inert absolute layers without a vignette", () => {
    const value = lighting();
    value.background_ambient = { enabled: true, color: "#123456", opacity: 0.4 };
    value.bloom = {
      enabled: true,
      target: "background",
      color: "#ffffff",
      radius: 12,
      intensity: 0.5,
    };
    value.vignette.enabled = true;
    value.vignette.intensity = 0.8;
    const wrapper = mount(LightingOverlay, { props: { lighting: value, surface: "background" } });
    const ambient = wrapper.get('[data-lighting-effect="ambient"]').element as HTMLElement;
    expect(ambient.style.background).toBe("rgb(18, 52, 86)");
    expect(wrapper.get('[data-lighting-effect="bloom"]').attributes("style")).toContain(
      "blur(12px)"
    );
    for (const layer of wrapper.findAll("[data-lighting-effect]")) {
      const element = layer.element as HTMLElement;
      expect(element.style.pointerEvents).toBe("none");
      expect(element.style.position).toBe("absolute");
      expect(layer.attributes("aria-hidden")).toBe("true");
    }
    expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(false);
  });
  it("renders main light only in its exact target surface, including single overall", async () => {
    const value = lighting();
    const wrapper = mount(LightingOverlay, { props: { lighting: value, surface: "character" } });
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
    await wrapper.setProps({ surface: "background" });
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(false);
    await wrapper.setProps({ surface: "both" });
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(false);
    value.main_light.target = "both";
    await wrapper.setProps({ lighting: { ...value } });
    expect(wrapper.findAll('[data-lighting-effect="main"]')).toHaveLength(1);
    await wrapper.setProps({ surface: "character" });
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(false);
  });
});
