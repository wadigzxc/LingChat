import { defineComponent, h, nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";

it("never resolves legacy assets on a relighting target miss and restores legacy when block disabled", async () => {
  stores.game.activeLighting.relighting = {
    ...createRelightingParams(),
    enabled: true,
    target: "character",
  };
  const wrapper = host();
  await flushPromises();
  expect(invokeMock).not.toHaveBeenCalled();
  expect(wrapper.find("img").exists()).toBe(false);
  stores.game.activeLighting.relighting.enabled = false;
  await flushPromises();
  expect(invokeMock).toHaveBeenCalledWith("resolve_lighting_asset", { hash });
  wrapper.unmount();
});
import { LightingAssetStack, LightingOverlay } from "@/components/game/lighting";
import { provideSceneLighting } from "../useSceneLighting";
import { tauriMocks, resetTauriMocks } from "@/test/setup";
import { invoke } from "@tauri-apps/api/core";
const invokeMock = vi.mocked(invoke);
const stores = vi.hoisted(() => ({
  game: null as any,
  settings: null as any,
  ui: { showNotification: vi.fn() },
}));
vi.mock("@/stores/modules/game", () => ({ useGameStore: () => stores.game }));
vi.mock("@/stores/modules/settings", () => ({ useSettingsStore: () => stores.settings }));
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => stores.ui }));
const hash = "a".repeat(64);
function layer(asset_hash = hash) {
  return {
    id: asset_hash,
    asset_hash,
    media_type: "image/png",
    target: "both" as const,
    placement: "front" as const,
    z_index: 7,
    opacity: 1,
    blend_mode: "normal" as const,
    fit: "cover" as const,
    required: false,
  };
}
function host() {
  return mount(
    defineComponent({
      setup() {
        const ctx = provideSceneLighting();
        return () =>
          h(LightingAssetStack, {
            lighting: ctx.lighting.value,
            surface: "both",
            placement: "front",
            resolveAsset: ctx.resolveAsset,
            options: ctx.options,
            simplified: ctx.simplified.value,
          });
      },
    })
  );
}
beforeEach(() => {
  resetTauriMocks();
  stores.game = reactive({
    activeLighting: { ...createNeutralLighting(), enabled: true, asset_layers: [layer()] },
    lightingRevision: 12,
  });
  stores.settings = reactive({ display: { simplifiedLighting: false } });
  stores.ui.showNotification.mockClear();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it.each([
  { supported: false, asset_protocol_path: "G:/a.png" },
  { supported: true, asset_protocol_path: "https://evil/a.png" },
  { supported: true, asset_protocol_path: "G:/../outside.png" },
  { supported: true, asset_protocol_path: null },
  { supported: true, asset_protocol_path: "G:/a.png", warning: "missing" },
])("safely omits unusable backend asset: %j", async (resolution) => {
  invokeMock.mockResolvedValue({ hash, ...resolution });
  const wrapper = host();
  await flushPromises();
  expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
  expect(wrapper.find("img").exists()).toBe(false);
});
it("omits a URL conversion failure without throwing", async () => {
  invokeMock.mockResolvedValue({ hash, supported: true, asset_protocol_path: "G:/a.png" });
  tauriMocks.convertFileSrc.mockImplementation(() => {
    throw new Error("unavailable protocol");
  });
  const wrapper = host();
  await flushPromises();
  expect(wrapper.find("img").exists()).toBe(false);
});
it("reuses in-flight hash resolution after a parameter-only lighting update", async () => {
  const pending = deferred<any>();
  invokeMock.mockReturnValue(pending.promise);
  const wrapper = host();
  stores.game.activeLighting.main_light.x = 0.7;
  await nextTick();
  expect(invokeMock).toHaveBeenCalledTimes(1);
  pending.resolve({ hash, supported: true, asset_protocol_path: "G:/a.png" });
  await flushPromises();
  expect(wrapper.findAll("img")).toHaveLength(1);
});
it("probes blend capability and warns once across remounted hosts", async () => {
  vi.stubGlobal("CSS", { supports: vi.fn(() => false) });
  stores.game.activeLighting.main_light = {
    ...stores.game.activeLighting.main_light,
    enabled: true,
    opacity: 0.6,
    blend_mode: "add",
  };
  const BlendHost = defineComponent({
    setup() {
      const ctx = provideSceneLighting();
      return () =>
        h(LightingOverlay, { lighting: ctx.lighting.value, surface: "both", options: ctx.options });
    },
  });
  const wrapper = mount(BlendHost);
  expect(
    (wrapper.get('[data-lighting-effect="main"]').element as HTMLElement).style.mixBlendMode
  ).toBe("screen");
  expect(stores.ui.showNotification).toHaveBeenCalledTimes(1);
  wrapper.unmount();
  mount(BlendHost);
  await nextTick();
  expect(stores.ui.showNotification).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
it("caches resolved hashes across repeated layers and quality changes", async () => {
  stores.game.activeLighting.asset_layers = [layer(), { ...layer(), id: "second" }];
  invokeMock.mockResolvedValue({ hash, supported: true, asset_protocol_path: "G:/a.png" });
  const wrapper = host();
  await flushPromises();
  expect(wrapper.findAll("img")).toHaveLength(2);
  expect(invokeMock).toHaveBeenCalledTimes(1);
  stores.settings.display.simplifiedLighting = true;
  await nextTick();
  stores.settings.display.simplifiedLighting = false;
  await nextTick();
  await flushPromises();
  expect(invokeMock).toHaveBeenCalledTimes(1);
  expect(wrapper.findAll("img")).toHaveLength(2);
});
it("omits failed resolution without losing the remaining lighting or throwing", async () => {
  invokeMock.mockRejectedValue(new Error("missing asset"));
  const wrapper = host();
  await flushPromises();
  expect(wrapper.find("img").exists()).toBe(false);
  expect(stores.game.lightingRevision).toBe(12);
});
it("rejects invalid hashes and unsafe/mismatched backend resolutions", async () => {
  stores.game.activeLighting.asset_layers = [layer("not-a-hash"), layer(hash)];
  invokeMock.mockResolvedValue({
    hash: "b".repeat(64),
    supported: true,
    asset_protocol_path: "https://evil/a.png",
  });
  const wrapper = host();
  await flushPromises();
  expect(invokeMock).toHaveBeenCalledTimes(1);
  expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
  expect(wrapper.find("img").exists()).toBe(false);
});
it("discards in-flight responses on unmount", async () => {
  const pending = deferred<any>();
  invokeMock.mockReturnValueOnce(pending.promise);
  const wrapper = host();
  wrapper.unmount();
  pending.resolve({ hash, supported: true, asset_protocol_path: "G:/after-unmount.png" });
  await flushPromises();
  expect(tauriMocks.convertFileSrc).not.toHaveBeenCalled();
});
it("ignores stale asset responses after a scene or quality switch", async () => {
  const old = deferred<any>();
  invokeMock
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue({ hash: "b".repeat(64), supported: true, asset_protocol_path: "G:/b.png" });
  const wrapper = host();
  stores.game.activeLighting.asset_layers = [layer("b".repeat(64))];
  await nextTick();
  await flushPromises();
  old.resolve({ hash, supported: true, asset_protocol_path: "G:/stale.png" });
  await flushPromises();
  expect(tauriMocks.convertFileSrc).not.toHaveBeenCalledWith("G:/stale.png");
  expect(wrapper.get("img").attributes("src")).toContain("b.png");
  stores.settings.display.simplifiedLighting = true;
  await nextTick();
  expect(wrapper.find("img").exists()).toBe(false);
});
it("resolves verified backend paths reactively without treating a hash as a URL", async () => {
  invokeMock.mockResolvedValue({
    hash,
    supported: true,
    asset_protocol_path: "G:/data/lighting_assets/a.png",
    warning: null,
  });
  const wrapper = host();
  expect(wrapper.find("img").exists()).toBe(false);
  await flushPromises();
  expect(invokeMock).toHaveBeenCalledWith("resolve_lighting_asset", { hash });
  expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith("G:/data/lighting_assets/a.png");
  expect(wrapper.get("img").attributes("src")).toBe(
    "asset://localhost/G%3A%2Fdata%2Flighting_assets%2Fa.png"
  );
  expect(stores.game.lightingRevision).toBe(12);
  expect(stores.game.activeLighting.asset_layers[0].asset_hash).toBe(hash);
});
