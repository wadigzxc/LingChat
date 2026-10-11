import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeMock } from "./fixtures";
import { preset, globalOptions, ui, picker } from "./fixtures";
import LightingPresetManager from "../LightingPresetManager.vue";
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => picker.open(...args),
  save: (...args: unknown[]) => picker.save(...args),
}));
beforeEach(() => {
  invokeMock.mockImplementation(async (cmd) =>
    cmd === "list_lighting_presets" ? [preset()] : preset()
  );
  picker.open.mockReset();
  picker.save.mockReset();
});
describe("LightingPresetManager DOM", () => {
  it("creates a user preset from a detached active lighting snapshot", async () => {
    const active = preset().lighting;
    active.master_intensity = 1.7;
    const original = JSON.stringify(active);
    const w = mount(LightingPresetManager, {
      attachTo: document.body,
      props: { activeLighting: active },
      global: globalOptions(),
    });
    await flushPromises();
    await w.get("[data-create]").trigger("click");
    await w.get("[data-name]").setValue("My light");
    await w.get("[data-save]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("create_lighting_preset", {
      draft: expect.objectContaining({ name: "My light", lighting: active }),
    });
    const payload = invokeMock.mock.calls.find((c) => c[0] === "create_lighting_preset")?.[1] as {
      draft: { lighting: unknown };
    };
    expect(payload.draft.lighting).not.toBe(active);
    expect(JSON.stringify(active)).toBe(original);
    expect(ui.showSuccess).toHaveBeenCalledWith(expect.objectContaining({ duration: 2000 }));
  });
  it("updates and renames a user preset while preserving the original snapshot", async () => {
    const item = preset();
    const original = JSON.stringify(item);
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "list_lighting_presets" ? [item] : preset()
    );
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    await w.get("[data-name]").setValue("Renamed");
    await w.get("[data-description]").setValue("My description");
    await w.get("[data-tags]").setValue("warm, light");
    await w.get("[data-aliases]").setValue("Gold, Dawn");
    await w.get("[data-category]").setValue("day");
    await w.get("[data-intensity]").setValue("1.3");
    expect(JSON.stringify(item)).toBe(original);
    await w.get("[data-save]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("update_lighting_preset", {
      id: "user:one",
      update: expect.objectContaining({
        name: "Renamed",
        description: "My description",
        tags: ["warm", "light"],
        aliases: ["Gold", "Dawn"],
        category: "day",
        lighting: expect.objectContaining({ master_intensity: 1.3 }),
      }),
    });
    expect(invokeMock.mock.calls.some((c) => c[0] === "create_lighting_preset")).toBe(false);
  });
  it("forces editing builtin presets to save a new user copy", async () => {
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "list_lighting_presets"
        ? [preset({ id: "builtin:neutral", kind: "built_in" })]
        : preset()
    );
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="builtin:neutral"]').trigger("click");
    expect(w.get("[data-save]").text()).toContain("另存");
    await w.get("[data-save]").trigger("click");
    await flushPromises();
    expect(invokeMock.mock.calls.some((c) => c[0] === "create_lighting_preset")).toBe(true);
    expect(invokeMock.mock.calls.some((c) => c[0] === "update_lighting_preset")).toBe(false);
    expect(w.find('[data-delete="builtin:neutral"]').exists()).toBe(false);
  });
  it("requires an explicit delete confirmation and reloads after deleting a user preset", async () => {
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get('[data-delete="user:one"]').trigger("click");
    expect(invokeMock.mock.calls.some((c) => c[0] === "delete_lighting_preset")).toBe(false);
    await w.get("[data-cancel-delete]").trigger("click");
    expect(w.find("[data-confirm-delete]").exists()).toBe(false);
    await w.get('[data-delete="user:one"]').trigger("click");
    await w.get("[data-confirm-delete]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("delete_lighting_preset", { id: "user:one" });
    expect(ui.showSuccess).toHaveBeenCalledWith(expect.objectContaining({ duration: 2000 }));
  });
  it("toggles user favorite using only the preset update API", async () => {
    const item = preset();
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    await w.get('[data-favorite="user:one"]').trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("update_lighting_preset", {
      id: "user:one",
      update: { favorite: true },
    });
    expect(item.favorite).toBe(false);
  });
  it("blocks duplicate writes and keeps the draft editable after a failed save", async () => {
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    await w.get("[data-name]").setValue("Retry name");
    let reject!: (reason: Error) => void;
    invokeMock.mockImplementation((cmd) =>
      cmd === "update_lighting_preset"
        ? new Promise((_, r) => {
            reject = r;
          })
        : Promise.resolve([preset()])
    );
    await w.get("[data-save]").trigger("click");
    await w.get("[data-save]").trigger("click");
    expect(invokeMock.mock.calls.filter((c) => c[0] === "update_lighting_preset")).toHaveLength(1);
    reject(new Error("write denied"));
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "write denied", duration: 3000 })
    );
    expect((w.get("[data-name]").element as HTMLInputElement).value).toBe("Retry name");
    expect(w.get("[data-save]").attributes("disabled")).toBeUndefined();
  });
  it("can discard a detached edit without sending a write", async () => {
    const item = preset();
    invokeMock.mockResolvedValue([item]);
    const before = JSON.stringify(item);
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    await w.get("[data-name]").setValue("discarded");
    await w.get("[data-cancel-edit]").trigger("click");
    expect(w.find("[data-name]").exists()).toBe(false);
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(["list_lighting_presets"]);
    expect(JSON.stringify(item)).toBe(before);
  });
  it("exports a single user preset via the native save picker without any scene fields", async () => {
    picker.save.mockResolvedValue("C:/chosen/moon.linglight");
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    await w.get('[data-export="user:one"]').trigger("click");
    await flushPromises();
    expect(picker.save).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ name: "LingLight", extensions: ["linglight"] }] })
    );
    expect(invokeMock).toHaveBeenCalledWith("export_linglight", {
      presetId: "user:one",
      targetPath: "C:/chosen/moon.linglight",
    });
  });
  it("batch exports only selected user presets to independent packages and reports item errors", async () => {
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "list_lighting_presets"
        ? [
            preset(),
            preset({ id: "two", name: "Second" }),
            preset({ id: "builtin:neutral", kind: "built_in" }),
          ]
        : {
            items: [
              { preset_id: "user:one", path: "C:/out/one.linglight", error: null },
              { preset_id: "two", path: null, error: "missing asset" },
            ],
          }
    );
    picker.open.mockResolvedValue("C:/out");
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    expect(w.find('[data-export="builtin:neutral"]').exists()).toBe(false);
    expect(w.find('[data-select="builtin:neutral"]').exists()).toBe(false);
    await w.get('[data-select="user:one"]').setValue(true);
    await w.get('[data-select="two"]').setValue(true);
    await w.get("[data-export-batch]").trigger("click");
    await flushPromises();
    expect(picker.open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false })
    );
    expect(invokeMock).toHaveBeenCalledWith("export_linglights", {
      presetIds: ["user:one", "two"],
      targetDir: "C:/out",
    });
    expect(ui.showWarning).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("missing asset"), duration: 3000 })
    );
  });
  it("silently cancels native export pickers without IPC or a failure toast", async () => {
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    invokeMock.mockClear();
    ui.showError.mockClear();
    ui.showSuccess.mockClear();
    picker.save.mockResolvedValue(null);
    await w.get('[data-export="user:one"]').trigger("click");
    await flushPromises();
    await w.get('[data-select="user:one"]').setValue(true);
    picker.open.mockResolvedValue(null);
    await w.get("[data-export-batch]").trigger("click");
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(ui.showError).not.toHaveBeenCalled();
    expect(ui.showSuccess).not.toHaveBeenCalled();
    expect(w.get('[data-export="user:one"]').attributes("disabled")).toBeUndefined();
  });
  it("hides archive exports on mobile while leaving preset CRUD available", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android");
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    expect(w.find('[data-export="user:one"]').exists()).toBe(false);
    expect(w.find("[data-export-batch]").exists()).toBe(false);
    expect(w.find("[data-select]").exists()).toBe(false);
    expect(w.find("[data-create]").exists()).toBe(true);
  });
  it("integrates the actual two-phase import component and reloads only after explicit commit", async () => {
    const { inspection } = await import("./fixtures");
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "list_lighting_presets"
        ? [preset()]
        : cmd === "inspect_linglight"
          ? inspection()
          : { preset: preset(), warnings: [] }
    );
    picker.open.mockResolvedValue("C:/in.linglight");
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    await w.get("[data-open-import]").trigger("click");
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    expect(invokeMock.mock.calls.filter((c) => c[0] === "list_lighting_presets")).toHaveLength(1);
    await w.get("[data-confirm-import]").trigger("click");
    await flushPromises();
    expect(invokeMock.mock.calls.filter((c) => c[0] === "list_lighting_presets")).toHaveLength(2);
    expect(w.emitted("changed")).toHaveLength(1);
  });
  it("lets users explicitly replace a draft lighting snapshot with current active lighting", async () => {
    const active = preset().lighting;
    active.main_light.opacity = 0.75;
    const original = JSON.stringify(active);
    const w = mount(LightingPresetManager, {
      props: { activeLighting: active },
      attachTo: document.body,
      global: globalOptions(),
    });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    await w.get("[data-use-active]").trigger("click");
    await w.get("[data-lighting-enabled]").setValue(true);
    await w.get("[data-save]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("update_lighting_preset", {
      id: "user:one",
      update: expect.objectContaining({
        lighting: expect.objectContaining({
          enabled: true,
          main_light: expect.objectContaining({ opacity: 0.75 }),
        }),
      }),
    });
    expect(JSON.stringify(active)).toBe(original);
  });
  it("edits the complete lighting snapshot JSON without rebuilding the scene editor", async () => {
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    const lighting = preset().lighting;
    lighting.rim_light.enabled = true;
    lighting.rim_light.angle = 120;
    await w.get("[data-lighting-json]").setValue(JSON.stringify(lighting));
    await w.get("[data-apply-json]").trigger("click");
    await w.get("[data-save]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("update_lighting_preset", {
      id: "user:one",
      update: expect.objectContaining({ lighting }),
    });
  });
  it("rejects invalid snapshot JSON rather than silently replacing the draft with defaults", async () => {
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    for (const text of ["null", "[]", "{}", "{bad"]) {
      ui.showError.mockClear();
      await w.get("[data-lighting-json]").setValue(text);
      await w.get("[data-apply-json]").trigger("click");
      await flushPromises();
      expect(ui.showError).toHaveBeenCalled();
      expect((w.get("[data-intensity]").element as HTMLInputElement).value).toBe("1");
    }
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(["list_lighting_presets"]);
  });
  it("rejects blank preset names without a write and keeps the draft", async () => {
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get("[data-create]").trigger("click");
    await w.get("[data-name]").setValue("   ");
    await w.get("form").trigger("submit");
    await flushPromises();
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(["list_lighting_presets"]);
    expect(w.find("[data-name]").exists()).toBe(true);
    expect(ui.showError).toHaveBeenCalled();
  });
  it("locks draft switching and editing controls while a preset write is pending", async () => {
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    let resolve!: (value: unknown) => void;
    invokeMock.mockImplementation((cmd) =>
      cmd === "update_lighting_preset"
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve([preset()])
    );
    await w.get("[data-save]").trigger("click");
    expect(w.get("[data-create]").attributes("disabled")).toBeDefined();
    expect(w.get('[data-edit="user:one"]').attributes("disabled")).toBeDefined();
    expect(w.get("fieldset").attributes("disabled")).toBeDefined();
    await w.get("[data-create]").trigger("click");
    expect((w.get("[data-name]").element as HTMLInputElement).value).toBe("Moon");
    resolve(preset());
    await flushPromises();
  });
  it("can save a user preset edit as a new copy without overwriting the source", async () => {
    const w = mount(LightingPresetManager, { attachTo: document.body, global: globalOptions() });
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    await w.get("[data-name]").setValue("Copy");
    await w.get("[data-save-as]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("create_lighting_preset", {
      draft: expect.objectContaining({ name: "Copy" }),
    });
    expect(invokeMock.mock.calls.some((c) => c[0] === "update_lighting_preset")).toBe(false);
  });
  it("keeps delete confirmation available after a backend deletion failure", async () => {
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    await w.get('[data-delete="user:one"]').trigger("click");
    invokeMock.mockRejectedValueOnce(new Error("delete denied"));
    await w.get("[data-confirm-delete]").trigger("click");
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "delete denied", duration: 3000 })
    );
    expect(w.find("[data-confirm-delete]").exists()).toBe(true);
  });
  it("uses the translated builtin name for the library and save-as draft", async () => {
    invokeMock.mockResolvedValue([
      preset({ kind: "built_in", id: "builtin:moon", i18n_key: "lighting.presets.moonlight" }),
    ]);
    const global = globalOptions();
    global.plugins[0].global.setLocaleMessage("zh-CN", {
      lighting: { presets: { moonlight: "月夜" } },
    });
    const w = mount(LightingPresetManager, { global });
    await flushPromises();
    expect(w.get('[data-row="builtin:moon"]').text()).toContain("月夜");
    await w.get('[data-edit="builtin:moon"]').trigger("click");
    expect((w.get("[data-name]").element as HTMLInputElement).value).toBe("月夜");
  });
  it("retries loading the library after an initial IPC failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("library unavailable"));
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "library unavailable" })
    );
    invokeMock.mockResolvedValue([preset()]);
    await w.get("[data-refresh-library]").trigger("click");
    await flushPromises();
    expect(w.find('[data-row="user:one"]').exists()).toBe(true);
  });
  it("reports export IPC failure and unlocks the picker for retry", async () => {
    picker.save.mockResolvedValue("C:/out.linglight");
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    invokeMock.mockRejectedValueOnce(new Error("export denied"));
    await w.get('[data-export="user:one"]').trigger("click");
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "export denied", duration: 3000 })
    );
    expect(w.get('[data-export="user:one"]').attributes("disabled")).toBeUndefined();
  });
  it("does not change favorite presentation when the backend update fails", async () => {
    const item = preset();
    invokeMock.mockResolvedValue([item]);
    const w = mount(LightingPresetManager, { global: globalOptions() });
    await flushPromises();
    invokeMock.mockRejectedValueOnce(new Error("favorite denied"));
    await w.get('[data-favorite="user:one"]').trigger("click");
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "favorite denied" })
    );
    expect(w.get('[data-favorite="user:one"]').attributes("aria-pressed")).toBe("false");
    expect(item.favorite).toBe(false);
  });
});
