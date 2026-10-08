import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { convertFileSrc } from "@tauri-apps/api/core";
import { clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { LightingAssetStack } from "@/components/game/lighting";
import { provideSceneLighting } from "@/composables/useSceneLighting";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { nativeLightingAssetFixture } from "@/utils/scene-lighting/__tests__/native-asset-fixture";
import { resetTauriMocks, tauriMocks } from "@/test/setup";
import { i18n } from "@/locales";
import SceneLightingPreview from "../SceneLightingPreview.vue";
import type { LightingAssetLayer } from "@/types/scene-lighting";

const stores = vi.hoisted(() => ({
  game: null as any,
  settings: null as any,
  ui: { showNotification: vi.fn() },
}));
vi.mock("@/stores/modules/game", () => ({ useGameStore: () => stores.game }));
vi.mock("@/stores/modules/settings", () => ({ useSettingsStore: () => stores.settings }));
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => stores.ui }));
// Real bundled translations without an unrelated native locale bootstrap.
vi.mock("@/locales", async () => {
  const { createI18n } = await import("vue-i18n");
  const { default: messages } = await import("@/locales/zh-CN");
  return { i18n: createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": messages } }) };
});

let native: ReturnType<typeof nativeLightingAssetFixture>;
let actualConvertFileSrc: typeof convertFileSrc;
let assetLayer: LightingAssetLayer;
beforeAll(async () => {
  native = nativeLightingAssetFixture();
  actualConvertFileSrc = (
    await vi.importActual<typeof import("@tauri-apps/api/core")>("@tauri-apps/api/core")
  ).convertFileSrc;
});
afterAll(() => {
  native?.dispose();
  clearMocks();
});
beforeEach(() => {
  resetTauriMocks();
  // The real exported JS helper delegates to Tauri's official native-internals mock.
  // This verifies JS conversion, not a running native WebView asset protocol.
  mockConvertFileSrc(process.platform === "win32" ? "windows" : "linux");
  tauriMocks.convertFileSrc.mockImplementation(actualConvertFileSrc);
  assetLayer = {
    id: "native-png",
    asset_hash: native.hash,
    media_type: "image/png",
    target: "both",
    placement: "front",
    z_index: 0,
    opacity: 1,
    blend_mode: "normal",
    fit: "cover",
    required: false,
  };
  stores.game = reactive({
    activeLighting: { ...createNeutralLighting(), enabled: true, asset_layers: [assetLayer] },
  });
  stores.settings = reactive({ display: { simplifiedLighting: false } });
  vi.mocked(tauriMocks.invoke as (...args: unknown[]) => Promise<unknown>).mockResolvedValue({
    hash: native.hash,
    supported: true,
    asset_protocol_path: native.path,
    warning: null,
  });
});

it("resolves a real native canonical PNG in runtime", async () => {
  if (process.platform === "win32") expect(native.path).toMatch(/^\\\\\?\\[A-Za-z]:\\/);
  const wrapper = mount(
    defineComponent({
      setup() {
        const ctx = provideSceneLighting();
        return () =>
          h(LightingAssetStack, {
            lighting: ctx.lighting.value,
            surface: "both",
            placement: "front",
            resolveAsset: ctx.resolveAsset,
          });
      },
    })
  );
  await flushPromises();
  const normalized =
    process.platform === "win32" ? native.path.slice(4).replace(/\\/g, "/") : native.path;
  expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith(normalized);
  expect(wrapper.get("img").attributes("src")).toBe(actualConvertFileSrc(normalized));
  expect(wrapper.get("img").attributes("src")).not.toBe("");
});

it("resolves a real native canonical PNG in draft", async () => {
  const wrapper = mount(SceneLightingPreview, {
    props: { lighting: stores.game.activeLighting },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  const normalized =
    process.platform === "win32" ? native.path.slice(4).replace(/\\/g, "/") : native.path;
  expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith(normalized);
  const artwork = wrapper.get("[data-lighting-assets] img");
  expect(artwork.attributes("src")).toBe(actualConvertFileSrc(normalized));
  expect(artwork.attributes("src")).not.toBe("");
  expect(wrapper.find("[data-preview-warnings]").exists()).toBe(false);
});
