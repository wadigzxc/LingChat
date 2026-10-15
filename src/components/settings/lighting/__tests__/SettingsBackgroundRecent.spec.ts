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
import SceneEditModal from "../../scene/SceneEditModal.vue";
import { useGameStore } from "@/stores/modules/game";
import { useSettingsStore } from "@/stores/modules/settings";
import { useUIStore } from "@/stores/modules/ui/ui";
import { scene, lighting } from "@/test/scene-lighting-fixtures";
import { preset, invokeMock } from "./fixtures";
import { applySceneChangeMessage } from "@/api/websocket/handlers/script-handler";
import { updateScene, type UpdateSceneRequest } from "@/api/services/scene";
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
  localStorage.clear();
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
describe("Task3 success refresh", () => {
  it("records an explicit identical editor save through authority without promoting temporary lighting", async () => {
    items = [
      {
        ...scene("scene-1", presets[0]!.lighting),
        lighting_preset_id: "user:one",
        lighting_preset_revision: 1,
      },
    ];
    game.currentScene = items[0]!;
    const runtime = JSON.stringify({
      lighting: game.activeLighting,
      source: game.activeLightingSource,
    });
    const before = JSON.stringify(presets);
    const savedAt = "2026-10-14T00:00:00.001Z";
    let fail = true;
    // Native boundary mirrors backend same-value intent; no UI-owned usage write.
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "list_scenes") return items;
      if (cmd === "list_lighting_presets") return presets;
      if (cmd === "update_scene") {
        const req = args!.req as UpdateSceneRequest & { lighting_save_intent?: boolean };
        expect(req.lighting).toEqual(items[0]!.lighting);
        expect(req.lighting_preset_id).toBe(items[0]!.lighting_preset_id);
        expect(req.lighting_preset_revision).toBe(items[0]!.lighting_preset_revision);
        expect(req.lighting_customized).toBe(items[0]!.lighting_customized);
        if (fail) throw new Error("identical save denied");
        if (req.lighting_save_intent === true)
          presets = [{ ...presets[0]!, last_used_at: savedAt }];
        return items[0];
      }
      return {};
    });
    const global = options();
    global.stubs.SceneEditModal = false as any;
    const w = mount(SettingsBackground, {
      global: { ...global, stubs: { ...global.stubs, teleport: true, transition: false } },
      attachTo: document.body,
    });
    await flushPromises();
    const selector = w.getComponent(LightingPresetSelect);
    const element = selector.element;
    await w.get('[data-scene-card="scene-1"] button').trigger("click");
    await flushPromises();
    const editor = w.getComponent(SceneEditModal);
    const reads = calls("list_lighting_presets").length;
    const save = editor
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!;
    // No preset selection or field edit: existing valid source and snapshot are identical.
    await save.trigger("click");
    await flushPromises();
    expect(calls("update_scene")).toHaveLength(1);
    const req = (calls("update_scene")[0]![1] as { req: UpdateSceneRequest }).req;
    expect(req).toEqual({
      id: "scene-1",
      scene_name: items[0]!.scene_name,
      scene_description: items[0]!.scene_description,
      background: items[0]!.background,
      lighting: items[0]!.lighting,
      lighting_preset_id: "user:one",
      lighting_preset_revision: 1,
      lighting_customized: false,
      lighting_save_intent: true,
    });
    expect(req).not.toHaveProperty("apply_lighting_as_default");
    expect(calls("list_lighting_presets")).toHaveLength(reads);
    expect(JSON.stringify(presets)).toBe(before);
    expect(editor.get("[data-editor-save-error]").text()).toContain("identical save denied");
    fail = false;
    await save.trigger("click");
    await flushPromises();
    expect(calls("update_scene")).toHaveLength(2);
    expect(calls("list_lighting_presets").length).toBeGreaterThan(reads);
    const loaded = selector.emitted("loaded")!;
    expect(loaded[loaded.length - 1]![0]).toEqual([{ ...preset(), last_used_at: savedAt }]);
    expect(selector.element).toBe(element);
    expect(
      JSON.stringify({ lighting: game.activeLighting, source: game.activeLightingSource })
    ).toBe(runtime);
    expect(calls("apply_lighting_preset")).toHaveLength(0);
    expect(calls("mark_lighting_preset_used")).toHaveLength(0);
    w.unmount();
  });
  it("omits editor and default intent for ordinary metadata API updates", async () => {
    const original = items[0]!;
    const req: UpdateSceneRequest = {
      id: original.id,
      scene_name: "Renamed metadata",
      scene_description: original.scene_description,
      background: original.background!,
      lighting: original.lighting,
      lighting_preset_id: original.lighting_preset_id,
      lighting_preset_revision: original.lighting_preset_revision,
      lighting_customized: original.lighting_customized,
    };
    await updateScene(req);
    expect(calls("update_scene")[0]![1]).toEqual({ req });
    expect(req).not.toHaveProperty("lighting_save_intent");
    expect(req).not.toHaveProperty("apply_lighting_as_default");
  });
  it.each(["create", "update"] as const)(
    "keeps the editor %s draft and recent records on failure, then refreshes on retry",
    async (mode) => {
      const global = options();
      global.stubs.SceneEditModal = false as any;
      const w = mount(SettingsBackground, {
        global: { ...global, stubs: { ...global.stubs, teleport: true, transition: false } },
        attachTo: document.body,
      });
      await flushPromises();
      await w.getComponent(LightingPresetSelect).get("[data-sort]").setValue("recently_used");
      if (mode === "create")
        await w
          .findAll("button")
          .find((b) => b.text() === "settings.background.scene.create")!
          .trigger("click");
      else await w.get('[data-scene-card="scene-1"] button').trigger("click");
      await flushPromises();
      const editor = w.getComponent(SceneEditModal);
      expect((editor.get("[data-sort]").element as HTMLSelectElement).value).toBe("recently_used");
      await editor.get('[data-preset="user:one"]').trigger("click");
      await editor.get('[aria-label="场景名称"]').setValue("Preserved draft");
      const baseline = JSON.stringify(presets);
      const reads = calls("list_lighting_presets").length;
      const success = vi.spyOn(useUIStore(), "showSuccess");
      const wait = deferred<unknown>();
      invokeMock.mockImplementation((cmd) =>
        cmd === `${mode}_scene`
          ? wait.promise
          : Promise.resolve(cmd === "list_scenes" ? items : presets)
      );
      const save = editor
        .findAll("button")
        .find((b) => b.text() === `settings.sceneEdit.button.${mode}`)!;
      await save.trigger("click");
      await save.trigger("click");
      expect(calls(`${mode}_scene`)).toHaveLength(1);
      wait.reject(new Error("save denied"));
      await flushPromises();
      expect(calls("list_lighting_presets")).toHaveLength(reads);
      expect(JSON.stringify(presets)).toBe(baseline);
      expect((editor.get('[aria-label="场景名称"]').element as HTMLInputElement).value).toBe(
        "Preserved draft"
      );
      expect(editor.get("[data-editor-save-error]").text()).toContain("save denied");
      expect(success).not.toHaveBeenCalled();
      invokeMock.mockImplementation(async (cmd) =>
        cmd === "list_scenes" ? items : cmd === "list_lighting_presets" ? presets : items[0]
      );
      await save.trigger("click");
      await flushPromises();
      expect(calls(`${mode}_scene`)).toHaveLength(2);
      expect(calls("list_lighting_presets").length).toBeGreaterThan(reads);
      expect(calls("apply_lighting_preset")).toHaveLength(0);
      expect(calls("mark_lighting_preset_used")).toHaveLength(0);
      w.unmount();
    }
  );
  it("does not refresh recent records when default saving fails", async () => {
    const w = await openPage();
    const reads = calls("list_lighting_presets").length;
    const baseline = JSON.stringify(presets);
    const success = vi.spyOn(useUIStore(), "showSuccess");
    invokeMock.mockRejectedValueOnce(new Error("save denied"));
    await w.get("[data-save-scene-default]").trigger("click");
    await flushPromises();
    expect(calls("list_lighting_presets")).toHaveLength(reads);
    expect(JSON.stringify(presets)).toBe(baseline);
    expect(success).not.toHaveBeenCalled();
    expect(w.get("[data-save-scene-default]").attributes("disabled")).toBeUndefined();
    w.unmount();
  });
  it.each([
    ["create", false],
    ["create", true],
    ["update", false],
    ["update", true],
  ] as const)(
    "does not refresh or notify after pending editor %s is unmounted (failure=%s)",
    async (mode, failure) => {
      const global = options();
      global.stubs.SceneEditModal = false as any;
      const w = mount(SettingsBackground, {
        global: { ...global, stubs: { ...global.stubs, teleport: true, transition: false } },
        attachTo: document.body,
      });
      await flushPromises();
      if (mode === "create")
        await w
          .findAll("button")
          .find((b) => b.text() === "settings.background.scene.create")!
          .trigger("click");
      else await w.get('[data-scene-card="scene-1"] button').trigger("click");
      await flushPromises();
      const editor = w.getComponent(SceneEditModal);
      await editor.get('[aria-label="场景名称"]').setValue("Draft");
      const wait = deferred<unknown>();
      invokeMock.mockImplementation((cmd) =>
        cmd === `${mode}_scene`
          ? wait.promise
          : Promise.resolve(cmd === "list_scenes" ? items : presets)
      );
      const success = vi.spyOn(useUIStore(), "showSuccess");
      const error = vi.spyOn(useUIStore(), "showError");

      await editor
        .findAll("button")
        .find((b) => b.text() === `settings.sceneEdit.button.${mode}`)!
        .trigger("click");
      const reads = calls("list_scenes").length;
      w.unmount();
      if (failure) wait.reject(new Error("late editor failure"));
      else wait.resolve(items[0]);
      await flushPromises();
      expect(calls("list_scenes")).toHaveLength(reads);
      expect(success).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(editor.emitted("submit")).toBeUndefined();
      expect(editor.emitted("close")).toBeUndefined();
    }
  );
  it.each([false, true])(
    "ignores default-save completion after unmount (failure=%s)",
    async (failure) => {
      const w = await openPage();
      const wait = deferred<unknown>();
      invokeMock.mockImplementation((cmd) =>
        cmd === "update_scene"
          ? wait.promise
          : Promise.resolve(cmd === "list_scenes" ? items : presets)
      );
      const success = vi.spyOn(useUIStore(), "showSuccess");
      const error = vi.spyOn(useUIStore(), "showError");
      await w.get("[data-save-scene-default]").trigger("click");
      const reads = calls("list_scenes").length;
      const catalogReads = calls("list_lighting_presets").length;
      w.unmount();
      if (failure) wait.reject(new Error("late failure"));
      else wait.resolve(items[0]);
      await flushPromises();
      expect(success).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(calls("list_scenes")).toHaveLength(reads);
      expect(calls("list_lighting_presets")).toHaveLength(catalogReads);
    }
  );
  it.each(["manual", "ai"] as const)(
    "refreshes after an authoritative %s application event while preserving open editor drafts",
    async (source) => {
      const global = options();
      global.stubs.SceneEditModal = false as any;
      const w = mount(SettingsBackground, {
        global: { ...global, stubs: { ...global.stubs, teleport: false, transition: false } },
        attachTo: document.body,
      });
      await flushPromises();
      await w.get('[data-scene-card="scene-1"] button').trigger("click");
      await flushPromises();
      const editor = w.getComponent(SceneEditModal);
      const editorDom = new DOMWrapper(document.body.querySelector("[data-editor-dialog]")!);
      const name = editorDom.get('[aria-label="场景名称"]');
      await name.setValue("Unsaved draft");
      const element = name.element;
      const reads = calls("list_lighting_presets").length;
      presets = [{ ...presets[0]!, last_used_at: "2026-10-14T00:00:00.000001Z" }];
      applySceneChangeMessage({
        scene: items[0]!,
        background: "scene-1.png",
        active_lighting: lighting(1.2),
        source,
        preset_id: "user:one",
        preset_revision: 1,
        customized: false,
        lighting_revision: 9,
      });
      await flushPromises();
      expect(calls("list_lighting_presets").length).toBeGreaterThan(reads);
      const selector = w.getComponent(LightingPresetSelect);
      const loaded = selector.emitted("loaded")!;
      expect(loaded[loaded.length - 1]![0]).toEqual(presets);
      expect(document.body.querySelector('[data-editor-dialog] [aria-label="场景名称"]')).toBe(
        element
      );
      expect((element as HTMLInputElement).value).toBe("Unsaved draft");
      expect(calls("update_scene")).toHaveLength(0);
      expect(calls("apply_lighting_preset")).toHaveLength(0);
      w.unmount();
    }
  );
  it.each(["create", "update"] as const)(
    "refreshes visible recent records after editor %s without remounting the settings selector",
    async (mode) => {
      const global = options();
      global.stubs.SceneEditModal = false as any;
      const w = mount(SettingsBackground, {
        global: { ...global, stubs: { ...global.stubs, teleport: true, transition: false } },
        attachTo: document.body,
      });
      await flushPromises();
      const selector = w.getComponent(LightingPresetSelect);
      const element = selector.element;
      await selector.get("[data-sort]").setValue("recently_used");
      if (mode === "create")
        await w
          .findAll("button")
          .find((b) => b.text() === "settings.background.scene.create")!
          .trigger("click");
      else await w.get('[data-scene-card="scene-1"] button').trigger("click");
      await flushPromises();
      const editor = w.getComponent(SceneEditModal);
      await editor.get('[data-preset="user:one"]').trigger("click");
      await editor.get('[aria-label="场景名称"]').setValue("Saved room");
      const reads = calls("list_lighting_presets").length;
      expect(calls("apply_lighting_preset")).toHaveLength(0);
      const wait = deferred<unknown>();
      invokeMock.mockImplementation(async (cmd) => {
        if (cmd === `${mode}_scene`) return wait.promise;
        return cmd === "list_scenes" ? items : presets;
      });
      await editor
        .findAll("button")
        .find((b) => b.text() === `settings.sceneEdit.button.${mode}`)!
        .trigger("click");
      expect(calls("list_lighting_presets")).toHaveLength(reads);
      presets = [{ ...presets[0]!, last_used_at: "2026-10-14T00:00:00.000001Z" }];
      wait.resolve(items[0]);
      await flushPromises();
      expect(calls("list_lighting_presets").length).toBeGreaterThan(reads);
      const loaded = selector.emitted("loaded")!;
      expect(loaded[loaded.length - 1]![0]).toEqual(presets);
      expect(w.getComponent(LightingPresetSelect).element).toBe(element);
      expect((selector.get("[data-sort]").element as HTMLSelectElement).value).toBe(
        "recently_used"
      );
      expect((calls(`${mode}_scene`)[0]![1] as any).req.lighting_preset_id).toBe("user:one");
      expect(calls("mark_lighting_preset_used")).toHaveLength(0);
      w.unmount();
    }
  );
  it("refreshes authoritative recent order only after default save succeeds", async () => {
    presets = [
      preset({ id: "user:a", name: "Alpha", last_used_at: "2026-10-13T00:00:00Z" }),
      preset({ name: "Zulu" }),
    ];
    const w = await openPage();
    await w.get("[data-sort]").setValue("recently_used");
    const wait = deferred<unknown>();
    const reads = calls("list_lighting_presets").length;
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "update_scene") return wait.promise;
      return cmd === "list_scenes" ? items : presets;
    });
    await w.get("[data-save-scene-default]").trigger("click");
    await w.get("[data-save-scene-default]").trigger("click");
    expect(calls("update_scene")).toHaveLength(1);
    expect(calls("list_lighting_presets")).toHaveLength(reads);
    presets = [presets[0]!, { ...presets[1]!, last_used_at: "2026-10-14T00:00:00Z" }];
    wait.resolve(items[0]);
    await flushPromises();
    expect(calls("list_lighting_presets")).toHaveLength(reads + 1);
    expect(w.findAll("[data-preset]").map((row) => row.attributes("data-preset"))).toEqual([
      "user:one",
      "user:a",
    ]);
    expect((w.get("[data-sort]").element as HTMLSelectElement).value).toBe("recently_used");
    expect(calls("update_scene")[0]![1]).toMatchObject({
      req: { apply_lighting_as_default: true },
    });
    expect(calls("mark_lighting_preset_used")).toHaveLength(0);
    w.unmount();
  });
});
