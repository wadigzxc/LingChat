import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SceneEditModal from "../SceneEditModal.vue";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { ui, preset, invokeMock } from "../../lighting/__tests__/fixtures";
import type { LightingParams } from "@/types/scene-lighting";
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));
const roleFixture = vi.hoisted(() => ({
  currentInteractRoleId: null as number | null,
  gameRoles: {} as Record<number, any>,
}));
vi.mock("@/stores/modules/game", () => ({ useGameStore: () => roleFixture }));
const api = vi.hoisted(() => ({
  list: vi.fn<() => Promise<import("@/types/scene-lighting").LightingPreset[]>>(async () => []),
  apply: vi.fn(),
}));
vi.mock("@/api/services/scene-lighting", async (original) => ({
  ...(await original<typeof import("@/api/services/scene-lighting")>()),
  listLightingPresets: api.list,
  applyLightingPreset: api.apply,
}));
const initial = (
  lighting: LightingParams | null = null
): import("@/api/services/scene").SceneLightingMetadata & {
  sceneName: string;
  sceneImage: string | null;
  sceneDescription: string;
  lighting: LightingParams | null;
} => ({
  sceneName: "Room",
  sceneImage: null,
  sceneDescription: "Quiet",
  lighting,
  lighting_preset_id: null,
  lighting_preset_revision: null,
  lighting_customized: false,
});
async function open(data = initial(), extra = {}) {
  const wrapper = mount(SceneEditModal, {
    props: { show: false, mode: "update", backgrounds: [], initialData: data, ...extra },
    global: {
      plugins: [
        createPinia(),
        createI18n({
          legacy: false,
          locale: "zh",
          missingWarn: false,
          fallbackWarn: false,
          messages: { zh: {} },
        }),
      ],
      stubs: { teleport: true, transition: false },
    },
  });
  await wrapper.setProps({ show: true });
  await flushPromises();
  return wrapper;
}
beforeEach(() => {
  api.list.mockResolvedValue([]);
  api.apply.mockClear();
  roleFixture.currentInteractRoleId = null;
  roleFixture.gameRoles = {};
});
describe("scene editor draft", () => {
  it("uses translated save result titles for existing UI toasts", async () => {
    const language = createI18n({
      legacy: false,
      locale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        en: { settings: { lighting: { saved: "Scene saved", saveFailed: "Save failed" } } },
      },
    });
    const saveScene = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce();
    const w = mount(SceneEditModal, {
      props: { show: true, mode: "update", backgrounds: [], initialData: initial(), saveScene },
      global: { plugins: [createPinia(), language], stubs: { teleport: true, transition: false } },
    });
    await flushPromises();
    const save = w.findAll("button").find((b) => b.text() === "settings.sceneEdit.button.update")!;
    await save.trigger("click");
    await flushPromises();
    expect(ui.showError).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Save failed", message: "disk full" })
    );
    await save.trigger("click");
    await flushPromises();
    expect(ui.showSuccess).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Scene saved" })
    );
  });
  it("uses stable asset-field translation keys without a mutable row index", async () => {
    const language = createI18n({
      legacy: false,
      locale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        en: {
          settings: {
            lighting: {
              addAsset: "Add PNG",
              removeAsset: "Remove layer",
              assetHelp: "Existing hashes only",
              fields: { asset_layers_opacity: "Layer opacity" },
            },
          },
        },
      },
    });
    const w = mount(SceneEditModal, {
      props: { show: true, mode: "update", backgrounds: [], initialData: initial() },
      global: { plugins: [createPinia(), language], stubs: { teleport: true, transition: false } },
    });
    await flushPromises();
    expect(w.get("[data-add-asset]").text()).toBe("Add PNG");
    await w.get("[data-add-asset]").trigger("click");
    expect(w.get("[data-remove-asset]").text()).toBe("Remove layer");
    expect(w.get('[data-asset-field="opacity"]').attributes("aria-label")).toBe("Layer opacity");
    expect(w.text()).toContain("Existing hashes only");
  });
  it("localizes built-in provenance names and new editor status strings through fallback keys", async () => {
    const p = preset({ kind: "built_in", i18n_key: "lighting.presets.moon" });
    api.list.mockResolvedValue([p]);
    const language = createI18n({
      legacy: false,
      locale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        en: {
          lighting: { presets: { moon: "Localized moon" } },
          settings: {
            lighting: {
              basedOn: "Based on",
              customized: "Customized",
              systemNeutral: "System neutral",
              sourceDeleted: "Source deleted",
            },
          },
        },
      },
    });
    const w = mount(SceneEditModal, {
      props: { show: true, mode: "update", backgrounds: [], initialData: initial() },
      global: { plugins: [createPinia(), language], stubs: { teleport: true, transition: false } },
    });
    await flushPromises();
    expect(w.get("[data-provenance]").text()).toBe("System neutral");
    await w.get('[data-preset="user:one"]').trigger("click");
    await w.get('[aria-label="总强度"]').setValue(0.7);
    expect(w.get("[data-provenance]").text()).toBe("Based on Localized moon，Customized");
  });
  it("exposes a keyboard-accessible named close button and translated dirty confirmation", async () => {
    const language = createI18n({
      legacy: false,
      locale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        en: {
          settings: {
            lighting: {
              close: "Close editor",
              unsavedDraft: "Unsaved draft",
              save: "Save",
              discard: "Discard",
              cancel: "Cancel",
            },
          },
        },
      },
    });
    const w = mount(SceneEditModal, {
      props: { show: true, mode: "update", backgrounds: [], initialData: initial() },
      global: { plugins: [createPinia(), language], stubs: { teleport: true, transition: false } },
    });
    await flushPromises();
    expect(w.find('button[aria-label="Close editor"]').exists()).toBe(true);
    await w.get('[aria-label="总强度"]').setValue(0.7);
    await w.get('button[aria-label="Close editor"]').trigger("click");
    expect(w.get('[role="alertdialog"]').attributes("aria-label")).toBe("Unsaved draft");
    expect(w.get("[data-draft-save]").text()).toBe("Save");
    expect(w.get("[data-draft-discard]").text()).toBe("Discard");
    expect(w.get("[data-draft-cancel]").text()).toBe("Cancel");
  });
  it("allows typing an incomplete hex color before committing on change", async () => {
    const w = await open(initial(createNeutralLighting()));
    const color = w.get('[aria-label="角色环境色"]');
    (color.element as HTMLInputElement).value = "#12";
    await color.trigger("input");
    expect(color.element).toHaveProperty("value", "#12");
    (color.element as HTMLInputElement).value = "#123456";
    await color.trigger("change");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: { character_ambient: { color: "#123456" } },
    });
  });
  it("treats the trimmed saved draft as clean before executing a pending preset choice", async () => {
    const p = preset();
    api.list.mockResolvedValue([p]);
    const saveScene = vi.fn(async () => {});
    const w = await open(initial(createNeutralLighting()), { saveScene });
    await w.get('[aria-label="场景名称"]').setValue("  Room  ");
    await w.get('[data-preset="user:one"]').trigger("click");
    await w.get("[data-draft-save]").trigger("click");
    await flushPromises();
    expect(w.get('[aria-label="场景名称"]').element).toHaveProperty("value", "Room");
    await w.get("[data-restore-neutral]").trigger("click");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.cancel")!
      .trigger("click");
    // Returning to the previously saved neutral snapshot must not prompt for a whitespace-only dirty difference.
    expect(w.find('[role="alertdialog"]').exists()).toBe(false);
    expect(w.emitted("close")).toHaveLength(1);
  });
  it("does not overwrite a dirty draft if parent reopens after its close request was canceled", async () => {
    const w = await open();
    await w.get('[aria-label="场景名称"]').setValue("Keep this draft");
    await w.setProps({ show: false });
    await w.get("[data-draft-cancel]").trigger("click");
    await w.setProps({ show: true });
    expect(w.get('[aria-label="场景名称"]').element).toHaveProperty("value", "Keep this draft");
  });
  it("ignores stale avatar requests after the accepted preview scene changes", async () => {
    roleFixture.currentInteractRoleId = 1;
    roleFixture.gameRoles[1] = { character_folder: "Alice", emotion: "正常", clothesName: "默认" };
    let old!: (path: string) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          old = r;
        })
    );
    const w = await open();
    invokeMock.mockResolvedValue("C:/new-avatar.png");
    await w.setProps({ initialData: { ...initial(), sceneName: "New" } });
    await flushPromises();
    old("C:/stale-avatar.png");
    await flushPromises();
    expect(w.get("[data-preview-avatar]").attributes("src")).toContain(
      encodeURIComponent("C:/new-avatar.png")
    );
    expect(w.find('img[src*="stale-avatar"]').exists()).toBe(false);
  });
  it("uses existing lighting fallback keys when locale translations are available", async () => {
    const language = createI18n({
      legacy: false,
      locale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: {
        en: {
          settings: {
            lighting: {
              editorTitle: "Scene and lighting",
              overall: "Overall",
              character: "Character",
              scene: "Scene",
              assets: "Assets",
              restorePreset: "Restore preset",
              restoreNeutral: "Neutral",
              fields: { master_intensity: "Master" },
            },
          },
        },
      },
    });
    const w = mount(SceneEditModal, {
      props: { show: true, mode: "update", backgrounds: [], initialData: initial() },
      global: { plugins: [createPinia(), language], stubs: { teleport: true, transition: false } },
    });
    await flushPromises();
    expect(w.get('[role="dialog"]').attributes("aria-label")).toBe("Scene and lighting");
    expect(w.findAll("legend").map((n) => n.text())).toEqual([
      "Overall",
      "Character",
      "Scene",
      "Assets",
    ]);
    expect(w.get("[data-restore-preset]").text()).toBe("Restore preset");
    expect(w.get("[data-restore-neutral]").text()).toBe("Neutral");
    expect(w.find('[aria-label="Master"]').exists()).toBe(true);
  });
  it("protects unsaved drafts on keyboard Escape as well as pointer close", async () => {
    const w = await open();
    await w.get('[aria-label="总强度"]').setValue(0.6);
    await w.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
    expect(w.emitted("close")).toBeUndefined();
  });
  it("uses translated scene-and-lighting editor labels with fallback keys", async () => {
    const w = await open();
    expect(w.get('[role="dialog"]').attributes("aria-label")).toBe("编辑场景及光影");
    expect(w.find('[aria-label="场景名称"]').exists()).toBe(true);
    expect(w.find('[aria-label="场景描述"]').exists()).toBe(true);
    expect(w.find('[aria-label="场景图片"]').exists()).toBe(true);
  });
  it("locks editing and dragging while an asynchronous save is in flight", async () => {
    let complete!: () => void;
    const saveScene = () =>
      new Promise<void>((r) => {
        complete = r;
      });
    const w = await open(initial(), { saveScene });
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.get("[data-editor-fields]").attributes("disabled")).toBeDefined();
    expect(w.get("[data-drag-light-position]").attributes("disabled")).toBeDefined();
    complete();
    await flushPromises();
    expect(w.emitted("close")).toHaveLength(1);
  });
  it("locks confirmation actions while saving so discard cannot lose the accepted draft", async () => {
    let reject!: (reason: Error) => void;
    const saveScene = () =>
      new Promise<void>((_, r) => {
        reject = r;
      });
    const w = await open(initial(), { saveScene });
    await w.get('[aria-label="总强度"]').setValue(0.5);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.cancel")!
      .trigger("click");
    await w.get("[data-draft-save]").trigger("click");
    expect(w.get("[data-draft-discard]").attributes("disabled")).toBeDefined();
    expect(w.get("[data-draft-cancel]").attributes("disabled")).toBeDefined();
    reject(new Error("failed"));
    await flushPromises();
    expect(w.get('[aria-label="总强度"]').element).toHaveProperty("value", "0.5");
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
  });
  it("previews the real static role resolved through existing avatar IPC including role placement", async () => {
    roleFixture.currentInteractRoleId = 1;
    roleFixture.gameRoles[1] = {
      character_folder: "Alice",
      emotion: "正常",
      clothesName: "默认",
      offsetX: 12,
      offsetY: 8,
      scale: 1.2,
    };
    invokeMock.mockResolvedValue("C:/Alice/normal.png");
    const w = await open();
    expect(invokeMock).toHaveBeenCalledWith("get_avatar_file", {
      characterFolder: "Alice",
      emotion: "正常",
      clothesName: "default",
    });
    expect(w.get("[data-preview-avatar]").attributes("src")).toContain(
      encodeURIComponent("C:/Alice/normal.png")
    );
    expect(w.get("[data-lighting-frame]").attributes("style")).toContain("scale(1.2)");
  });
  it("previews the selected scene background through the shared draft renderer", async () => {
    const w = await open(
      { ...initial(), sceneImage: "C:/room.png" },
      { backgrounds: [{ title: "New", url: "C:/new.png" }] }
    );
    expect(w.findComponent({ name: "SceneLightingPreview" }).exists()).toBe(true);
    expect(w.get("[data-preview-background]").attributes("src")).toContain(
      encodeURIComponent("C:/room.png")
    );
    await w.get("select").setValue("C:/new.png");
    expect(w.get("[data-preview-background]").attributes("src")).toContain(
      encodeURIComponent("C:/new.png")
    );
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.upload")!
      .trigger("click");
    expect(w.emitted("upload")).toHaveLength(1);
  });
  it("removes a layer from the draft without modifying the scene's asset list", async () => {
    const w = await open();
    await w.get("[data-add-asset]").trigger("click");
    await w.get("[data-remove-asset]").trigger("click");
    expect(w.findAll("[data-asset-row]")).toHaveLength(0);
  });
  it("limits asset additions to eight layers", async () => {
    const w = await open();
    for (let i = 0; i < 10; i++) await w.get("[data-add-asset]").trigger("click");
    expect(w.findAll("[data-asset-row]")).toHaveLength(8);
    expect(w.get("[data-add-asset]").attributes("disabled")).toBeDefined();
  });
  it("adds hash-addressed PNG layers and edits the complete asset wire fields without mutating input", async () => {
    const source = initial(createNeutralLighting());
    const before = JSON.stringify(source);
    const w = await open(source);
    await w.get("[data-add-asset]").trigger("click");
    const row = w.get("[data-asset-row]");
    for (const [field, value] of [
      ["asset_hash", "a".repeat(64)],
      ["target", "character"],
      ["placement", "front"],
      ["z_index", 7],
      ["fit", "contain"],
      ["opacity", 0.6],
      ["blend_mode", "add"],
      ["required", true],
    ] as const)
      await row.get(`[data-asset-field="${field}"]`).setValue(value);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        asset_layers: [
          {
            id: expect.any(String),
            asset_hash: "a".repeat(64),
            media_type: "image/png",
            target: "character",
            placement: "front",
            z_index: 7,
            fit: "contain",
            opacity: 0.6,
            blend_mode: "add",
            required: true,
          },
        ],
      },
    });
    expect(JSON.stringify(source)).toBe(before);
  });
  it("linking never backfills differences and mirrors only subsequent user color input", async () => {
    const l = createNeutralLighting();
    l.link_character_background = false;
    l.character.brightness = 1.2;
    l.background.brightness = 0.7;
    const w = await open(initial(l));
    await w.get('[aria-label="联动角色与场景"]').setValue(true);
    expect(w.get('[aria-label="场景亮度"]').element).toHaveProperty("value", "0.7");
    await w.get('[aria-label="角色亮度"]').setValue(1.4);
    expect(w.get('[aria-label="场景亮度"]').element).toHaveProperty("value", "1.4");
    await w.get('[aria-label="场景环境色"]').setValue("#abc123");
    expect(w.get('[aria-label="角色环境色"]').element).toHaveProperty("value", "#abc123");
    await w.get('[aria-label="联动角色与场景"]').setValue(false);
    await w.get('[aria-label="角色亮度"]').setValue(1.8);
    expect(w.get('[aria-label="场景亮度"]').element).toHaveProperty("value", "1.4");
    expect(l.background.brightness).toBe(0.7);
  });
  it("scene bloom controls edit the same single bloom as character controls", async () => {
    const w = await open();
    for (const [label, value] of [
      ["场景泛光启用", true],
      ["场景泛光目标", "background"],
      ["场景泛光色", "#224488"],
      ["场景泛光半径", 32],
      ["场景泛光强度", 0.8],
    ] as const)
      await w.get(`[aria-label="${label}"]`).setValue(value);
    expect(w.get('[aria-label="角色泛光目标"]').element).toHaveProperty("value", "background");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        bloom: {
          enabled: true,
          target: "background",
          color: "#224488",
          radius: 32,
          intensity: 0.8,
        },
      },
    });
  });
  it("edits scene ambient color and opacity", async () => {
    const w = await open();
    for (const [label, value] of [
      ["场景环境色启用", true],
      ["场景环境色", "#224488"],
      ["场景环境色透明度", 0.25],
    ] as const)
      await w.get(`[aria-label="${label}"]`).setValue(value);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: { background_ambient: { enabled: true, color: "#224488", opacity: 0.25 } },
    });
  });
  it("edits all background color controls in the scene group", async () => {
    const w = await open();
    for (const [label, value] of [
      ["场景亮度", 1.5],
      ["场景对比度", 0.8],
      ["场景饱和度", 0.5],
      ["场景褐色", 0.2],
      ["场景旧泛光半径", 12],
      ["场景旧泛光色", "#fedcba"],
    ] as const)
      await w.get(`[aria-label="${label}"]`).setValue(value);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        background: {
          brightness: 1.5,
          contrast: 0.8,
          saturation: 0.5,
          sepia: 0.2,
          glow_radius: 12,
          glow_color: "#fedcba",
        },
      },
    });
  });
  it("edits the shared bloom parameters in the character group", async () => {
    const w = await open();
    for (const [label, value] of [
      ["角色泛光启用", true],
      ["角色泛光目标", "character"],
      ["角色泛光色", "#112233"],
      ["角色泛光半径", 64],
      ["角色泛光强度", 0.7],
    ] as const)
      await w.get(`[aria-label="${label}"]`).setValue(value);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        bloom: { enabled: true, target: "character", color: "#112233", radius: 64, intensity: 0.7 },
      },
    });
  });
  it("edits directional rim lighting with 64px and 2x intensity limits", async () => {
    const w = await open();
    for (const [label, value] of [
      ["轮廓光启用", true],
      ["轮廓光色", "#abcdef"],
      ["轮廓光强度", 1.5],
      ["轮廓光宽度", 64],
      ["轮廓光柔和度", 32],
      ["轮廓光角度", 90],
      ["轮廓光偏移", 16],
    ] as const)
      await w.get(`[aria-label="${label}"]`).setValue(value);
    expect(w.get('[aria-label="轮廓光宽度"]').attributes("max")).toBe("64");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        rim_light: {
          enabled: true,
          color: "#abcdef",
          intensity: 1.5,
          width: 64,
          softness: 32,
          angle: 90,
          offset: 16,
        },
      },
    });
  });
  it("edits character ambient independently of background ambient", async () => {
    const l = createNeutralLighting();
    l.link_character_background = false;
    const w = await open(initial(l));
    await w.get('[aria-label="角色环境色启用"]').setValue(true);
    await w.get('[aria-label="角色环境色"]').setValue("#223344");
    await w.get('[aria-label="角色环境色透明度"]').setValue(0.4);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        character_ambient: { enabled: true, color: "#223344", opacity: 0.4 },
        background_ambient: createNeutralLighting().background_ambient,
      },
    });
  });
  it("edits character color correction within the Rust-normalized ranges", async () => {
    const w = await open();
    for (const [label, value] of [
      ["角色亮度", 1.6],
      ["角色对比度", 1.2],
      ["角色饱和度", 2],
      ["角色褐色", 0.3],
      ["角色旧泛光半径", 25],
      ["角色旧泛光色", "#aabbcc"],
    ] as const)
      await w.get(`[aria-label="${label}"]`).setValue(value);
    expect(w.get('[aria-label="角色亮度"]').attributes()).toMatchObject({
      min: "0.3",
      max: "2.2",
      step: "0.01",
    });
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        character: {
          brightness: 1.6,
          contrast: 1.2,
          saturation: 2,
          sepia: 0.3,
          glow_radius: 25,
          glow_color: "#aabbcc",
        },
      },
    });
  });
  it("edits the full vignette without changing main-light parameters", async () => {
    const w = await open();
    for (const [label, value] of [
      ["暗角启用", true],
      ["暗角色", "#123456"],
      ["暗角强度", 0.6],
      ["暗角半径", 0.4],
      ["暗角柔和度", 0.2],
    ] as const)
      await w.get(`[aria-label="${label}"]`).setValue(value);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        vignette: { enabled: true, color: "#123456", intensity: 0.6, radius: 0.4, softness: 0.2 },
        main_light: createNeutralLighting().main_light,
      },
    });
  });
  it("exposes radial and linear main-light wire controls in the overall group", async () => {
    const w = await open();
    await w.get('[aria-label="主光形状"]').setValue("linear");
    await w.get('[aria-label="主光角度"]').setValue(120);
    await w.get('[aria-label="主光位置X"]').setValue(0.2);
    await w.get('[aria-label="主光目标"]').setValue("background");
    await w.get('[aria-label="主光混合"]').setValue("soft_light");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: {
        main_light: {
          shape: "linear",
          angle: 120,
          x: 0.2,
          target: "background",
          blend_mode: "soft_light",
        },
      },
    });
    for (const label of [
      "主光启用",
      "主光位置Y",
      "主光半径",
      "主光起始色",
      "主光结束色",
      "主光透明度",
    ])
      expect(w.find(`[aria-label="${label}"]`).exists()).toBe(true);
  });
  it("guards changing presets on a dirty draft with discard and cancel", async () => {
    const p = preset();
    api.list.mockResolvedValue([p]);
    const w = await open();
    await w.get('[aria-label="总强度"]').setValue(0.5);
    await w.get('[data-preset="user:one"]').trigger("click");
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
    await w.get("[data-draft-cancel]").trigger("click");
    expect(w.get('[aria-label="总强度"]').element).toHaveProperty("value", "0.5");
    await w.get('[data-preset="user:one"]').trigger("click");
    await w.get("[data-draft-discard]").trigger("click");
    expect(w.get("[data-provenance]").text()).toContain("Moon");
    expect(api.apply).not.toHaveBeenCalled();
  });
  it("disables deleted-source restore while retaining the saved snapshot", async () => {
    const p = preset();
    const w = await open({ ...initial(p.lighting), lighting_preset_id: p.id });
    expect(w.get("[data-restore-preset]").attributes("disabled")).toBeDefined();
    expect(w.get("[data-provenance]").text()).toContain("来源已删除");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: p.lighting,
      lighting_preset_id: p.id,
    });
  });
  it("restores the latest source preset separately from system neutral", async () => {
    const p = preset({ revision: 8 });
    p.lighting.master_intensity = 1.3;
    api.list.mockResolvedValue([p]);
    const w = await open({
      ...initial(p.lighting),
      lighting_preset_id: p.id,
      lighting_preset_revision: 3,
      lighting_customized: true,
    });
    await w.get("[data-restore-preset]").trigger("click");
    expect(w.get('[aria-label="总强度"]').element).toHaveProperty("value", "1.3");
    expect(w.get("[data-provenance]").text()).not.toContain("已自定义");
    await w.get("[data-restore-neutral]").trigger("click");
    expect(w.get('[aria-label="总强度"]').element).toHaveProperty("value", "1");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: createNeutralLighting(),
      lighting_preset_id: null,
      lighting_preset_revision: null,
      lighting_customized: false,
    });
  });
  it("marks manual changes as based on the selected preset and customized", async () => {
    const p = preset();
    api.list.mockResolvedValue([p]);
    const w = await open();
    await w.get('[data-preset="user:one"]').trigger("click");
    await w.get('[aria-label="总强度"]').setValue(0.5);
    expect(w.get("[data-provenance]").text()).toContain("Moon");
    expect(w.get("[data-provenance]").text()).toContain("已自定义");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting_preset_id: p.id,
      lighting_preset_revision: p.revision,
      lighting_customized: true,
    });
  });
  it("selects a preset only into the draft with correct provenance", async () => {
    const p = preset({ revision: 7 });
    api.list.mockResolvedValue([p]);
    const w = await open();
    await w.get('[data-preset="user:one"]').trigger("click");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: p.lighting,
      lighting_preset_id: p.id,
      lighting_preset_revision: 7,
      lighting_customized: false,
    });
    expect(api.apply).not.toHaveBeenCalled();
    expect(p.lighting).toEqual(preset().lighting);
  });
  it("keeps dirty content visible when the parent requests closing", async () => {
    const w = await open();
    await w.get('[aria-label="总强度"]').setValue(0.5);
    await w.setProps({ show: false });
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
    await w.get("[data-draft-cancel]").trigger("click");
    expect(w.find('[aria-label="总强度"]').exists()).toBe(true);
  });
  it("runs the pending switch only after saving the correct old-scene payload successfully", async () => {
    let resolve!: () => void;
    const saveScene = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const w = await open(initial(), { sceneKey: "old", saveScene });
    await w
      .get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]')
      .setValue("Saved old");
    await w.setProps({
      initialData: { ...initial(), sceneName: "New scene" },
      sceneKey: "new",
    } as any);
    await w.get("[data-draft-save]").trigger("click");
    expect(w.emitted("submit")).toBeUndefined();
    resolve();
    await flushPromises();
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({ sceneName: "Saved old" });
    expect(w.find('[role="alertdialog"]').exists()).toBe(false);
    expect(
      w.get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]').element
    ).toHaveProperty("value", "New scene");
  });
  it("waits for async save and never runs the pending scene switch on failure", async () => {
    let reject!: (reason: Error) => void;
    const saveScene = vi.fn(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        })
    );
    const w = await open(initial(), { sceneKey: "old", saveScene });
    await w
      .get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]')
      .setValue("Saved old");
    await w.setProps({
      initialData: { ...initial(), sceneName: "New scene" },
      sceneKey: "new",
    } as any);
    await w.get("[data-draft-save]").trigger("click");
    expect(saveScene).toHaveBeenCalledWith(expect.objectContaining({ sceneName: "Saved old" }), {
      sceneKey: "old",
      mode: "update",
    });
    expect(w.get("[data-draft-save]").attributes("disabled")).toBeDefined();
    reject(new Error("disk full"));
    await flushPromises();
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
    expect(
      w.get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]').element
    ).toHaveProperty("value", "Saved old");
  });
  it("retains the old scene draft when parent scene props change until discard", async () => {
    const w = await open(initial(), { sceneKey: "old" });
    await w
      .get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]')
      .setValue("Edited old");
    await w.setProps({
      initialData: { ...initial(), sceneName: "New scene" },
      sceneKey: "new",
    } as any);
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
    expect(
      w.get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]').element
    ).toHaveProperty("value", "Edited old");
    await w.get("[data-draft-discard]").trigger("click");
    expect(
      w.get('input[placeholder="settings.sceneEdit.placeholder.sceneName"]').element
    ).toHaveProperty("value", "New scene");
  });
  it("guards dirty close with cancel preserving edits and discard leaving source untouched", async () => {
    const source = initial(createNeutralLighting());
    const before = JSON.stringify(source);
    const w = await open(source);
    await w.get('[aria-label="总强度"]').setValue(0.5);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.cancel")!
      .trigger("click");
    expect(w.find('[role="alertdialog"]').exists()).toBe(true);
    expect(w.emitted("close")).toBeUndefined();
    await w.get("[data-draft-cancel]").trigger("click");
    expect(w.find('[role="alertdialog"]').exists()).toBe(false);
    expect(w.get('[aria-label="总强度"]').element).toHaveProperty("value", "0.5");
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.cancel")!
      .trigger("click");
    await w.get("[data-draft-discard]").trigger("click");
    expect(w.emitted("close")).toHaveLength(1);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("edits overall master in a deep draft without scaling stored children", async () => {
    const l = createNeutralLighting();
    l.enabled = true;
    l.character.brightness = 1.4;
    const before = JSON.stringify(l);
    const w = await open(initial(l));
    await w.get('[aria-label="总强度"]').setValue(0.5);
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: { master_intensity: 0.5, character: { brightness: 1.4 } },
    });
    expect(JSON.stringify(l)).toBe(before);
  });
  it("opening a scene without lighting saves null instead of enabling lighting", async () => {
    const w = await open();
    await w
      .findAll("button")
      .find((b) => b.text() === "settings.sceneEdit.button.update")!
      .trigger("click");
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: null,
      lighting_customized: false,
    });
  });
});
