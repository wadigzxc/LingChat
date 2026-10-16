import { mount, flushPromises, type GlobalMountOptions, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import cn from "@/locales/zh-CN/settings";
import hk from "@/locales/zh-HK/settings";
import en from "@/locales/en/settings";
import ja from "@/locales/ja/settings";
import { useSettingsStore } from "@/stores/modules/settings";
import type { LightingPreset } from "@/types/scene-lighting";
import { preset, globalOptions, invokeMock, ui } from "./fixtures";
import LightingPresetSelect from "../LightingPresetSelect.vue";

vi.mock("@/stores/modules/ui/ui", async () => ({ useUIStore: () => ui }));

const mounted: VueWrapper[] = [];
function mountSelector(props = {}, global: GlobalMountOptions = globalOptions()) {
  const wrapper = mount(LightingPresetSelect, {
    props,
    global,
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}
function disclosure(wrapper: VueWrapper) {
  return wrapper.get("details").element as HTMLDetailsElement;
}

beforeEach(() => {
  setActivePinia(createPinia());
  invokeMock.mockResolvedValue([preset()]);
});
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

// jsdom coverage checks DOM ownership and Vue patches only. Real pointer, keyboard,
// focus-visible and closed-content Tab exclusion belong to the independent browser gate.
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("LightingPresetSelect native disclosure", () => {
  it.each([true, false])(
    "retains the user's open=%s choice across late initial and queued refresh responses",
    async (open) => {
      const initial = deferred();
      const followup = deferred();
      invokeMock.mockReturnValueOnce(initial.promise).mockReturnValueOnce(followup.promise);
      const wrapper = mountSelector({ refreshKey: 0 });
      const details = disclosure(wrapper);
      details.open = true;
      details.open = open;
      await wrapper.setProps({ refreshKey: 1 });
      expect(invokeMock).toHaveBeenCalledTimes(1);

      initial.resolve([preset({ name: "Old" })]);
      await flushPromises();
      expect(disclosure(wrapper)).toBe(details);
      expect(details.open).toBe(open);
      expect(invokeMock).toHaveBeenCalledTimes(2);

      followup.resolve([preset({ name: "Newest" })]);
      await flushPromises();
      expect(disclosure(wrapper)).toBe(details);
      expect(details.open).toBe(open);
      expect(wrapper.get("[data-preset-name]").text()).toBe("Newest");
      expect(wrapper.emitted("loaded")).toHaveLength(2);
      expect(wrapper.emitted("select")).toBeUndefined();
    }
  );
  it.each([true, false])(
    "preserves open=%s through explicit reload, idle refreshKey failure and retry",
    async (open) => {
      const wrapper = mountSelector({ refreshKey: 0 });
      await flushPromises();
      const details = disclosure(wrapper);
      details.open = true;
      const reload = deferred();
      invokeMock.mockReturnValueOnce(reload.promise);
      await wrapper.get("[data-reload]").trigger("click");
      details.open = open;
      reload.resolve([preset({ name: "Reloaded" })]);
      await flushPromises();
      expect(details.open).toBe(open);
      expect(wrapper.get("[data-preset-name]").text()).toBe("Reloaded");

      const failed = deferred();
      invokeMock.mockReturnValueOnce(failed.promise);
      await wrapper.setProps({ refreshKey: 1 });
      failed.reject(new Error("refresh failed"));
      await flushPromises();
      expect(details.open).toBe(open);
      expect(ui.showError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "refresh failed" })
      );

      details.open = true;
      const retry = deferred();
      invokeMock.mockReturnValueOnce(retry.promise);
      await wrapper.get("[data-reload]").trigger("click");
      details.open = open;
      retry.resolve([preset({ name: "Retried" })]);
      await flushPromises();
      expect(disclosure(wrapper)).toBe(details);
      expect(details.open).toBe(open);
      expect(wrapper.get("[data-preset-name]").text()).toBe("Retried");
      expect(wrapper.emitted("loaded")).toHaveLength(3);
      expect(wrapper.emitted("select")).toBeUndefined();
      expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(
        Array(4).fill("list_lighting_presets")
      );
    }
  );

  it.each([true, false])(
    "retains query and sort while locale and shared sorting patch the open=%s instance",
    async (open) => {
      const dictionaries = { "zh-CN": cn, "zh-HK": hk, en, ja };
      const i18n = createI18n({
        legacy: false,
        locale: "zh-CN",
        fallbackLocale: false,
        messages: Object.fromEntries(
          Object.entries(dictionaries).map(([locale, settings]) => [locale, { settings }])
        ),
      });
      const global = { plugins: [i18n] };
      invokeMock.mockResolvedValue([
        preset(),
        preset({ id: "user:two", name: "Sun", last_used_at: "2026-01-01T00:00:00Z" }),
      ]);
      const wrapper = mountSelector({}, global);
      await flushPromises();
      const details = disclosure(wrapper);
      details.open = true;
      await wrapper.get("[data-search]").setValue("evening");
      await wrapper.get("[data-sort]").setValue("name");
      const ids = () =>
        wrapper.findAll("[data-preset]").map((row) => row.attributes("data-preset"));
      expect(ids()).toEqual(["user:one", "user:two"]);
      details.open = open;
      invokeMock.mockClear();

      useSettingsStore().display.lightingPresetSort = "recently_used";
      await nextTick();
      expect(details.open).toBe(open);
      expect(ids()).toEqual(["user:two", "user:one"]);
      for (const [locale, settings] of Object.entries(dictionaries)) {
        global.plugins[0].global.locale.value = locale;
        await nextTick();
        expect(wrapper.get("[data-toggle-presets]").text()).toBe(settings.lighting.choosePreset);
        expect(disclosure(wrapper)).toBe(details);
        expect(details.open).toBe(open);
        expect((wrapper.get("[data-search]").element as HTMLInputElement).value).toBe("evening");
        expect((wrapper.get("[data-sort]").element as HTMLSelectElement).value).toBe(
          "recently_used"
        );
      }
      details.open = false;
      details.open = true;
      expect((wrapper.get("[data-search]").element as HTMLInputElement).value).toBe("evening");
      expect(ids()).toEqual(["user:two", "user:one"]);
      expect(invokeMock).not.toHaveBeenCalled();
      expect(wrapper.emitted("select")).toBeUndefined();
    }
  );

  it.each([
    { operation: "favorite", open: true },
    { operation: "favorite", open: false },
    { operation: "apply", open: true },
    { operation: "apply", open: false },
  ])(
    "keeps open=$open through a failed $operation and its successful retry",
    async ({ operation, open }) => {
      const item = preset();
      const original = JSON.stringify(item);
      invokeMock.mockResolvedValue([item]);
      const wrapper = mountSelector();
      await flushPromises();
      const details = disclosure(wrapper);
      const command =
        operation === "favorite" ? "set_lighting_preset_favorite" : "apply_lighting_preset";
      const args = operation === "favorite" ? { id: item.id, favorite: true } : { id: item.id };
      const action = operation === "favorite" ? "[data-favorite]" : "[data-preset]";
      invokeMock.mockClear();

      details.open = true;
      const failed = deferred();
      invokeMock.mockReturnValueOnce(failed.promise);
      await wrapper.get(action).trigger("click");
      expect(wrapper.get(action).attributes("disabled")).toBeDefined();
      details.open = open;
      failed.reject(new Error(`${operation} denied`));
      await flushPromises();
      expect(details.open).toBe(open);
      expect(ui.showError).toHaveBeenCalledWith(
        expect.objectContaining({ message: `${operation} denied` })
      );
      expect(wrapper.get(action).attributes("disabled")).toBeUndefined();
      expect(wrapper.emitted("favoriteChanged")).toBeUndefined();
      expect(wrapper.emitted("loaded")).toHaveLength(1);

      details.open = true;
      const retry = deferred();
      invokeMock.mockReturnValueOnce(retry.promise);
      await wrapper.get(action).trigger("click");
      details.open = open;
      retry.resolve(operation === "favorite" ? { ...item, favorite: true } : {});
      await flushPromises();
      expect(disclosure(wrapper)).toBe(details);
      expect(details.open).toBe(open);
      expect(wrapper.emitted("loaded")).toHaveLength(2);
      expect(wrapper.emitted("select")).toBeUndefined();
      expect(invokeMock.mock.calls).toEqual(
        operation === "favorite"
          ? [
              [command, args],
              [command, args],
            ]
          : [
              [command, args],
              [command, args],
              ["list_lighting_presets", { sort: "favorite_first" }],
            ]
      );
      if (operation === "favorite") {
        expect(wrapper.get(action).attributes("aria-pressed")).toBe("true");
        expect(wrapper.emitted("favoriteChanged")).toHaveLength(1);
      }
      expect(JSON.stringify(item)).toBe(original);
    }
  );

  it("keeps simultaneous instances independent and remounts collapsed without resetting shared sort", async () => {
    const first = mountSelector();
    const second = mountSelector();
    await flushPromises();
    expect(disclosure(first).open).toBe(false);
    expect(disclosure(second).open).toBe(false);

    disclosure(first).open = true;
    await first.get("details").trigger("toggle");
    expect(disclosure(second).open).toBe(false);
    await first.get("[data-sort]").setValue("recently_used");
    expect(disclosure(first).open).toBe(true);
    expect(disclosure(second).open).toBe(false);
    expect((second.get("[data-sort]").element as HTMLSelectElement).value).toBe("recently_used");

    disclosure(second).open = true;
    await second.get("details").trigger("toggle");
    disclosure(first).open = false;
    await first.get("details").trigger("toggle");
    await first.setProps({ activePresetId: "user:one" });
    expect(disclosure(first).open).toBe(false);
    expect(disclosure(second).open).toBe(true);
    mounted.splice(mounted.indexOf(first), 1);
    first.unmount();

    const remounted = mountSelector();
    await flushPromises();
    expect(disclosure(remounted).open).toBe(false);
    expect(disclosure(second).open).toBe(true);
    expect((remounted.get("[data-sort]").element as HTMLSelectElement).value).toBe("recently_used");
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(
      Array(3).fill("list_lighting_presets")
    );
  });

  it.each([false, true])(
    "toggling alone has no command, selection, favorite or loaded side effects (draftOnly=%s)",
    async (draftOnly) => {
      const item = preset({ last_used_at: "2026-01-01T00:00:00Z" });
      const original = JSON.stringify(item);
      invokeMock.mockResolvedValue([item]);
      const wrapper = mountSelector({ draftOnly, activePresetId: item.id });
      await flushPromises();
      const loaded = wrapper.emitted("loaded")?.[0]?.[0];
      invokeMock.mockClear();
      for (const open of [true, false, true, false]) {
        await wrapper.get("[data-toggle-presets]").trigger("click");
        await flushPromises();
        expect(disclosure(wrapper).open).toBe(open);
        expect(wrapper.get("[data-preset]").attributes("aria-selected")).toBe("true");
      }
      expect(invokeMock).not.toHaveBeenCalled();
      expect(wrapper.emitted("select")).toBeUndefined();
      expect(wrapper.emitted("favoriteChanged")).toBeUndefined();
      expect(wrapper.emitted("loaded")).toHaveLength(1);
      expect(wrapper.emitted("loaded")?.[0]?.[0]).toBe(loaded);
      expect(ui.showSuccess).not.toHaveBeenCalled();
      expect(ui.showError).not.toHaveBeenCalled();
      expect(JSON.stringify(item)).toBe(original);
    }
  );

  it("keeps an explicitly chosen deep-copied draft intact across close and reopen without runtime IPC", async () => {
    const item = preset();
    const original = JSON.stringify(item);
    invokeMock.mockResolvedValue([item]);
    const onSelect = vi.fn<(choice: LightingPreset) => void>();
    const wrapper = mountSelector({ draftOnly: true, onSelect });
    await flushPromises();
    invokeMock.mockClear();
    await wrapper.get("[data-toggle-presets]").trigger("click");
    await wrapper.get("[data-search]").setValue("Moon");
    await wrapper.get("[data-preset]").trigger("click");
    expect(onSelect).toHaveBeenCalledTimes(1);
    const chosenDraft = onSelect.mock.calls[0]![0];
    expect(chosenDraft).toEqual(item);
    expect(chosenDraft).not.toBe(item);
    expect(chosenDraft.lighting).not.toBe(item.lighting);
    expect(chosenDraft.lighting.main_light).not.toBe(item.lighting.main_light);
    expect(chosenDraft.tags).not.toBe(item.tags);
    chosenDraft.lighting.main_light.x = 0.25;
    chosenDraft.tags.push("draft edit");
    const edited = JSON.stringify(chosenDraft);
    await wrapper.setProps({ activePresetId: item.id });

    for (const open of [false, true, false]) {
      await wrapper.get("[data-toggle-presets]").trigger("click");
      await flushPromises();
      expect(disclosure(wrapper).open).toBe(open);
      expect(JSON.stringify(chosenDraft)).toBe(edited);
      expect((wrapper.get("[data-search]").element as HTMLInputElement).value).toBe("Moon");
      expect(wrapper.get("[data-preset]").attributes("aria-selected")).toBe("true");
    }
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("select")).toHaveLength(1);
    expect(wrapper.emitted("favoriteChanged")).toBeUndefined();
    expect(wrapper.emitted("loaded")).toHaveLength(1);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(JSON.stringify(item)).toBe(original);
  });

  it("starts collapsed while loading and still publishes a late initial list without opening", async () => {
    let resolve!: (value: unknown) => void;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const wrapper = mountSelector();
    expect(disclosure(wrapper).open).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("list_lighting_presets", { sort: "favorite_first" });
    expect(wrapper.emitted("loaded")).toBeUndefined();

    resolve([preset()]);
    await flushPromises();

    expect(disclosure(wrapper).open).toBe(false);
    expect(wrapper.emitted("loaded")?.[0]?.[0]).toEqual([preset()]);
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["list_lighting_presets"]);
  });
});
