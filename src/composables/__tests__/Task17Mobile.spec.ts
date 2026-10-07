import { beforeEach, afterEach, expect, it, vi, type Mock } from "vitest";
import { defineComponent, h, reactive, nextTick, type Ref } from "vue";
import type { AppLocale } from "@/locales";
import { mount, flushPromises } from "@vue/test-utils";
import { tauriMocks, resetTauriMocks } from "@/test/setup";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
const stores = vi.hoisted(() => ({ game: null as any, settings: null as any, ui: null as any }));
vi.mock("@/stores/modules/game", () => ({ useGameStore: () => stores.game }));
vi.mock("@/stores/modules/settings", () => ({ useSettingsStore: () => stores.settings }));
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => stores.ui }));
const platforms = [
  {
    name: "Android",
    userAgent: "Mozilla/5.0 (Linux; Android 14)",
    platform: "Linux",
    maxTouchPoints: 5,
  },
  {
    name: "iPhone",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
    platform: "iPhone",
    maxTouchPoints: 5,
  },
  {
    name: "iPadOS desktop UA",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    platform: "MacIntel",
    maxTouchPoints: 5,
  },
];
function snapshot() {
  const lighting = createNeutralLighting();
  lighting.enabled = true;
  lighting.background.brightness = 0.8;
  lighting.background_ambient = { enabled: true, color: "#112233", opacity: 0.3 };
  lighting.character_ambient = { enabled: true, color: "#445566", opacity: 0.4 };
  lighting.main_light.enabled = true;
  lighting.main_light.opacity = 0.4;
  lighting.main_light.target = "background";
  lighting.rim_light.enabled = true;
  lighting.rim_light.intensity = 0.5;
  lighting.rim_light.width = 4;
  lighting.vignette.enabled = true;
  lighting.vignette.intensity = 0.5;
  lighting.asset_layers = ["background", "character", "both"].map((target, index) => ({
    id: String(index),
    asset_hash: "a".repeat(64),
    media_type: "image/png",
    target: target as "both",
    placement: "front",
    z_index: 0,
    opacity: 1,
    blend_mode: "normal",
    fit: "cover",
    required: false,
  }));
  return lighting;
}
beforeEach(async () => {
  vi.resetModules();
  resetTauriMocks();
  stores.game = reactive({ activeLighting: snapshot(), lightingRevision: 12 });
  stores.settings = reactive({ display: { simplifiedLighting: false } });
  stores.ui = reactive({
    showNotification: vi.fn(),
    currentBackground: "data:image/png;base64,bg",
    currentBackgroundMusic: "None",
    ambientTracks: [],
    currentBackgroundEffect: "None",
  });
  const invoke = tauriMocks.invoke as unknown as Mock<(command: string) => Promise<unknown>>;
  invoke.mockImplementation(async (command) =>
    command === "get_locale_messages"
      ? "{}"
      : { hash: "a".repeat(64), supported: true, asset_protocol_path: "G:/lighting.png" }
  );
  const { i18n } = await import("@/locales");
  (i18n.global.locale as unknown as Ref<AppLocale>).value = "en";
  await flushPromises();
  tauriMocks.invoke.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
async function runtimeHost() {
  const { provideSceneLighting } = await import("../useSceneLighting");
  const { default: Background } = await import("@/components/game/standard/GameBackground.vue");
  const { StaticCharacterLightingFrame, FinalLightingOverlay } =
    await import("@/components/game/lighting");
  let context!: ReturnType<typeof provideSceneLighting>;
  const wrapper = mount(
    defineComponent({
      setup() {
        context = provideSceneLighting();
        return () =>
          h("div", [
            h(Background),
            h(
              StaticCharacterLightingFrame,
              {
                lighting: context.lighting.value,
                simplified: context.simplified.value,
                resolveAsset: context.resolveAsset,
              },
              { default: () => h("img", { "data-character": "", src: "character.png" }) }
            ),
            h(FinalLightingOverlay, {
              lighting: context.lighting.value,
              simplified: context.simplified.value,
              resolveAsset: context.resolveAsset,
            }),
          ]);
      },
    }),
    { global: { stubs: { AudioAcrossFade: true, AmbientLoopPlayer: true } } }
  );
  await flushPromises();
  return { wrapper, context };
}
it.each(
  platforms.flatMap((platform) => [false, true].map((simplified) => ({ ...platform, simplified })))
)(
  "$name simplified=$simplified skips scene assets before resolution and warns once without changing parameters",
  async (platform) => {
    vi.stubGlobal("navigator", platform);
    stores.settings.display.simplifiedLighting = platform.simplified;
    const before = JSON.stringify(stores.game.activeLighting);
    const { wrapper, context } = await runtimeHost();
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
    expect(wrapper.find("[data-lighting-assets] img").exists()).toBe(false);
    expect(context.lighting.value?.asset_layers).toEqual([]);
    expect(wrapper.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
    expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(true);
    expect(wrapper.get("[data-lighting-background-visual]").attributes("style")).toContain(
      "brightness(0.8)"
    );
    expect(wrapper.get("[data-lighting-visual]").attributes("style")).toContain("drop-shadow");
    expect(stores.ui.showNotification).toHaveBeenCalledTimes(1);
    expect(stores.ui.showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", title: "Lighting on mobile", duration: 3000 })
    );
    expect(JSON.stringify(stores.game.activeLighting)).toBe(before);
    stores.game.lightingRevision++;
    stores.game.activeLighting = JSON.parse(before);
    await nextTick();
    wrapper.unmount();
    const second = await runtimeHost();
    stores.settings.display.simplifiedLighting = !platform.simplified;
    await flushPromises();
    expect(stores.ui.showNotification).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(stores.game.lightingRevision).toBe(13);
    second.wrapper.unmount();
  }
);
const noticeTitles = {
  "zh-CN": "移动端光影",
  "zh-HK": "流動裝置光影",
  en: "Lighting on mobile",
  ja: "モバイルのライティング",
};
it.each(
  platforms.flatMap((platform) =>
    (Object.keys(noticeTitles) as (keyof typeof noticeTitles)[]).map((locale) => ({
      ...platform,
      locale,
    }))
  )
)(
  "$name $locale skips editor draft decoding and shares the once-only notice with runtime",
  async (platform) => {
    vi.stubGlobal("navigator", platform);
    const { i18n } = await import("@/locales");
    (i18n.global.locale as unknown as Ref<AppLocale>).value = platform.locale;
    const { default: Preview } =
      await import("@/components/settings/scene/SceneLightingPreview.vue");
    const draft = snapshot();
    const before = JSON.stringify(draft);
    const wrapper = mount(Preview, { props: { lighting: draft }, global: { plugins: [i18n] } });
    await flushPromises();
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
    expect(wrapper.find("[data-lighting-assets] img").exists()).toBe(false);
    expect(wrapper.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
    expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
    expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(true);
    expect(stores.ui.showNotification).toHaveBeenCalledTimes(1);
    expect(stores.ui.showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "info",
        title: noticeTitles[platform.locale],
        duration: 3000,
      })
    );
    expect(wrapper.emitted("warning")).toBeUndefined();
    expect(JSON.stringify(draft)).toBe(before);
    await wrapper.setProps({ lighting: JSON.parse(before) });
    await flushPromises();
    const runtime = await runtimeHost();
    expect(stores.ui.showNotification).toHaveBeenCalledTimes(1);
    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(JSON.stringify(stores.game.activeLighting)).toBe(before);
    expect(stores.game.lightingRevision).toBe(12);
    wrapper.unmount();
    runtime.wrapper.unmount();
  }
);
const compatibility = {
  "zh-CN": ["光影兼容模式", "当前窗口不支持加色混合，已降级为 screen。"],
  "zh-HK": ["光影相容模式", "目前視窗不支援加色混合，已降級為 screen。"],
  en: [
    "Lighting compatibility mode",
    "Additive blending is unavailable in this window; using screen instead.",
  ],
  ja: [
    "ライティング互換モード",
    "このウィンドウでは加算合成に対応していないため、スクリーンに切り替えました。",
  ],
};
it.each(Object.keys(compatibility) as (keyof typeof compatibility)[])(
  "%s localizes the nonblocking blend fallback in runtime and draft preview",
  async (locale) => {
    vi.stubGlobal("CSS", { supports: () => false });
    const { i18n } = await import("@/locales");
    (i18n.global.locale as unknown as Ref<AppLocale>).value = locale;
    stores.game.activeLighting.asset_layers = [];
    stores.game.activeLighting.main_light.blend_mode = "add";
    const runtime = await runtimeHost();
    expect(stores.ui.showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: compatibility[locale][0],
        message: compatibility[locale][1],
      })
    );
    const { default: Preview } =
      await import("@/components/settings/scene/SceneLightingPreview.vue");
    const preview = mount(Preview, {
      props: { lighting: stores.game.activeLighting },
      global: { plugins: [i18n] },
    });
    expect(preview.emitted("warning")).toEqual([[compatibility[locale][1]]]);
    expect(
      (preview.get('[data-lighting-effect="main"]').element as HTMLElement).style.mixBlendMode
    ).toBe("screen");
    await preview.setProps({ lighting: JSON.parse(JSON.stringify(stores.game.activeLighting)) });
    await flushPromises();
    expect(preview.emitted("warning")).toHaveLength(1);
    preview.unmount();
    runtime.wrapper.unmount();
  }
);
it.each(
  platforms.flatMap((platform) =>
    (Object.keys(noticeTitles) as (keyof typeof noticeTitles)[]).map((locale) => ({
      ...platform,
      locale,
    }))
  )
)("$name $locale shares the mobile notice when runtime opens before editor", async (platform) => {
  vi.stubGlobal("navigator", platform);
  stores.settings.display.simplifiedLighting = true;
  const { i18n } = await import("@/locales");
  (i18n.global.locale as unknown as Ref<AppLocale>).value = platform.locale;
  const original = JSON.stringify(stores.game.activeLighting);
  const runtime = await runtimeHost();
  const { default: Preview } = await import("@/components/settings/scene/SceneLightingPreview.vue");
  const draft = JSON.parse(original);
  const preview = mount(Preview, { props: { lighting: draft }, global: { plugins: [i18n] } });
  await flushPromises();
  expect(stores.ui.showNotification).toHaveBeenCalledTimes(1);
  expect(stores.ui.showNotification).toHaveBeenCalledWith({
    type: "info",
    title: noticeTitles[platform.locale],
    message: i18n.global.t("ui.lighting.mobileAssetsMessage"),
    duration: 3000,
  });
  expect(preview.emitted("warning")).toBeUndefined();
  expect(tauriMocks.invoke).not.toHaveBeenCalled();
  expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
  expect(JSON.stringify(draft)).toBe(original);
  expect(JSON.stringify(stores.game.activeLighting)).toBe(original);
  expect(stores.game.lightingRevision).toBe(12);
  preview.unmount();
  runtime.wrapper.unmount();
});
it.each([
  {
    name: "Windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    platform: "Win32",
    maxTouchPoints: 0,
  },
  {
    name: "macOS",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    platform: "MacIntel",
    maxTouchPoints: 0,
  },
  {
    name: "Linux",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    platform: "Linux",
    maxTouchPoints: 0,
  },
])("$name keeps desktop scene asset resolution and rendering", async (platform) => {
  vi.stubGlobal("navigator", platform);
  const original = JSON.stringify(stores.game.activeLighting);
  const runtime = await runtimeHost();
  expect(tauriMocks.invoke).toHaveBeenCalledExactlyOnceWith("resolve_lighting_asset", {
    hash: "a".repeat(64),
  });
  expect(tauriMocks.convertFileSrc).toHaveBeenCalledExactlyOnceWith("G:/lighting.png");
  expect(runtime.wrapper.findAll("[data-lighting-assets] img")).toHaveLength(3);
  expect(runtime.context.lighting.value).toBe(stores.game.activeLighting);
  expect(stores.ui.showNotification).not.toHaveBeenCalled();
  expect(JSON.stringify(stores.game.activeLighting)).toBe(original);
  runtime.wrapper.unmount();
});
