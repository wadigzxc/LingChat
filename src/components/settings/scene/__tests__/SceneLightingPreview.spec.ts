import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import SceneLightingPreview from "../SceneLightingPreview.vue";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { StaticCharacterLightingFrame, LightingOverlay } from "@/components/game/lighting";
const assetApi = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/api/services/scene-lighting", () => ({ resolveLightingAsset: assetApi.resolve }));
const global = () => ({
  plugins: [createI18n({ legacy: false, locale: "zh", messages: { zh: {} } })],
});
const filter = (element: Element) =>
  (element as HTMLElement).style.filter ||
  (element as HTMLElement).style.getPropertyValue("-webkit-filter");
describe("shared draft preview", () => {
  it("uses lighting fallback translations for preview controls and artwork descriptions", () => {
    const language = createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: {
          settings: {
            lighting: {
              holdOriginal: "Hold original",
              previewBackground: "Scene background",
              previewAvatar: "Static character",
              dragPosition: "Drag light position",
              dragAngle: "Drag light angle",
            },
          },
        },
      },
    });
    const l = createNeutralLighting();
    l.main_light.shape = "linear";
    const w = mount(SceneLightingPreview, {
      props: { lighting: l },
      global: { plugins: [language] },
    });
    expect(w.get("[data-view-original]").text()).toBe("Hold original");
    expect(w.get("[data-preview-background]").attributes("alt")).toBe("Scene background");
    expect(w.get("[data-preview-avatar]").attributes("alt")).toBe("Static character");
    expect(w.get("[data-drag-light-position]").attributes("aria-label")).toBe(
      "Drag light position"
    );
    expect(w.get("[data-drag-light-angle]").attributes("aria-label")).toBe("Drag light angle");
  });
  it("supports holding original with the keyboard and restores on button blur", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.character.brightness = 1.4;
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    const button = w.get("[data-view-original]");
    await button.trigger("keydown", { key: " " });
    expect(filter(w.get("[data-lighting-visual]").element)).toBe("none");
    await button.trigger("blur");
    expect(filter(w.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
  });

  it("reports add-blend fallback once while continuing to use the shared compiler", async () => {
    vi.stubGlobal("CSS", { supports: () => false });
    const l = createNeutralLighting();
    l.enabled = true;
    l.main_light = { ...l.main_light, enabled: true, opacity: 0.5, blend_mode: "add" };
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    expect(w.get('[data-lighting-effect="main"]').attributes("style")).toContain(
      "mix-blend-mode: screen"
    );
    expect(w.emitted("warning")?.[0]?.[0]).toContain("screen");
    await w.setProps({ lighting: { ...l, master_intensity: 0.5 } });
    expect(w.emitted("warning")).toHaveLength(1);
  });
  it("deduplicates in-flight resolution and never restores stale artwork after scene draft removal", async () => {
    assetApi.resolve.mockClear();
    let complete!: (value: unknown) => void;
    assetApi.resolve.mockImplementation(
      () =>
        new Promise((r) => {
          complete = r;
        })
    );
    const l = createNeutralLighting();
    l.enabled = true;
    const hash = "d".repeat(64);
    l.asset_layers = [
      {
        id: "one",
        asset_hash: hash,
        media_type: "image/png",
        target: "both",
        placement: "front",
        z_index: 0,
        opacity: 1,
        blend_mode: "normal",
        fit: "cover",
        required: false,
      },
    ];
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    await w.setProps({ lighting: { ...l, master_intensity: 0.4 } });
    expect(assetApi.resolve).toHaveBeenCalledTimes(1);
    await w.setProps({ lighting: { ...l, asset_layers: [] } });
    complete({ hash, supported: true, asset_protocol_path: "C:/stale.png", warning: null });
    await flushPromises();
    expect(w.find('img[src*="stale"]').exists()).toBe(false);
  });
  it("caches resolved assets within the draft scope and clears removed artwork without refetching on color edits", async () => {
    assetApi.resolve.mockClear();
    const l = createNeutralLighting();
    l.enabled = true;
    const hash = "c".repeat(64);
    l.asset_layers = [
      {
        id: "one",
        asset_hash: hash,
        media_type: "image/png",
        target: "both",
        placement: "front",
        z_index: 0,
        opacity: 1,
        blend_mode: "normal",
        fit: "cover",
        required: false,
      },
    ];
    assetApi.resolve.mockResolvedValue({
      hash,
      supported: true,
      asset_protocol_path: "C:/one.png",
      warning: null,
    });
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    await flushPromises();
    await w.setProps({ lighting: { ...l, master_intensity: 0.5 } });
    await flushPromises();
    expect(assetApi.resolve).toHaveBeenCalledTimes(1);
    await w.setProps({ lighting: { ...l, asset_layers: [] } });
    await flushPromises();
    expect(w.find("[data-lighting-assets]").exists()).toBe(false);
    await w.setProps({ lighting: l });
    await flushPromises();
    expect(assetApi.resolve).toHaveBeenCalledTimes(1);
  });
  it("warns on missing or invalid assets without blocking parameter lighting", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.background.brightness = 0.8;
    l.asset_layers = [
      {
        id: "missing",
        asset_hash: "b".repeat(64),
        media_type: "image/png",
        target: "background",
        placement: "front",
        z_index: 0,
        opacity: 1,
        blend_mode: "normal",
        fit: "cover",
        required: true,
      },
    ];
    assetApi.resolve.mockRejectedValue(new Error("missing PNG"));
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    await flushPromises();
    expect(w.get("[data-preview-warnings]").text()).toContain("missing PNG");
    expect(filter(w.get("[data-preview-background]").element)).toBe("brightness(0.8)");
    expect(w.find("[data-lighting-assets]").exists()).toBe(false);
    await w.setProps({
      lighting: { ...l, asset_layers: [{ ...l.asset_layers[0]!, asset_hash: "../../escape" }] },
    });
    await flushPromises();
    expect(w.get("[data-preview-warnings]").text()).toContain("SHA-256");
  });
  it("resolves existing hashes through the asset API and renders PNG only in its shared target slot", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    const hash = "a".repeat(64);
    l.asset_layers = [
      {
        id: "texture",
        asset_hash: hash,
        media_type: "image/png",
        target: "background",
        placement: "behind",
        z_index: 3,
        opacity: 0.8,
        blend_mode: "normal",
        fit: "contain",
        required: false,
      },
    ];
    assetApi.resolve.mockResolvedValue({
      hash,
      supported: true,
      asset_protocol_path: "C:/lighting_assets/texture.png",
      warning: null,
    });
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    await flushPromises();
    expect(assetApi.resolve).toHaveBeenCalledWith(hash);
    const stack = w.get('[data-lighting-assets="behind"]');
    expect(stack.get("img").attributes("src")).toContain(
      encodeURIComponent("C:/lighting_assets/texture.png")
    );
    expect(w.findAll("[data-lighting-assets]")).toHaveLength(1);
    expect(stack.get("img").attributes("style")).toContain("object-fit: contain");
  });
  it("recognizes an already cached real fallback image without waiting for a missed load event", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(400);
    const w = mount(SceneLightingPreview, {
      props: { lighting: createNeutralLighting(), live2d: true, avatarUrl: "cached-role.png" },
      global: global(),
    });
    await w.vm.$nextTick();
    expect(w.findComponent(StaticCharacterLightingFrame).props("fallbackVisible")).toBe(true);
    expect(w.get("[data-preview-avatar]").attributes("src")).toBe("cached-role.png");
  });
  it("uses a visible static fallback for Live2D preview and never mounts a Live2D canvas", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.character.brightness = 1.4;
    const w = mount(SceneLightingPreview, {
      props: { lighting: l, live2d: true, avatarUrl: "static-fallback.png" },
      global: global(),
    });
    const frame = w.findComponent(StaticCharacterLightingFrame);
    expect(frame.props("live2d")).toBe(true);
    expect(frame.props("live2dReady")).toBe(false);
    expect(frame.props("fallbackVisible")).toBe(false);
    await w.get("[data-preview-avatar]").trigger("load");
    expect(frame.props("fallbackVisible")).toBe(true);
    expect(filter(w.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
    await w.setProps({ avatarUrl: null });
    expect(frame.props("fallbackVisible")).toBe(false);
    expect(w.find("canvas").exists()).toBe(false);
  });
  it("drags linear light direction and stops editing on pointer cancellation", async () => {
    const l = createNeutralLighting();
    l.main_light.shape = "linear";
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    w.get("[data-preview-stage]").element.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await w.get("[data-drag-light-angle]").trigger("pointerdown", { pointerId: 4 });
    const move = new MouseEvent("pointermove", { clientX: 200, clientY: 50 });
    Object.defineProperty(move, "pointerId", { value: 4 });
    window.dispatchEvent(move);
    await w.vm.$nextTick();
    expect(w.emitted("update:lighting")?.slice(-1)[0]?.[0]).toMatchObject({
      main_light: { angle: 90, x: 0.5, y: 0.5 },
    });
    const count = w.emitted("update:lighting")!.length;
    window.dispatchEvent(new Event("pointercancel"));
    window.dispatchEvent(move);
    await w.vm.$nextTick();
    expect(w.emitted("update:lighting")).toHaveLength(count);
  });

  it("moves the radial main-light position with a real pointer drag in stage coordinates", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.main_light.enabled = true;
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    const stage = w.get("[data-preview-stage]").element;
    stage.getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      width: 200,
      height: 100,
      right: 210,
      bottom: 120,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    await w.get("[data-drag-light-position]").trigger("pointerdown", { pointerId: 3 });
    const move = new MouseEvent("pointermove", { clientX: 60, clientY: 100 });
    Object.defineProperty(move, "pointerId", { value: 3 });
    window.dispatchEvent(move);
    await w.vm.$nextTick();
    expect(w.emitted("update:lighting")?.slice(-1)[0]?.[0]).toMatchObject({
      main_light: { x: 0.25, y: 0.8 },
    });
    expect(l.main_light.x).toBe(0.5);
  });
  it("restores held-original effects after pointercancel and window blur or release outside", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.character.brightness = 1.4;
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    for (const event of ["pointercancel", "blur", "pointerup"]) {
      await w.get("[data-view-original]").trigger("pointerdown", { pointerId: 1 });
      window.dispatchEvent(new Event(event));
      await w.vm.$nextTick();
      expect(filter(w.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
    }
  });
  it("holding original temporarily bypasses only preview effects and restores on release", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.character.brightness = 1.4;
    const before = JSON.stringify(l);
    const w = mount(SceneLightingPreview, { props: { lighting: l }, global: global() });
    await w.get("[data-view-original]").trigger("pointerdown", { pointerId: 1 });
    expect(filter(w.get("[data-lighting-visual]").element)).toBe("none");
    expect(JSON.stringify(l)).toBe(before);
    await w.get("[data-view-original]").trigger("pointerup", { pointerId: 1 });
    expect(filter(w.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
  });
  it("shows built-in test images on missing or failed resources and clears old cached image nodes", async () => {
    const w = mount(SceneLightingPreview, {
      props: {
        lighting: createNeutralLighting(),
        backgroundUrl: "cached-room.png",
        avatarUrl: "cached-role.png",
      },
      global: global(),
    });
    const old = w.get("[data-preview-avatar]").element;
    Object.defineProperty(old, "complete", { configurable: true, value: true });
    Object.defineProperty(old, "naturalWidth", { configurable: true, value: 400 });
    await w.get("[data-preview-avatar]").trigger("load");
    await w.setProps({ avatarUrl: null, backgroundUrl: null });
    expect(w.get("[data-preview-avatar]").attributes("src")).toContain("alona.png");
    expect(w.get("[data-preview-background]").attributes("src")).toContain("default_bg.jpg");
    expect(w.get("[data-preview-avatar]").element).not.toBe(old);
    expect(w.find('img[src="cached-role.png"]').exists()).toBe(false);
    await w.setProps({ avatarUrl: "missing-role.png" });
    await w.get("[data-preview-avatar]").trigger("error");
    expect(w.get("[data-preview-avatar]").attributes("src")).toContain("alona.png");
  });
  it("renders the selected background and static role using the shared layers exactly once for both", () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.character.brightness = 1.4;
    l.background.brightness = 0.8;
    l.main_light = { ...l.main_light, enabled: true, opacity: 0.5, target: "both" };
    const w = mount(SceneLightingPreview, {
      props: { lighting: l, backgroundUrl: "room.png", avatarUrl: "role.png" },
      global: global(),
    });
    expect(w.get("[data-preview-background]").attributes("src")).toBe("room.png");
    expect(w.get("[data-preview-avatar]").attributes("src")).toBe("role.png");
    expect(filter(w.get("[data-preview-background]").element)).toBe("brightness(0.8)");
    expect(filter(w.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
    expect(w.findComponent(StaticCharacterLightingFrame).exists()).toBe(true);
    expect(w.findAllComponents(LightingOverlay)).toHaveLength(3);
    expect(w.findAll('[data-lighting-effect="main"]')).toHaveLength(1);
  });
});
