import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeMock } from "./fixtures";
import { preset, globalOptions, ui } from "./fixtures";
import LightingPresetSelect from "../LightingPresetSelect.vue";
vi.mock("@/stores/modules/ui/ui", async () => ({ useUIStore: () => ui }));
beforeEach(() => {
  invokeMock.mockResolvedValue([preset()]);
});
describe("LightingPresetSelect DOM", () => {
  it("displays the preset name category color marker and tags", async () => {
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    const row = w.get('[data-preset="user:one"]');
    expect(row.text()).toContain("Moon");
    expect(row.text()).toContain("cinematic");
    expect(row.text()).toContain("cool");
    expect(row.get("[data-color]").attributes("style")).toContain("background-color");
    expect(invokeMock).toHaveBeenCalledWith("list_lighting_presets", { sort: "favorite_first" });
  });
  it("searches names aliases tags and descriptions with escaped highlighting", async () => {
    invokeMock.mockResolvedValue([
      preset({ name: "<img src=x onerror=alert(1)> Moon" }),
      preset({ id: "other", name: "Sun", description: "Bright", aliases: [], tags: [] }),
    ]);
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    for (const query of ["Moon", "NIGHT", "cool", "evening", "<img"]) {
      await w.get("[data-search]").setValue(query);
      expect(w.findAll("[data-preset]")).toHaveLength(1);
      expect(
        w
          .get('[data-preset="user:one"]')
          .findAll("mark")
          .map((m) => m.text())
          .join("")
          .toLowerCase()
      ).toContain(query.toLowerCase());
    }
    expect(w.find("img").exists()).toBe(false);
    await w.get("[data-search]").setValue("missing");
    expect(w.findAll("[data-preset]")).toHaveLength(0);
  });
  it("orders options by favorites recent use and name without mutating inputs", async () => {
    const items = [
      preset({ id: "a", name: "Alpha", last_used_at: "2020-01-01" }),
      preset({ id: "z", name: "Zulu", favorite: true, last_used_at: "2021-01-01" }),
      preset({ id: "b", name: "Beta" }),
    ];
    const original = JSON.stringify(items);
    invokeMock.mockResolvedValue(items);
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    const ids = () => w.findAll("[data-preset]").map((r) => r.attributes("data-preset"));
    expect(ids()).toEqual(["z", "a", "b"]);
    await w.get("[data-sort]").setValue("name");
    expect(ids()).toEqual(["a", "b", "z"]);
    await w.get("[data-sort]").setValue("recently_used");
    expect(ids()).toEqual(["z", "a", "b"]);
    expect(JSON.stringify(items)).toBe(original);
  });
  it("applies only runtime lighting and reports success through the existing toast", async () => {
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "list_lighting_presets" ? [preset()] : {}
    );
    await w.get('[data-preset="user:one"]').trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("apply_lighting_preset", { id: "user:one" });
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      "apply_lighting_preset",
      "list_lighting_presets",
    ]);
    expect(ui.showSuccess).toHaveBeenCalledWith(expect.objectContaining({ duration: 2000 }));
  });
  it("guards repeated apply and recovers after an IPC failure with an error toast", async () => {
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    let reject!: (reason: Error) => void;
    invokeMock.mockImplementation((cmd) =>
      cmd === "apply_lighting_preset"
        ? new Promise((_, r) => {
            reject = r;
          })
        : Promise.resolve([preset()])
    );
    await w.get('[data-preset="user:one"]').trigger("click");
    await w.get('[data-preset="user:one"]').trigger("click");
    expect(invokeMock.mock.calls.filter((c) => c[0] === "apply_lighting_preset")).toHaveLength(1);
    reject(new Error("denied"));
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "denied", duration: 3000 })
    );
    expect(w.get('[data-preset="user:one"]').attributes("disabled")).toBeUndefined();
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "list_lighting_presets" ? [preset()] : {}
    );
    await w.get('[data-preset="user:one"]').trigger("click");
    await flushPromises();
    expect(invokeMock.mock.calls.filter((c) => c[0] === "apply_lighting_preset")).toHaveLength(2);
  });
  it("uses localized builtin display names for rendering and search", async () => {
    invokeMock.mockResolvedValue([
      preset({ kind: "built_in", i18n_key: "lighting.moon", name: "Moon" }),
    ]);
    const global = globalOptions();
    global.plugins[0].global.setLocaleMessage("zh-CN", { lighting: { moon: "月夜" } });
    const w = mount(LightingPresetSelect, { global });
    await flushPromises();
    expect(w.get("[data-preset]").text()).toContain("月夜");
    await w.get("[data-search]").setValue("月夜");
    expect(w.get("mark").text()).toBe("月夜");
  });
  it("shows a retry action after a failed list request instead of an unhandled rejection", async () => {
    invokeMock.mockRejectedValueOnce(new Error("list failed"));
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "list failed", duration: 3000 })
    );
    invokeMock.mockResolvedValue([preset()]);
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
    expect(w.find('[data-preset="user:one"]').exists()).toBe(true);
  });
  it("marks the active preset without confusing it with a saved scene source", async () => {
    const w = mount(LightingPresetSelect, {
      props: { activePresetId: "user:one" },
      global: globalOptions(),
    });
    await flushPromises();
    expect(w.get('[data-preset="user:one"]').attributes("aria-selected")).toBe("true");
    await w.setProps({ activePresetId: null });
    expect(w.get('[data-preset="user:one"]').attributes("aria-selected")).toBe("false");
  });
  it("provides a collapsible searchable dropdown rather than a permanently expanded library", async () => {
    const w = mount(LightingPresetSelect, { global: globalOptions(), attachTo: document.body });
    await flushPromises();
    await w.get("[data-toggle-presets]").trigger("click");
    expect(w.get("details").attributes("open")).toBeUndefined();
    await w.get("[data-toggle-presets]").trigger("click");
    expect(w.get("details").attributes("open")).toBeDefined();
    expect(w.find("[data-search]").exists()).toBe(true);
  });
  it("queues a library refresh that arrives during another pending request", async () => {
    let resolve!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const w = mount(LightingPresetSelect, { props: { refreshKey: 0 }, global: globalOptions() });
    await w.setProps({ refreshKey: 1 });
    invokeMock.mockResolvedValue([preset({ name: "Newest" })]);
    resolve([preset({ name: "Old" })]);
    await flushPromises();
    expect(w.get('[data-preset="user:one"]').text()).toContain("Newest");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
