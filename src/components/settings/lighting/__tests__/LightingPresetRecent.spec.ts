import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "vue";
import { createI18n } from "vue-i18n";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { persist } from "@/stores/plugins/persist";
import { useSettingsStore } from "@/stores/modules/settings";
import { invokeMock, preset, globalOptions, ui } from "./fixtures";
import LightingPresetSelect from "../LightingPresetSelect.vue";
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));

function freshApp() {
  const pinia = createPinia().use(persist);
  const app = createApp({ render: () => null }).use(pinia);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  setActivePinia(pinia);
  return { pinia, app, root };
}
function rows(w: ReturnType<typeof mount>) {
  return w.findAll("[data-preset]").map((row) => row.attributes("data-preset"));
}
beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([
    preset({ id: "user:a", name: "Alpha", favorite: true }),
    preset({
      id: "builtin:z",
      kind: "built_in",
      name: "Zulu",
      last_used_at: "2026-10-14T00:00:00.000001Z",
    }),
  ]);
});
describe("Task3 recent preference", () => {
  it.each([
    ["equal instants", "2026-10-14T08:00:00+08:00", "2026-10-14T00:00:00.000000000Z"],
    ["invalid records", "not-a-time", ""],
    ["missing records", null, null],
  ])(
    "breaks %s ties by display name then stable id even when readback reverses",
    async (_, firstTime, secondTime) => {
      const instance = freshApp();
      const listed = [
        preset({ id: "user:z", name: "Same", last_used_at: firstTime }),
        preset({ id: "builtin:a", kind: "built_in", name: "Same", last_used_at: secondTime }),
        preset({ id: "user:alpha", name: "Alpha", last_used_at: firstTime }),
      ];
      invokeMock.mockResolvedValue(listed);
      const w = mount(LightingPresetSelect, { global: globalOptions() });
      await flushPromises();
      await w.get("[data-sort]").setValue("recently_used");
      const expected = ["user:alpha", "builtin:a", "user:z"];
      expect(rows(w)).toEqual(expected);
      invokeMock.mockResolvedValue([...listed].reverse());
      await w.get("[data-reload]").trigger("click");
      await flushPromises();
      expect(rows(w)).toEqual(expected);
      w.unmount();
      instance.app.unmount();
      disposePinia(instance.pinia);
      instance.root.remove();
    }
  );
  it.each([
    ["microseconds", "2026-10-14T08:00:00.000001+08:00", "2026-10-14T00:00:00.000002Z"],
    ["nanoseconds", "2026-10-14T00:00:00.123456788Z", "2026-10-14T00:00:00.123456789Z"],
  ])("retains legacy %s order inside a JavaScript millisecond", async (_, older, newer) => {
    const instance = freshApp();
    invokeMock.mockResolvedValue([
      preset({ id: "user:older", name: "Alpha", last_used_at: older }),
      preset({ id: "builtin:newer", name: "Zulu", kind: "built_in", last_used_at: newer }),
    ]);
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    await w.get("[data-sort]").setValue("recently_used");
    expect(rows(w)).toEqual(["builtin:newer", "user:older"]);
    w.unmount();
    instance.app.unmount();
    disposePinia(instance.pinia);
    instance.root.remove();
  });
  it("orders valid usage ahead of invalid records and gives invalid/null groups stable name fallbacks", async () => {
    const instance = freshApp();
    const listed = [
      preset({ id: "user:invalid-beta", name: "Beta", last_used_at: "not-a-time" }),
      preset({ id: "user:null-beta", name: "Beta" }),
      preset({ id: "user:invalid-alpha", name: "Alpha", last_used_at: "" }),
      preset({ id: "user:null-alpha", name: "Alpha" }),
      preset({
        id: "builtin:valid",
        kind: "built_in",
        name: "Zulu",
        last_used_at: "2026-10-14T00:00:00Z",
      }),
    ];
    invokeMock.mockResolvedValue(listed);
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    await w.get("[data-sort]").setValue("recently_used");
    // Mirrors backend Option presence first, parsed instant next, then name/id.
    const expected = [
      "builtin:valid",
      "user:invalid-alpha",
      "user:invalid-beta",
      "user:null-alpha",
      "user:null-beta",
    ];
    expect(rows(w)).toEqual(expected);
    invokeMock.mockResolvedValue([...listed].reverse());
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
    expect(rows(w)).toEqual(expected);
    w.unmount();
    instance.app.unmount();
    disposePinia(instance.pinia);
    instance.root.remove();
  });
  it.each([
    ["seconds precision", "2026-10-14T00:00:00Z", "2026-10-14T00:00:00.500Z"],
    ["offset", "2026-10-14T08:00:00+08:00", "2026-10-14T00:30:00Z"],
  ])("sorts legacy %s timestamps by their actual RFC3339 instants", async (_, older, newer) => {
    const instance = freshApp();
    const listed = [
      preset({ id: "user:older", name: "Alpha", last_used_at: older }),
      preset({ id: "builtin:newer", name: "Zulu", kind: "built_in", last_used_at: newer }),
    ];
    invokeMock.mockResolvedValue(listed);
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    await w.get("[data-sort]").setValue("recently_used");
    expect(rows(w)).toEqual(["builtin:newer", "user:older"]);
    expect(w.emitted("loaded")![0]![0]).toEqual(listed);
    expect(invokeMock.mock.calls.every(([cmd]) => cmd === "list_lighting_presets")).toBe(true);
    w.unmount();
    instance.app.unmount();
    disposePinia(instance.pinia);
    instance.root.remove();
  });
  it("keeps the legacy settings default and preserves recent sort across refresh, language and favorites", async () => {
    localStorage.setItem(
      "lingchat-settings",
      JSON.stringify({ display: { locale: "ja", simplifiedLighting: true } })
    );
    const instance = freshApp();
    const global = {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": {}, en: {} } })],
    };
    const w = mount(LightingPresetSelect, { global });
    await flushPromises();
    expect((w.get("[data-sort]").element as HTMLSelectElement).value).toBe("favorite_first");
    expect(useSettingsStore().display.simplifiedLighting).toBe(true);
    await w.get("[data-sort]").setValue("recently_used");
    const items = [
      preset({ id: "user:a", name: "Alpha", favorite: true }),
      preset({
        id: "builtin:z",
        name: "Zulu",
        kind: "built_in",
        last_used_at: "2026-10-14T00:00:00.000001Z",
      }),
    ];
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === "list_lighting_presets") return items;
      if (cmd === "set_lighting_preset_favorite")
        return { ...items.find((p) => p.id === args?.id)!, favorite: args?.favorite };
      throw new Error(`Unexpected command: ${cmd}`);
    });
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
    global.plugins[0].global.locale.value = "en";
    await flushPromises();
    await w.get('[data-favorite="builtin:z"]').trigger("click");
    await flushPromises();
    expect((w.get("[data-sort]").element as HTMLSelectElement).value).toBe("recently_used");
    expect(rows(w)).toEqual(["builtin:z", "user:a"]);
    expect(items.map((p) => p.last_used_at)).toEqual([null, "2026-10-14T00:00:00.000001Z"]);
    expect(
      invokeMock.mock.calls.every(([cmd]) =>
        ["list_lighting_presets", "set_lighting_preset_favorite"].includes(cmd)
      )
    ).toBe(true);
    w.unmount();
    instance.app.unmount();
    disposePinia(instance.pinia);
    instance.root.remove();
  });
  it("uses only successful manual-apply readback for recent order and retains records on apply/list failures", async () => {
    const instance = freshApp();
    const original = [
      preset({ id: "user:a", name: "Alpha", last_used_at: "2026-10-13T00:00:00Z" }),
      preset({ id: "builtin:z", name: "Zulu", kind: "built_in" }),
    ];
    invokeMock.mockResolvedValue(original);
    const w = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    await w.get("[data-sort]").setValue("recently_used");
    const snapshot = JSON.stringify(original);
    let reject!: (error: Error) => void;
    invokeMock.mockImplementation((cmd) =>
      cmd === "apply_lighting_preset"
        ? new Promise((_, no) => {
            reject = no;
          })
        : Promise.resolve(original)
    );
    await w.get('[data-preset="builtin:z"]').trigger("click");
    await w.get('[data-preset="builtin:z"]').trigger("click");
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "apply_lighting_preset")).toHaveLength(
      1
    );
    expect(rows(w)).toEqual(["user:a", "builtin:z"]);
    const reads = invokeMock.mock.calls.filter(([cmd]) => cmd === "list_lighting_presets").length;
    reject(new Error("apply denied"));
    await flushPromises();
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "list_lighting_presets")).toHaveLength(
      reads
    );
    expect(rows(w)).toEqual(["user:a", "builtin:z"]);
    const recent = [original[0]!, { ...original[1]!, last_used_at: "2026-10-14T00:00:00.000001Z" }];
    invokeMock.mockImplementation(async (cmd) => (cmd === "list_lighting_presets" ? recent : {}));
    await w.get('[data-preset="builtin:z"]').trigger("click");
    await flushPromises();
    expect(rows(w)).toEqual(["builtin:z", "user:a"]);
    invokeMock.mockRejectedValueOnce(new Error("list denied"));
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
    expect(rows(w)).toEqual(["builtin:z", "user:a"]);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(
      invokeMock.mock.calls.every(([cmd]) =>
        ["list_lighting_presets", "apply_lighting_preset"].includes(cmd)
      )
    ).toBe(true);
    w.unmount();
    instance.app.unmount();
    disposePinia(instance.pinia);
    instance.root.remove();
  });
  it.each([false, true])(
    "does not read or emit after an apply settles on an unmounted selector (failure=%s)",
    async (failure) => {
      const instance = freshApp();
      const onLoaded = vi.fn();
      const w = mount(LightingPresetSelect, { props: { onLoaded }, global: globalOptions() });
      await flushPromises();
      let resolve!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      const wait = new Promise((ok, no) => {
        resolve = ok;
        reject = no;
      });
      invokeMock.mockImplementation((cmd) =>
        cmd === "apply_lighting_preset" ? wait : Promise.resolve([])
      );
      ui.showSuccess.mockClear();
      ui.showError.mockClear();
      await w.get('[data-preset="user:a"]').trigger("click");
      const loaded = onLoaded.mock.calls.length;
      const reads = invokeMock.mock.calls.filter(([cmd]) => cmd === "list_lighting_presets").length;
      w.unmount();
      if (failure) reject(new Error("late apply failure"));
      else resolve({});
      await flushPromises();
      expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "list_lighting_presets")).toHaveLength(
        reads
      );
      expect(onLoaded).toHaveBeenCalledTimes(loaded);
      expect(ui.showSuccess).not.toHaveBeenCalled();
      expect(ui.showError).not.toHaveBeenCalled();
      instance.app.unmount();
      disposePinia(instance.pinia);
      instance.root.remove();
    }
  );
  it("shares selector sort through real persisted settings and restores it after app recreation", async () => {
    const first = freshApp();
    const settings = mount(LightingPresetSelect, { global: globalOptions() });
    const editor = mount(LightingPresetSelect, {
      props: { draftOnly: true },
      global: globalOptions(),
    });
    await flushPromises();
    expect((settings.get("[data-sort]").element as HTMLSelectElement).value).toBe("favorite_first");
    await settings.get("[data-sort]").setValue("recently_used");
    expect((editor.get("[data-sort]").element as HTMLSelectElement).value).toBe("recently_used");
    expect(rows(editor)).toEqual(["builtin:z", "user:a"]);
    await flushPromises();
    expect(JSON.parse(localStorage.getItem("lingchat-settings")!).display.lightingPresetSort).toBe(
      "recently_used"
    );
    settings.unmount();
    editor.unmount();
    first.app.unmount();
    disposePinia(first.pinia);
    first.root.remove();
    const second = freshApp();
    const restored = mount(LightingPresetSelect, { global: globalOptions() });
    await flushPromises();
    expect((restored.get("[data-sort]").element as HTMLSelectElement).value).toBe("recently_used");
    expect(rows(restored)).toEqual(["builtin:z", "user:a"]);
    expect(useSettingsStore().display).not.toHaveProperty("last_used_at");
    restored.unmount();
    second.app.unmount();
    disposePinia(second.pinia);
    second.root.remove();
  });
});
