import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeMock, preset, globalOptions, ui } from "./fixtures";
import LightingPresetSelect from "../LightingPresetSelect.vue";
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));

// Real Vue DOM and command-boundary mocks, not native persistence acceptance.
beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockReset();
});
describe("independent preset favorites", () => {
  it.each([false, true])(
    "keeps pending favorites unchanged, retries errors, and ignores a response after unmount (failure=%s)",
    async (failure) => {
      const item = preset({ id: "builtin:z", kind: "built_in", name: "Zulu" });
      let settle!: (value: unknown) => void;
      let reject!: (reason: Error) => void;
      invokeMock.mockImplementation((command) =>
        command === "list_lighting_presets"
          ? Promise.resolve([item])
          : new Promise((resolve, fail) => {
              settle = resolve;
              reject = fail;
            })
      );
      const loaded = vi.fn();
      const w = mount(LightingPresetSelect, {
        props: { draftOnly: true, onLoaded: loaded },
        global: globalOptions(),
      });
      await flushPromises();
      const star = w.get('[data-favorite="builtin:z"]');
      await star.trigger("click");
      await star.trigger("click");
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === "set_lighting_preset_favorite")
      ).toEqual([["set_lighting_preset_favorite", { id: "builtin:z", favorite: true }]]);
      expect(star.attributes("aria-pressed")).toBe("false");
      expect(star.attributes("disabled")).toBeDefined();
      reject(new Error("favorite denied"));
      await flushPromises();
      expect(ui.showError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "favorite denied" })
      );
      expect(star.attributes("aria-pressed")).toBe("false");
      expect(star.attributes("disabled")).toBeUndefined();
      await star.trigger("click");
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === "set_lighting_preset_favorite")
      ).toHaveLength(2);
      loaded.mockClear();
      ui.showSuccess.mockClear();
      ui.showError.mockClear();
      w.unmount();
      if (failure) reject(new Error("late rejection"));
      else settle({ ...item, favorite: true });
      await flushPromises();
      expect(loaded).not.toHaveBeenCalled();
      expect(ui.showSuccess).not.toHaveBeenCalled();
      expect(ui.showError).not.toHaveBeenCalled();
      expect(item.favorite).toBe(false);
    }
  );
  it.each([true, false])(
    "favorites builtin and user without selecting or applying (draftOnly=%s)",
    async (draftOnly) => {
      let items = [
        preset({ id: "user:a", name: "Alpha", last_used_at: "2020-01-01" }),
        preset({ id: "builtin:z", kind: "built_in", name: "Zulu", last_used_at: "2021-01-01" }),
      ];
      const originalItems = items;
      const original = JSON.stringify(items);
      invokeMock.mockImplementation(async (command, args) => {
        if (command === "list_lighting_presets") return items;
        if (command === "set_lighting_preset_favorite") {
          items = items.map((item) =>
            item.id === args?.id ? { ...item, favorite: args.favorite as boolean } : item
          );
          return items.find((item) => item.id === args?.id);
        }
        throw new Error(`Unexpected command: ${command}`);
      });
      const w = mount(LightingPresetSelect, {
        props: { draftOnly, activePresetId: "user:a" },
        global: globalOptions(),
      });
      await flushPromises();
      invokeMock.mockClear();
      const star = w.get('[data-favorite="builtin:z"]');
      expect(star.element.tagName).toBe("BUTTON");
      expect(star.attributes("type")).toBe("button");
      expect(star.element.parentElement).toBe(
        w.get('[data-preset="builtin:z"]').element.parentElement
      );
      expect(w.find("button button").exists()).toBe(false);
      expect(star.attributes("aria-pressed")).toBe("false");
      expect(star.attributes("aria-label")).toBe("收藏 Zulu");
      await star.trigger("click");
      await flushPromises();
      expect(star.attributes("aria-pressed")).toBe("true");
      expect(star.attributes("aria-label")).toBe("取消收藏 Zulu");
      expect(w.findAll("[data-preset]").map((row) => row.attributes("data-preset"))).toEqual([
        "builtin:z",
        "user:a",
      ]);
      await w.get('[data-favorite="user:a"]').trigger("click");
      await flushPromises();
      await star.trigger("click");
      await flushPromises();
      expect(invokeMock.mock.calls.filter(([cmd]) => cmd !== "list_lighting_presets")).toEqual([
        ["set_lighting_preset_favorite", { id: "builtin:z", favorite: true }],
        ["set_lighting_preset_favorite", { id: "user:a", favorite: true }],
        ["set_lighting_preset_favorite", { id: "builtin:z", favorite: false }],
      ]);
      expect(w.emitted("select")).toBeUndefined();
      expect(w.get('[data-preset="user:a"]').attributes("aria-selected")).toBe("true");
      const loadedEvents = w.emitted("loaded");
      expect(loadedEvents?.[loadedEvents.length - 1]?.[0]).toEqual(items);
      expect(JSON.stringify(originalItems)).toBe(original);
      await w.get("[data-sort]").setValue("recently_used");
      expect(w.findAll("[data-preset]").map((row) => row.attributes("data-preset"))).toEqual([
        "builtin:z",
        "user:a",
      ]);
      await w.get("[data-sort]").setValue("name");
      expect(w.findAll("[data-preset]").map((row) => row.attributes("data-preset"))).toEqual([
        "user:a",
        "builtin:z",
      ]);
      await w.get("[data-search]").setValue("Night");
      expect(w.findAll("[data-preset]")).toHaveLength(2);
      expect(w.findAll("mark")).toHaveLength(0);
      expect(items.map((item) => item.last_used_at)).toEqual(["2020-01-01", "2021-01-01"]);
      w.unmount();
    }
  );
});
