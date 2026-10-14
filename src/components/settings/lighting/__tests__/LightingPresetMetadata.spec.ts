import { mount, flushPromises } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import { readFileSync } from "node:fs";
import cn from "@/locales/zh-CN/settings";
import hk from "@/locales/zh-HK/settings";
import en from "@/locales/en/settings";
import ja from "@/locales/ja/settings";
import { invokeMock, preset, ui } from "./fixtures";
import Select from "../LightingPresetSelect.vue";
import Manager from "../LightingPresetManager.vue";
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));

const dictionaries = { "zh-CN": cn, "zh-HK": hk, en, ja };
const locales = Object.keys(dictionaries) as (keyof typeof dictionaries)[];
// Read the producer's real identifiers, names, aliases and category/tag metadata.
// No native runtime or effect parameters are changed by these display tests.
const builtins = Array.from(
  readFileSync(
    "src-tauri/src/ai_service/game_system/lighting_presets/builtins.rs",
    "utf8"
  ).matchAll(
    /builtin\(\s*"([^"]+)",\s*"([^"]+)",\s*"(lighting\.presets\.[^"]+)",\s*&\[([^\]]+)\],\s*"([^"]+)"/g
  ),
  ([, id, name, i18n_key, aliases, category]) =>
    preset({
      id: id!,
      name: name!,
      i18n_key: i18n_key!,
      kind: "built_in",
      aliases: Array.from(aliases!.matchAll(/"([^"]+)"/g), ([, alias]) => alias!),
      category: category!,
      tags: [category!],
      description: "",
    })
);
function options() {
  const i18n = createI18n({
    legacy: false,
    locale: "zh-CN",
    fallbackLocale: false,
    messages: Object.fromEntries(
      locales.map((locale) => [locale, { settings: dictionaries[locale] }])
    ),
  });
  return { i18n, global: { plugins: [i18n] } };
}
const descriptions = {
  "zh-CN": [
    "不添加光影，保留原始画面。",
    "冷蓝轮廓光搭配深蓝背景氛围。",
    "暖橙侧光柔和叠加于角色与背景。",
    "蓝色环境光搭配暗角，营造夜间氛围。",
    "暖色柔光搭配轻微泛光。",
  ],
  "zh-HK": [
    "不添加光影，保留原始畫面。",
    "冷藍輪廓光搭配深藍背景氛圍。",
    "暖橙側光柔和疊加於角色與背景。",
    "藍色環境光搭配暗角，營造夜間氛圍。",
    "暖色柔光搭配輕微泛光。",
  ],
  en: [
    "No added lighting; keeps the original image.",
    "Cool blue rim light with a deep blue background ambience.",
    "Warm orange side light softly blended over character and background.",
    "Blue ambient light with a vignette for a night-time mood.",
    "Warm soft light with a subtle bloom.",
  ],
  ja: [
    "光効果を加えず、元の画面を保ちます。",
    "青いリムライトと濃紺の背景光。",
    "暖かなオレンジの側光をキャラクターと背景に柔らかく重ねます。",
    "青い環境光と周辺減光で夜の雰囲気を演出します。",
    "暖色の柔らかな光と控えめなブルーム。",
  ],
};
it.each(locales)(
  "%s localizes favorite operations and literal names on selector and manager native buttons",
  async (locale) => {
    const operations = {
      "zh-CN": ["收藏", "取消收藏"],
      "zh-HK": ["收藏", "取消收藏"],
      en: ["Favorite", "Unfavorite"],
      ja: ["お気に入り", "お気に入りを解除"],
    };
    for (const Component of [Select, Manager]) {
      let items = [builtins[0]!, preset({ name: "<b>Literal 原名</b>" })];
      const originalItems = items;
      const before = JSON.stringify(items);
      invokeMock.mockImplementation(async (command, args) => {
        if (command === "list_lighting_presets") return items;
        if (command !== "set_lighting_preset_favorite")
          throw new Error(`Unexpected command: ${command}`);
        items = items.map((item) =>
          item.id === args?.id ? { ...item, favorite: args.favorite as boolean } : item
        );
        return items.find((item) => item.id === args?.id);
      });
      const { i18n, global } = options();
      const w = mount(Component, { global, attachTo: document.body });
      await flushPromises();
      const element = w.element;
      i18n.global.locale.value = locale;
      await nextTick();
      for (const item of items) {
        const name =
          item.kind === "built_in" ? dictionaries[locale].lighting.presets.neutral : item.name;
        const star = w.get(`[data-favorite="${item.id}"]`);
        expect(star.element.tagName).toBe("BUTTON");
        expect(star.attributes("type")).toBe("button");
        expect(star.attributes("aria-label")).toBe(`${operations[locale][0]} ${name}`);
        (star.element as HTMLButtonElement).focus();
        expect(document.activeElement).toBe(star.element);
        await star.trigger("click");
        await flushPromises();
        expect(star.attributes("aria-label")).toBe(`${operations[locale][1]} ${name}`);
        expect(star.attributes("aria-pressed")).toBe("true");
        expect(ui.showSuccess).toHaveBeenLastCalledWith({
          title: dictionaries[locale].lighting.favoriteChanged,
          duration: 2000,
        });
      }
      expect(w.find("b").exists()).toBe(false);
      expect(w.element).toBe(element);
      expect(JSON.stringify(originalItems)).toBe(before);
      w.unmount();
    }
  }
);
it("localizes builtin classifications and deduplicates raw and localized tags in stable order", async () => {
  const classes = {
    "zh-CN": ["基础", "电影感", "自然", "夜景", "室内"],
    "zh-HK": ["基礎", "電影感", "自然", "夜景", "室內"],
    en: ["Basic", "Cinematic", "Natural", "Night", "Indoor"],
    ja: ["基本", "シネマ調", "自然", "夜景", "室内"],
  };
  invokeMock.mockResolvedValue(builtins);
  const { i18n, global } = options();
  const w = mount(Select, { global });
  await flushPromises();
  for (const locale of locales) {
    i18n.global.locale.value = locale;
    await nextTick();
    for (const [index, builtin] of builtins.entries()) {
      const row = w.get(`[data-preset="${builtin.id}"]`);
      expect(row.findAll("[data-preset-classification]").map((chip) => chip.text())).toEqual([
        classes[locale][index],
      ]);
    }
    const item = preset({
      ...builtins[0],
      tags: [" NEUTRAL ", classes[locale][0]!, "", "   ", "Custom tag", "custom TAG"],
    });
    invokeMock.mockResolvedValue([item]);
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
    expect(w.findAll("[data-preset-classification]").map((chip) => chip.text())).toEqual([
      classes[locale][0],
      "Custom tag",
    ]);
    invokeMock.mockResolvedValue(builtins);
    await w.get("[data-reload]").trigger("click");
    await flushPromises();
  }
  w.unmount();
});
it("keeps user-authored strings and unknown builtin metadata literal across locale changes", async () => {
  const user = preset({
    id: "user:mimic",
    name: "<img src=x> settings.lighting.presets.neutral",
    i18n_key: "lighting.presets.neutral",
    description: "Original description <b>原文</b>",
    category: "cinematic",
    tags: ["night", "My custom category"],
  });
  const unknown = preset({
    id: "builtin:unknown",
    kind: "built_in",
    i18n_key: "lighting.refresh",
    name: "Raw unknown name",
    description: "Raw unknown description",
    category: "cinematic",
    tags: [],
  });
  const before = JSON.stringify([user, unknown]);
  invokeMock.mockResolvedValue([user, unknown]);
  const { i18n, global } = options();
  const w = mount(Select, { props: { draftOnly: true }, global });
  await flushPromises();
  for (const locale of locales) {
    i18n.global.locale.value = locale;
    await nextTick();
    for (const item of [user, unknown]) {
      const row = w.get(`[data-preset="${item.id}"]`);
      expect(row.get("[data-preset-name]").text()).toBe(item.name);
      expect(row.get("[data-preset-description]").text()).toBe(item.description);
      expect(row.findAll("[data-preset-classification]").map((chip) => chip.text())).toEqual([
        item.category,
        ...item.tags,
      ]);
    }
    expect(w.find("img, b").exists()).toBe(false);
  }
  await w.get('[data-preset="user:mimic"]').trigger("click");
  const selected = w.emitted("select")![0]![0] as typeof user;
  expect(selected).toEqual(user);
  selected.lighting.main_light.opacity = 0.99;
  expect(JSON.stringify([user, unknown])).toBe(before);
  expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["list_lighting_presets"]);
  w.unmount();
});
it("searches localized descriptions and classifications live while retaining hidden raw metadata search", async () => {
  const items = builtins.map((item) =>
    preset({ ...item, aliases: [...item.aliases, "hidden-alias-only"] })
  );
  invokeMock.mockResolvedValue(items);
  const { i18n, global } = options();
  const w = mount(Select, { global });
  await flushPromises();
  const element = w.element;
  for (const locale of locales) {
    i18n.global.locale.value = locale;
    await nextTick();
    for (const [index, item] of items.entries()) {
      for (const [field, query] of [
        ["description", descriptions[locale][index]!],
        [
          "classification",
          dictionaries[locale].lighting.presetCategories[
            item.category as keyof typeof cn.lighting.presetCategories
          ],
        ],
      ]) {
        await w.get("[data-search]").setValue(` ${query!.toUpperCase()} `);
        const row = w.find(`[data-preset="${item.id}"]`);
        expect(row.exists(), `${locale}: ${field}: ${query}`).toBe(true);
        expect(
          row
            .findAll(`[data-preset-${field}] mark`)
            .map((mark) => mark.text())
            .join("")
            .toLowerCase()
        ).toBe(query!.toLowerCase());
      }
    }
    await w.get("[data-search]").setValue("hidden-alias-only");
    expect(w.findAll("[data-preset]")).toHaveLength(5);
    expect(w.findAll("mark")).toHaveLength(0);
    expect(w.get("[role=listbox]").text()).not.toContain("hidden-alias-only");
    await w.get("[data-search]").setValue("neutral");
    expect(w.find('[data-preset="builtin:neutral"]').exists()).toBe(true);
    if (locale !== "en") expect(w.findAll("mark")).toHaveLength(0);
    expect(w.element).toBe(element);
    // A query stays active across locale changes and must be re-evaluated immediately.
    await w.get("[data-search]").setValue(descriptions[locale][0]!);
    expect(w.findAll("[data-preset]")).toHaveLength(1);
    i18n.global.locale.value = locale === "en" ? "ja" : "en";
    await nextTick();
    expect(w.findAll("[data-preset]")).toHaveLength(0);
    await w.get("[data-search]").setValue("");
  }
  w.unmount();
});
it("updates all five builtin names and short descriptions with real dictionaries on the same mounted selector", async () => {
  expect(builtins).toHaveLength(5);
  invokeMock.mockResolvedValue(builtins);
  const { i18n, global } = options();
  const w = mount(Select, { props: { draftOnly: true }, global });
  await flushPromises();
  const element = w.element;
  for (const locale of locales) {
    i18n.global.locale.value = locale;
    await nextTick();
    for (const [index, builtin] of builtins.entries()) {
      const row = w.get(`[data-preset="${builtin.id}"]`);
      const key = builtin.i18n_key!.split(".").pop()! as keyof typeof cn.lighting.presets;
      expect(row.get("[data-preset-name]").text()).toBe(dictionaries[locale].lighting.presets[key]);
      expect(row.get("[data-preset-description]").text()).toBe(descriptions[locale][index]);
      expect(row.findAll("[data-preset-name]")).toHaveLength(1);
    }
    expect(w.element).toBe(element);
    expect(w.get("details").attributes("open")).toBeDefined();
  }
  expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["list_lighting_presets"]);
  w.unmount();
});
