import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createApp } from "vue";
import { persist } from "@/stores/plugins/persist";
function freshPinia() {
  const pinia = createPinia().use(persist);
  createApp({}).use(pinia);
  setActivePinia(pinia);
}
import { createI18n } from "vue-i18n";
import SettingsBackground from "../../pages/SettingsBackground.vue";
import LightingPresetSelect from "../LightingPresetSelect.vue";
import LightingPresetManager from "../LightingPresetManager.vue";
import SceneEditModal from "../../scene/SceneEditModal.vue";
import { useGameStore } from "@/stores/modules/game";
import { useSettingsStore } from "@/stores/modules/settings";
import { useUIStore } from "@/stores/modules/ui/ui";
import { scene, lighting } from "@/test/scene-lighting-fixtures";
import { preset, invokeMock } from "./fixtures";
import { applySceneChangeMessage } from "@/api/websocket/handlers/script-handler";
import { applyCastRuntimeLighting } from "@/utils/scene-lighting/scene-state";
vi.mock("@/api/services/cpu-perf", () => ({
  getCpuInfo: async () => ({ brand: "CPU", tier: "High" }),
  getTierLabel: () => "High",
  getSuggestedMaxFps: () => 60,
  getPerfTierColor: () => "#ffffff",
  getCombinedTier: () => "High",
  redetectCpu: vi.fn(),
}));
vi.mock("@/api/services/gpu-perf", () => ({
  getGpuInfo: async () => null,
  getActiveGpu: async () => null,
  redetectGpu: vi.fn(),
}));
const backgrounds = vi.hoisted(() => ({ upload: vi.fn(), open: vi.fn(), list: vi.fn() }));
vi.mock("@/api/services/background", () => ({
  getBackgroundImages: () => backgrounds.list(),
  uploadBackgroundImage: backgrounds.upload,
  openBackgroundsFolder: backgrounds.open,
  generateBackgroundImage: vi.fn(),
}));
vi.mock("@/locales", () => {
  const i18n = createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": {} } });
  return { default: i18n, i18n };
});
let items: ReturnType<typeof scene>[];
let presets: ReturnType<typeof preset>[];
let game: ReturnType<typeof useGameStore>;
function options() {
  return {
    plugins: [
      createI18n({
        legacy: false,
        locale: "zh-CN",
        missingWarn: false,
        fallbackWarn: false,
        messages: {
          "zh-CN": {
            settings: { background: { scene: { title: "场景管理" } } },
            nav: { background: "背景" },
            lighting: { presets: { moonlight: "月夜" } },
          },
        },
      }),
    ],
    stubs: {
      MenuPage: { template: "<main><slot /></main>" },
      MenuItem: { props: ["title"], template: "<section><h2>{{title}}</h2><slot /></section>" },
      Button: { template: "<button><slot /></button>" },
      Toggle: { template: "<div><slot /></div>" },
      Slider: true,
      DialogAppearancePanel: true,
      PluginTag: true,
      SceneEditModal: true,
      MessageSquare: true,
    },
  };
}
async function openPage() {
  const w = mount(SettingsBackground, { global: options(), attachTo: document.body });
  await flushPromises();
  return w;
}
function calls(cmd: string) {
  return invokeMock.mock.calls.filter((c) => c[0] === cmd);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.restoreAllMocks();
  backgrounds.upload.mockReset();
  backgrounds.open.mockReset();
  backgrounds.list.mockReset();
  backgrounds.list.mockResolvedValue([]);
  freshPinia();
  game = useGameStore();
  items = [scene("scene-1")];
  presets = [preset()];
  game.currentScene = items[0]!;
  game.activeLighting = lighting(1.8);
  game.activeLightingPresetId = "user:one";
  game.activeLightingPresetRevision = 7;
  game.activeLightingCustomized = true;
  game.activeLightingSource = "manual";
  game.lightingRevision = 8;
  invokeMock.mockImplementation(async (cmd) =>
    cmd === "list_scenes" ? items : cmd === "list_lighting_presets" ? presets : {}
  );
});
describe("Task16 background settings DOM", () => {
  it("refreshes favorites between selectors and manager without remounting or replacing unsaved drafts", async () => {
    presets = [preset(), preset({ id: "builtin:z", kind: "built_in", name: "Zulu" })];
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "list_scenes") return items;
      if (cmd === "list_lighting_presets") return presets;
      if (cmd === "set_lighting_preset_favorite") {
        presets = presets.map((p) =>
          p.id === args?.id ? { ...p, favorite: args.favorite as boolean } : p
        );
        return presets.find((p) => p.id === args?.id);
      }
      return {};
    });
    const global = options();
    global.stubs.SceneEditModal = false as any;
    const w = mount(SettingsBackground, {
      global: { ...global, stubs: { ...global.stubs, teleport: false, transition: false } },
      attachTo: document.body,
    });
    await flushPromises();
    const selector = w.getComponent(LightingPresetSelect);
    const selectorElement = selector.element;
    await selector.get("[data-search]").setValue("Night");
    await selector.get("[data-sort]").setValue("name");
    await w.get("[data-manage-lighting]").trigger("click");
    await flushPromises();
    const manager = w.getComponent(LightingPresetManager);
    await manager.get('[data-edit="user:one"]').trigger("click");
    await manager.get("[data-name]").setValue("Unsaved preset");
    const managerElement = manager.element;
    await w.get('[data-scene-card="scene-1"] button').trigger("click");
    await flushPromises();
    const editor = w.getComponent(SceneEditModal);
    const editorDom = new DOMWrapper(document.body.querySelector("[data-editor-dialog]")!);
    await editorDom.get('[aria-label="场景名称"]').setValue("Unsaved scene");
    await editorDom.get('[aria-label="总强度"]').setValue(0.7);
    const editorInput = editorDom.get('[aria-label="场景名称"]').element;
    const editorSelector = editor.getComponent(LightingPresetSelect);
    const gameBefore = JSON.stringify(game.$state);
    const scenesBefore = JSON.stringify(items);
    const statusBefore = w.get("[data-active-lighting-status]").text();
    invokeMock.mockClear();
    await selector.get('[data-favorite="builtin:z"]').trigger("click");
    await flushPromises();
    expect(manager.get('[data-favorite="builtin:z"]').attributes("aria-pressed")).toBe("true");
    expect(editorSelector.get('[data-favorite="builtin:z"]').attributes("aria-pressed")).toBe(
      "true"
    );
    await manager.get('[data-favorite="builtin:z"]').trigger("click");
    await flushPromises();
    expect(selector.get('[data-favorite="builtin:z"]').attributes("aria-pressed")).toBe("false");
    expect(editorSelector.get('[data-favorite="builtin:z"]').attributes("aria-pressed")).toBe(
      "false"
    );
    await editorSelector.get('[data-favorite="user:one"]').trigger("click");
    await flushPromises();
    expect(selector.get('[data-favorite="user:one"]').attributes("aria-pressed")).toBe("true");
    expect(manager.get('[data-favorite="user:one"]').attributes("aria-pressed")).toBe("true");
    expect(selector.element).toBe(selectorElement);
    expect(manager.element).toBe(managerElement);
    expect(editorDom.get('[aria-label="场景名称"]').element).toBe(editorInput);
    expect(selector.get("[data-search]").element).toHaveProperty("value", "Night");
    expect(selector.get("[data-sort]").element).toHaveProperty("value", "name");
    expect(manager.get("[data-name]").element).toHaveProperty("value", "Unsaved preset");
    expect(editorInput).toHaveProperty("value", "Unsaved scene");
    expect(editorDom.get('[aria-label="总强度"]').element).toHaveProperty("value", "0.7");
    expect(editorDom.find("[data-draft-discard]").exists()).toBe(false);
    expect(JSON.stringify(game.$state)).toBe(gameBefore);
    expect(JSON.stringify(items)).toBe(scenesBefore);
    expect(w.get("[data-active-lighting-status]").text()).toBe(statusBefore);
    expect(
      invokeMock.mock.calls.every(([cmd]) =>
        ["set_lighting_preset_favorite", "list_lighting_presets"].includes(cmd)
      )
    ).toBe(true);
    w.unmount();
  });
  it("keeps card artwork isolated and exposes the edit control on keyboard focus", async () => {
    const w = await openPage();
    const card = w.get('[data-scene-card="scene-1"]');
    const preview = card.findComponent({ name: "SceneCardLightingPreview" });
    expect(preview.classes()).toContain("isolate");
    expect(preview.classes()).toContain("pointer-events-none");
    const edit = card.get("button");
    expect(edit.classes()).toContain("focus-visible:opacity-100");
    await edit.trigger("click");
    expect(w.findComponent({ name: "SceneEditModal" }).props("show")).toBe(true);
    expect(calls("select_scene")).toHaveLength(0);
    w.unmount();
  });
  it("names the section scene and lighting settings", async () => {
    const w = await openPage();
    expect(w.get("h2").text()).toBe("场景及光影设置");
  });
  it("shows authoritative temporary provenance below current scene and applies a preset without saving defaults", async () => {
    const w = await openPage();
    expect(w.get("[data-active-lighting-status]").text()).toContain("临时");
    expect(w.get("[data-active-lighting-status]").text()).toContain("Moon");
    expect(w.get("[data-active-lighting-status]").text()).toContain("7");
    expect(w.get("[data-active-lighting-status]").text()).toContain("自定义");
    await w.get('[data-preset="user:one"]').trigger("click");
    await flushPromises();
    expect(calls("apply_lighting_preset")).toHaveLength(1);
    expect(calls("update_scene")).toHaveLength(0);
    game.activeLightingSource = "scene_default";
    await w.vm.$nextTick();
    expect(w.get("[data-active-lighting-status]").text()).toContain("场景默认");
    expect(w.get("[data-active-lighting-status]").text()).not.toContain("临时");
  });
  it("saves the complete captured active snapshot and provenance via update_scene", async () => {
    const w = await openPage();
    const snapshot = JSON.parse(JSON.stringify(game.activeLighting));
    await w.get("[data-save-scene-default]").trigger("click");
    await flushPromises();
    expect(calls("update_scene")).toEqual([
      [
        "update_scene",
        {
          req: {
            id: "scene-1",
            scene_name: "scene-1",
            scene_description: "",
            background: "scene-1.png",
            lighting: snapshot,
            lighting_preset_id: "user:one",
            lighting_preset_revision: 7,
            lighting_customized: true,
            apply_lighting_as_default: true,
          },
        },
      ],
    ]);
    expect(game.lightingRevision).toBe(8);
    expect(game.activeLightingSource).toBe("manual");
  });
  it("does not save when no scene exists", async () => {
    game.currentScene = null;
    const w = await openPage();
    const b = w.get("[data-save-scene-default]");
    expect(b.attributes("disabled")).toBeDefined();
    await b.trigger("click");
    expect(calls("update_scene")).toHaveLength(0);
  });
  it("locks default save until confirmation and reports rejection without false success", async () => {
    const w = await openPage();
    const wait = deferred<unknown>();
    const ok = vi.spyOn(useUIStore(), "showSuccess");
    const error = vi.spyOn(useUIStore(), "showError");
    invokeMock.mockImplementation((cmd) =>
      cmd === "update_scene"
        ? wait.promise
        : Promise.resolve(cmd === "list_scenes" ? items : presets)
    );
    await w.get("[data-save-scene-default]").trigger("click");
    await w.get("[data-save-scene-default]").trigger("click");
    expect(calls("update_scene")).toHaveLength(1);
    expect(w.get("[data-save-scene-default]").attributes("disabled")).toBeDefined();
    expect(ok).not.toHaveBeenCalled();
    wait.reject(new Error("save denied"));
    await flushPromises();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "save denied" }));
    expect(ok).not.toHaveBeenCalled();
    expect(w.get("[data-save-scene-default]").attributes("disabled")).toBeUndefined();
  });
  it("keeps the captured ID and independent snapshot when scene and runtime change during save", async () => {
    const w = await openPage();
    const wait = deferred<unknown>();
    invokeMock.mockImplementation((cmd) =>
      cmd === "update_scene"
        ? wait.promise
        : Promise.resolve(cmd === "list_scenes" ? items : presets)
    );
    await w.get("[data-save-scene-default]").trigger("click");
    game.activeLighting.master_intensity = 0.4;
    game.currentScene = scene("other");
    game.activeLightingPresetId = null;
    wait.resolve(items[0]);
    await flushPromises();
    const req = (calls("update_scene")[0]![1] as any).req;
    expect(req.id).toBe("scene-1");
    expect(req.lighting.master_intensity).toBe(1.8);
    expect(req.lighting_preset_id).toBe("user:one");
    expect(game.currentScene.id).toBe("other");
    expect(game.activeLighting.master_intensity).toBe(0.4);
    expect(game.lightingRevision).toBe(8);
  });
  it("renders card lighting from saved snapshots rather than active runtime", async () => {
    items[0]!.lighting = lighting(0.3);
    items[0]!.lighting!.background.brightness = 0.6;
    const w = await openPage();
    const img = w.get('[data-scene-card="scene-1"] [data-card-background]');
    expect(
      (img.element as HTMLElement).style.filter ||
        (img.element as HTMLElement).style.getPropertyValue("-webkit-filter")
    ).toContain("brightness(0.88)");
    game.activeLighting.background.brightness = 2;
    await w.vm.$nextTick();
    expect(
      (img.element as HTMLElement).style.filter ||
        (img.element as HTMLElement).style.getPropertyValue("-webkit-filter")
    ).toContain("brightness(0.88)");
  });
  it("labels saved preset provenance with localized built-ins and verbatim user names", async () => {
    presets = [
      preset({
        id: "builtin:moonlight",
        kind: "built_in",
        i18n_key: "lighting.presets.moonlight",
        name: "Moon raw",
      }),
      preset({ name: "原文 User ✦" }),
    ];
    items = [scene("built"), scene("user"), scene("custom")];
    items[0]!.lighting_preset_id = "builtin:moonlight";
    items[1]!.lighting_preset_id = "user:one";
    items[2]!.lighting_preset_id = null;
    items[2]!.lighting_customized = true;
    const w = await openPage();
    expect(w.get('[data-scene-card="built"] [data-card-lighting-label]').text()).toContain("月夜");
    expect(w.get('[data-scene-card="user"] [data-card-lighting-label]').text()).toContain(
      "原文 User ✦"
    );
    expect(w.get('[data-scene-card="custom"] [data-card-lighting-label]').text()).toContain(
      "自定义"
    );
  });
  it("keeps saved pixels and marks deleted preset sources after library refresh", async () => {
    items[0]!.lighting = lighting(0.3);
    items[0]!.lighting!.background.brightness = 0.6;
    items[0]!.lighting_preset_id = "user:one";
    const w = await openPage();
    presets = [];
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
    expect(w.get('[data-scene-card="scene-1"] [data-card-lighting-label]').text()).toContain(
      "来源已删除"
    );
    expect(w.get('[data-scene-card="scene-1"] [data-card-lighting-label]').text()).toContain(
      "user:one"
    );
    expect(w.get("[data-active-lighting-status]").text()).toContain("来源已删除");
    const style = (w.get("[data-card-background]").element as HTMLElement).style;
    expect(style.filter || style.getPropertyValue("-webkit-filter")).toContain("brightness(0.88)");
    expect(calls("update_scene")).toHaveLength(0);
  });
  it("renders main, ambient and final vignette CSS using shared target semantics", async () => {
    const saved = lighting(0.5);
    saved.main_light = { ...saved.main_light, enabled: true, target: "both", opacity: 0.6 };
    saved.background_ambient = { enabled: true, color: "#123456", opacity: 0.4 };
    saved.vignette = { ...saved.vignette, enabled: true, intensity: 0.8 };
    items[0]!.lighting = saved;
    const w = await openPage();
    expect(w.findAll("[data-card-main]")).toHaveLength(1);
    expect((w.get("[data-card-main]").element as HTMLElement).style.opacity).toBe("0.3");
    expect((w.get("[data-card-ambient]").element as HTMLElement).style.opacity).toBe("0.2");
    expect((w.get("[data-card-vignette]").element as HTMLElement).style.opacity).toBe("0.4");
  });
  it("shows asset-layer markers without resolving or mounting full-resolution PNGs", async () => {
    items[0]!.lighting!.asset_layers = [
      {
        id: "flare",
        asset_hash: "a".repeat(64),
        media_type: "image/png",
        target: "both",
        placement: "front",
        z_index: 0,
        opacity: 1,
        blend_mode: "screen",
        fit: "cover",
        required: false,
      },
    ];
    const w = await openPage();
    expect(w.get("[data-card-assets]").text()).toContain("PNG");
    expect(w.get("[data-card-assets]").text()).toContain("1");
    expect(w.findAll('[data-scene-card="scene-1"] img')).toHaveLength(1);
    expect(calls("resolve_lighting_asset")).toHaveLength(0);
  });
  it("exposes the shared persistent simplified-lighting toggle on the settings page", async () => {
    const settings = useSettingsStore();
    const snapshot = JSON.stringify(game.activeLighting);
    const w = await openPage();
    const label = w.findAll("label").find((l) => l.text().includes("简化光影"));
    expect(label).toBeDefined();
    await label!.get("input[type=checkbox]").setValue(true);
    expect(settings.display.simplifiedLighting).toBe(true);
    expect(JSON.stringify(game.activeLighting)).toBe(snapshot);
    await w.get("[data-save-scene-default]").trigger("click");
    await flushPromises();
    expect((calls("update_scene")[0]![1] as any).req.lighting).toEqual(JSON.parse(snapshot));
  });
  it("renders bloom in full mode but omits it in simplified mode without changing scene data", async () => {
    const saved = lighting(0.5);
    saved.bloom = { enabled: true, target: "both", intensity: 0.8, radius: 12, color: "#ffffff" };
    items[0]!.lighting = saved;
    const original = JSON.stringify(saved);
    const w = await openPage();
    expect(w.find("[data-card-bloom]").exists()).toBe(true);
    await w
      .findAll("label")
      .find((l) => l.text().includes("简化光影"))!
      .get("input")
      .setValue(true);
    expect(w.find("[data-card-bloom]").exists()).toBe(false);
    expect(JSON.stringify(items[0]!.lighting)).toBe(original);
  });
  it("deselects the current card through selectScene(null) and consumes the authoritative empty event", async () => {
    const w = await openPage();
    const original = game.currentScene;
    await w.get('[data-scene-card="scene-1"]').trigger("click");
    await flushPromises();
    expect(calls("select_scene")).toEqual([["select_scene", { sceneId: null }]]);
    expect(game.currentScene).toEqual(original);
    applySceneChangeMessage({
      scene: null,
      background: "",
      active_lighting: lighting(),
      source: "neutral",
      preset_id: null,
      preset_revision: null,
      customized: false,
      lighting_revision: 9,
    });
    await w.vm.$nextTick();
    expect(game.currentScene).toBeNull();
    expect(game.activeLightingSource).toBe("neutral");
    expect(w.get("[data-save-scene-default]").attributes("disabled")).toBeDefined();
  });
  it("consumes newer same-ID defaults through websocket and Cast reducers without optimistic revisions", async () => {
    const w = await openPage();
    await w.get("[data-save-scene-default]").trigger("click");
    await flushPromises();
    expect(game.lightingRevision).toBe(8);
    const updated = {
      ...items[0]!,
      lighting: lighting(1.8),
      lighting_preset_id: "user:one",
      lighting_preset_revision: 7,
      lighting_customized: true,
    };
    const before = {
      currentScene: items[0]!,
      currentBackground: "old.png",
      activeLighting: lighting(0.4),
      activeLightingSource: "scene_default" as const,
      activeLightingPresetId: null,
      activeLightingPresetRevision: null,
      activeLightingCustomized: false,
      lightingRevision: 8,
    };
    applySceneChangeMessage({
      scene: updated,
      background: "scene-1.png",
      active_lighting: updated.lighting,
      source: "scene_default",
      preset_id: "user:one",
      preset_revision: 7,
      customized: true,
      lighting_revision: 9,
    });
    await w.vm.$nextTick();
    const cast = applyCastRuntimeLighting(
      before,
      {
        currentSceneId: game.currentScene!.id,
        background: game.currentScene!.background,
        activeLighting: game.activeLighting,
        activeLightingSource: game.activeLightingSource,
        activeLightingPresetId: game.activeLightingPresetId,
        activeLightingPresetRevision: game.activeLightingPresetRevision,
        activeLightingCustomized: game.activeLightingCustomized,
        lightingRevision: game.lightingRevision,
      },
      game.currentScene
    );
    expect(cast.currentScene!.id).toBe("scene-1");
    expect(cast.lightingRevision).toBe(9);
    expect(cast.activeLighting.master_intensity).toBe(1.8);
    expect(w.get("[data-active-lighting-status]").text()).toContain("场景默认");
    applySceneChangeMessage({
      scene: items[0],
      background: "old.png",
      active_lighting: lighting(0.1),
      source: "manual",
      preset_id: null,
      preset_revision: null,
      customized: false,
      lighting_revision: 8,
    });
    expect(game.lightingRevision).toBe(9);
    expect(game.activeLighting.master_intensity).toBe(1.8);
  });
  it("locks scene selection immediately and reports failure without clearing the authoritative scene", async () => {
    const w = await openPage();
    const wait = deferred<unknown>();
    const error = vi.spyOn(useUIStore(), "showError");
    invokeMock.mockImplementation((cmd) =>
      cmd === "select_scene" ? wait.promise : Promise.resolve(items)
    );
    await w.get('[data-scene-card="scene-1"]').trigger("click");
    await w.get('[data-scene-card="scene-1"]').trigger("click");
    expect(calls("select_scene")).toHaveLength(1);
    wait.reject(new Error("selection denied"));
    await flushPromises();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "selection denied" }));
    expect(game.currentScene!.id).toBe("scene-1");
  });
  it("locks delete before confirmation and deletes only its captured scene ID", async () => {
    const { useDialogStore } = await import("@/stores/modules/ui/dialog");
    const wait = deferred<boolean>();
    const dialog = useDialogStore();
    const confirm = vi.spyOn(dialog, "confirm").mockReturnValue(wait.promise);
    const w = await openPage();
    const button = w
      .findAll("button")
      .find((b) => b.text() === "settings.background.scene.delete")!;
    await button.trigger("click");
    await button.trigger("click");
    expect(confirm).toHaveBeenCalledTimes(1);
    game.currentScene = scene("other");
    wait.resolve(true);
    await flushPromises();
    expect(calls("delete_scene")).toEqual([["delete_scene", { id: "scene-1" }]]);
    expect(game.currentScene.id).toBe("other");
  });
  it("keeps refresh independently locked and does not toast success on list failure", async () => {
    const w = await openPage();
    const wait = deferred<unknown>();
    const error = vi.spyOn(useUIStore(), "showError");
    const success = vi.spyOn(useUIStore(), "showSuccess");
    invokeMock.mockImplementation((cmd) =>
      cmd === "list_scenes" ? wait.promise : Promise.resolve(presets)
    );
    const count = calls("list_scenes").length;
    await w.get('[title="settings.background.scene.refresh"]').trigger("click");
    await w.get('[title="settings.background.scene.refresh"]').trigger("click");
    expect(calls("list_scenes").length - count).toBe(1);
    wait.reject(new Error("list denied"));
    await flushPromises();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "list denied" }));
    expect(success).not.toHaveBeenCalled();
  });
  it("locks background upload independently before reading bytes and retains upload CRUD refresh", async () => {
    const w = await openPage();
    const wait = deferred<void>();
    backgrounds.upload.mockReturnValue(wait.promise);
    const file = new File(["pixels"], "room.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const input = w.get("input[type=file]");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    const lists = calls("list_scenes").length;
    await input.trigger("change");
    await flushPromises();
    await input.trigger("change");
    await flushPromises();
    expect(backgrounds.upload).toHaveBeenCalledTimes(1);
    expect(backgrounds.upload).toHaveBeenCalledWith("room.png", new Uint8Array([1, 2, 3]));
    wait.resolve();
    await flushPromises();
    expect(calls("list_scenes").length).toBe(lists + 1);
  });
  it("keeps opening the backgrounds folder independently locked and toasts errors", async () => {
    const w = await openPage();
    const wait = deferred<void>();
    backgrounds.open.mockReturnValue(wait.promise);
    const error = vi.spyOn(useUIStore(), "showError");
    const button = w
      .findAll("button")
      .find((b) => b.text() === "settings.background.scene.openFolder")!;
    await button.trigger("click");
    await button.trigger("click");
    expect(backgrounds.open).toHaveBeenCalledTimes(1);
    wait.reject(new Error("folder denied"));
    await flushPromises();
    expect(error).toHaveBeenCalled();
  });
  it("keeps the navigation tab named background and switches to the background page", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    try {
      const { default: SettingsNav } = await import("../../SettingsNav.vue");
      const w = mount(SettingsNav, { global: options() });
      await flushPromises();
      const tab = w.findAll("button").find((b) => b.text() === "背景");
      expect(tab).toBeDefined();
      await tab!.trigger("click");
      expect(useUIStore().currentSettingsTab).toBe("background");
      w.unmount();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollTo", original);
      else delete (HTMLElement.prototype as any).scrollTo;
    }
  });
  it("persists the page quality setting across store recreation", async () => {
    const w = await openPage();
    await w
      .findAll("label")
      .find((l) => l.text().includes("简化光影"))!
      .get("input")
      .setValue(true);
    expect(JSON.parse(localStorage.getItem("lingchat-settings")!).display.simplifiedLighting).toBe(
      true
    );
    w.unmount();
    freshPinia();
    expect(useSettingsStore().display.simplifiedLighting).toBe(true);
  });
  it.each(["manual", "ai"] as const)(
    "receives scene-state:changed after saving an identical %s snapshot as default",
    async (source) => {
      game.activeLightingSource = source;
      items[0] = {
        ...items[0]!,
        lighting: JSON.parse(JSON.stringify(game.activeLighting)),
        lighting_preset_id: game.activeLightingPresetId,
        lighting_preset_revision: game.activeLightingPresetRevision,
        lighting_customized: game.activeLightingCustomized,
      };
      game.currentScene = items[0]!;
      const snapshot = JSON.parse(JSON.stringify(game.activeLighting));
      const { tauriMocks } = await import("@/test/setup");
      const { subscribeSceneStateChanged } = await import("@/api/tauri-events");
      const unlisten = await subscribeSceneStateChanged();
      const registrations = tauriMocks.listen.mock.calls as unknown as [
        string,
        (event: { payload: unknown }) => void,
      ][];
      const callback = registrations.find((c) => c[0] === "scene-state:changed")![1];
      const w = await openPage();
      invokeMock.mockImplementation(async (cmd, args) => {
        if (cmd === "update_scene") {
          const req = (args as any).req;
          const s = { ...items[0]!, ...req };
          const { scene_name, scene_description, source, ...persisted } = s;
          callback({
            payload: {
              scene: { ...persisted, name: scene_name, description: scene_description },
              background: s.background,
              active_lighting: s.lighting,
              source: "scene_default",
              preset_id: s.lighting_preset_id,
              preset_revision: s.lighting_preset_revision,
              customized: s.lighting_customized,
              lighting_revision: 9,
            },
          });
          return s;
        }
        return cmd === "list_scenes" ? items : presets;
      });
      try {
        await w.get("[data-save-scene-default]").trigger("click");
        await flushPromises();
        expect(game.currentScene!.id).toBe("scene-1");
        expect(game.lightingRevision).toBe(9);
        expect(game.activeLightingSource).toBe("scene_default");
        expect(game.activeLighting).toEqual(snapshot);
        expect((calls("update_scene")[0]![1] as any).req.apply_lighting_as_default).toBe(true);
        expect(calls("select_scene")).toHaveLength(0);
        expect(calls("restore_scene_lighting")).toHaveLength(0);
        expect(w.get("[data-active-lighting-status]").text()).toContain("场景默认");
      } finally {
        unlisten();
      }
    }
  );
  it("keeps plugin scenes read-only for default saving", async () => {
    game.currentScene = { ...items[0]!, source: "plugin:readonly" };
    const w = await openPage();
    expect(w.get("[data-save-scene-default]").attributes("disabled")).toBeDefined();
    await w.get("[data-save-scene-default]").trigger("click");
    expect(calls("update_scene")).toHaveLength(0);
  });
  it("does not declare a preset deleted before a successful library lookup", async () => {
    const wait = deferred<unknown>();
    invokeMock.mockImplementation((cmd) =>
      cmd === "list_lighting_presets" ? wait.promise : Promise.resolve(items)
    );
    const w = await openPage();
    expect(w.get("[data-active-lighting-status]").text()).not.toContain("来源已删除");
    wait.reject(new Error("library offline"));
    await flushPromises();
    expect(w.get("[data-active-lighting-status]").text()).not.toContain("来源已删除");
  });
  it("allows scene selection while a default save independently waits and does not overwrite the new scene", async () => {
    items.push(scene("other"));
    const w = await openPage();
    const wait = deferred<unknown>();
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "update_scene") return wait.promise;
      if (cmd === "select_scene") {
        const s = items.find((s) => s.id === (args as any).sceneId)!;
        applySceneChangeMessage({
          scene: s,
          background: s.background,
          active_lighting: lighting(),
          source: "scene_default",
          preset_id: s.lighting_preset_id,
          preset_revision: s.lighting_preset_revision,
          customized: false,
          lighting_revision: 9,
        });
        return;
      }
      return cmd === "list_scenes" ? items : presets;
    });
    await w.get("[data-save-scene-default]").trigger("click");
    await w.get('[data-scene-card="other"]').trigger("click");
    await flushPromises();
    expect(calls("select_scene")).toEqual([["select_scene", { sceneId: "other" }]]);
    expect(game.currentScene!.id).toBe("other");
    wait.resolve(items[0]);
    await flushPromises();
    expect(game.currentScene!.id).toBe("other");
    expect(game.lightingRevision).toBe(9);
    expect(game.activeLighting).toEqual(lighting());
    expect(game.activeLightingSource).toBe("scene_default");
    const savedRequest = (calls("update_scene")[0]![1] as any).req;
    expect(savedRequest.id).toBe("scene-1");
    expect(savedRequest.apply_lighting_as_default).toBe(true);
    expect(savedRequest.lighting.master_intensity).toBe(1.8);
    expect(calls("select_scene")).toEqual([["select_scene", { sceneId: "other" }]]);
  });
  it("confirms editor create once before closing and preserves preset metadata in its API payload", async () => {
    const global = options();
    global.stubs.SceneEditModal = false as any;
    const w = mount(SettingsBackground, {
      global: { ...global, stubs: { ...global.stubs, teleport: true, transition: false } },
      attachTo: document.body,
    });
    await flushPromises();
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.background.scene.create")!
      .trigger("click");
    await flushPromises();
    await w.get('[data-editor-fields] [data-preset="user:one"]').trigger("click");
    await w
      .get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]')
      .setValue("New room");
    expect(calls("apply_lighting_preset")).toHaveLength(0);
    const wait = deferred<unknown>();
    invokeMock.mockImplementation((cmd) =>
      cmd === "create_scene"
        ? wait.promise
        : Promise.resolve(cmd === "list_scenes" ? items : presets)
    );
    const save = w.findAll("button").find((b) => b.text() === "settings.sceneEdit.button.create")!;
    await save.trigger("click");
    await save.trigger("click");
    expect(calls("create_scene")).toHaveLength(1);
    expect(w.find('input[placeholder="settings.sceneEdit.placeholder.sceneName"]').exists()).toBe(
      true
    );
    expect((calls("create_scene")[0]![1] as any).req).toEqual({
      scene_name: "New room",
      scene_description: "",
      background: "",
      lighting: presets[0]!.lighting,
      lighting_preset_id: "user:one",
      lighting_preset_revision: 1,
      lighting_customized: false,
    });
    wait.resolve(scene("new"));
    await flushPromises();
    expect(w.find('input[placeholder="settings.sceneEdit.placeholder.sceneName"]').exists()).toBe(
      false
    );
    expect(calls("create_scene")).toHaveLength(1);
  });
  it("keeps saved card pixels independent when source preset values change", async () => {
    items[0]!.lighting = lighting(0.5);
    items[0]!.lighting!.background.brightness = 0.6;
    items[0]!.lighting_preset_id = "user:one";
    const w = await openPage();
    presets = [preset({ lighting: lighting(2), revision: 9 })];
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
    const style = (w.get("[data-card-background]").element as HTMLElement).style;
    expect(style.filter || style.getPropertyValue("-webkit-filter")).toBe("brightness(0.8)");
    expect(calls("resolve_lighting_asset")).toHaveLength(0);
  });
  it("reports background-list failures instead of false refresh success", async () => {
    const w = await openPage();
    const error = vi.spyOn(useUIStore(), "showError");
    const success = vi.spyOn(useUIStore(), "showSuccess");
    backgrounds.list.mockRejectedValue(new Error("backgrounds denied"));
    await w.get('[title="settings.background.scene.refresh"]').trigger("click");
    await flushPromises();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: "backgrounds denied" }));
    expect(success).not.toHaveBeenCalled();
  });
});
