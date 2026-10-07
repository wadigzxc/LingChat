import { beforeEach, afterEach, expect, it, vi, type Mock } from "vitest";
import ImportDialog from "../LightingImportDialog.vue";
import Quality from "../LightingQualityToggle.vue";
vi.mock("@/stores/modules/settings", () => ({
  useSettingsStore: () => ({ display: { simplifiedLighting: false }, update: vi.fn() }),
}));
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import cnSettings from "@/locales/zh-CN/settings";
import hkSettings from "@/locales/zh-HK/settings";
import enSettings from "@/locales/en/settings";
import jaSettings from "@/locales/ja/settings";
import cnUI from "@/locales/zh-CN/ui";
import hkUI from "@/locales/zh-HK/ui";
import enUI from "@/locales/en/ui";
import jaUI from "@/locales/ja/ui";
import Manager from "../LightingPresetManager.vue";
import Select from "../LightingPresetSelect.vue";
import { defineComponent, h, nextTick } from "vue";
import ToolActivity from "@/components/tools/ToolActivityStatus.vue";
import { currentToolActivity, toolDisplayName } from "@/api/services/tool-settings";
import { useSceneEditorText } from "../../scene/useSceneEditorText";
import OverallPanel from "../../scene/lighting/OverallPanel.vue";
import CharacterPanel from "../../scene/lighting/CharacterPanel.vue";
import ScenePanel from "../../scene/lighting/ScenePanel.vue";
import AssetPanel from "../../scene/lighting/AssetLayersPanel.vue";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import EditModal from "../../scene/SceneEditModal.vue";
import Preview from "../../scene/SceneLightingPreview.vue";
vi.mock("@/stores/modules/game", () => ({
  useGameStore: () => ({ currentInteractRoleId: null, gameRoles: {} }),
}));
import { invokeMock, preset, inspection, ui, picker } from "./fixtures";
// Bootstrap the real locale loader with the native JSON contract before static imports finish.
vi.mock("@/locales", async (importOriginal) => {
  const { tauriMocks } = await import("@/test/setup");
  const invoke = tauriMocks.invoke as unknown as Mock<(command: string) => Promise<unknown>>;
  invoke.mockImplementation(async (command) =>
    command === "get_locale_messages" ? "{}" : undefined
  );
  return importOriginal<typeof import("@/locales")>();
});
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => picker.open(...args),
  save: (...args: unknown[]) => picker.save(...args),
}));
export const messages = {
  "zh-CN": { settings: cnSettings, ui: cnUI },
  "zh-HK": { settings: hkSettings, ui: hkUI },
  en: { settings: enSettings, ui: enUI },
  ja: { settings: jaSettings, ui: jaUI },
};
const locales = Object.keys(messages) as (keyof typeof messages)[];
function options(locale: keyof typeof messages) {
  return { plugins: [createI18n({ legacy: false, locale, fallbackLocale: false, messages })] };
}
function flatten(value: any, prefix = ""): Record<string, string> {
  return Object.assign(
    {},
    ...Object.entries(value).map(([key, item]) =>
      typeof item === "string" ? { [prefix + key]: item } : flatten(item, prefix + key + ".")
    )
  );
}
beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([preset()]);
  picker.open.mockReset();
  picker.save.mockReset();
});
it.each(locales)(
  "%s provides every used lighting text and field key in the mounted manager",
  async (locale) => {
    const files = [
      ...globSync("src/components/settings/lighting/*.{ts,vue}"),
      ...globSync("src/components/settings/scene/**/*.{ts,vue}"),
      "src/components/settings/pages/SettingsBackground.vue",
    ];
    const texts = new Set<string>();
    const fields = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:text|lightingText)\(\s*["']([^"']+)["']/g))
        texts.add(match[1]!);
      for (const match of source.matchAll(
        /(?:range|color|toggle|select)\((?:["']([^"']+)["']|path\(["']([^"']+)["']\))/g
      ))
        fields.add((match[1] || "asset_layers." + match[2]).replace(/\./g, "_"));
    }
    const dictionary = flatten((messages[locale].settings as any).lighting ?? {});
    for (const key of texts) expect(dictionary[key], key).toBeTruthy();
    for (const key of fields) expect(dictionary["fields." + key], key).toBeTruthy();
    expect(Object.keys(dictionary).sort()).toEqual(
      Object.keys(flatten((cnSettings as any).lighting)).sort()
    );
    const wrapper = mount(Manager, { global: options(locale) });
    await flushPromises();
    expect(wrapper.get("section").attributes("aria-label")).toBe(dictionary.manager);
    expect(wrapper.get("[data-create]").text()).toBe(dictionary.createFromActive);
    wrapper.unmount();
  }
);
const builtinNames = {
  "zh-CN": ["中性", "冷色逆光", "暖阳侧光", "月夜", "室内柔光"],
  "zh-HK": ["中性", "冷色逆光", "暖陽側光", "月夜", "室內柔光"],
  en: ["Neutral", "Cold backlight", "Warm side light", "Moonlight", "Indoor soft light"],
  ja: ["ニュートラル", "寒色の逆光", "暖かな側光", "月明かり", "室内の柔らかな光"],
};
const builtinKeys = ["neutral", "cold_backlight", "warm_side", "moonlight", "indoor_soft"];
const backendBuiltins = Array.from(
  readFileSync(
    "src-tauri/src/ai_service/game_system/lighting_presets/builtins.rs",
    "utf8"
  ).matchAll(/builtin\(\s*"([^"]+)",\s*"[^"]+",\s*"(lighting\.presets\.[^"]+)"/g),
  ([, id, key]) => ({ id: id!, key: key! })
);
it("uses the actual five Rust builtin preset identifiers and keys", () => {
  expect(backendBuiltins).toHaveLength(5);
  expect(backendBuiltins.map(({ key }) => key)).toEqual(
    builtinKeys.map((key) => `lighting.presets.${key}`)
  );
});
it.each(locales)(
  "%s renders the five backend builtin keys in selector, manager and editor",
  async (locale) => {
    const builtins = backendBuiltins.map(({ id, key }) =>
      preset({
        id,
        kind: "built_in",
        name: "backend fallback",
        i18n_key: key,
        aliases: [],
        tags: [],
        description: "",
      })
    );
    invokeMock.mockResolvedValue(builtins);
    for (const Component of [Select, Manager]) {
      const wrapper = mount(Component, { global: options(locale) });
      await flushPromises();
      for (const name of builtinNames[locale]) expect(wrapper.text()).toContain(name);
      expect(wrapper.text()).not.toContain("backend fallback");
      wrapper.unmount();
    }
    const EditorName = defineComponent({
      setup() {
        const { presetName } = useSceneEditorText();
        return () => h("div", builtins.map(presetName).join(" | "));
      },
    });
    const wrapper = mount(EditorName, { global: options(locale) });
    for (const name of builtinNames[locale]) expect(wrapper.text()).toContain(name);
    wrapper.unmount();
  }
);
it.each(locales)(
  "%s keeps user names literal and aliases editable without applying runtime lighting",
  async (locale) => {
    const name = "<img src=x onerror=alert(1)> settings.lighting.presets.neutral";
    const user = preset({ name, i18n_key: "lighting.presets.neutral", aliases: ["月夜 alias"] });
    invokeMock.mockImplementation(async (command) =>
      command === "list_lighting_presets" ? [user] : user
    );
    const wrapper = mount(Manager, { global: options(locale) });
    await flushPromises();
    expect(wrapper.get('[data-row="user:one"]').text()).toContain(name);
    expect(wrapper.find("img").exists()).toBe(false);
    await wrapper.get('[data-edit="user:one"]').trigger("click");
    expect((wrapper.get("[data-name]").element as HTMLInputElement).value).toBe(name);
    expect((wrapper.get("[data-aliases]").element as HTMLInputElement).value).toBe("月夜 alias");
    await wrapper.get("[data-name]").setValue("原名 renamed");
    await wrapper.get("[data-aliases]").setValue("原文, Alias");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("update_lighting_preset", {
      id: user.id,
      update: expect.objectContaining({ name: "原名 renamed", aliases: ["原文", "Alias"] }),
    });
    expect(invokeMock.mock.calls.some(([command]) => command.startsWith("apply_"))).toBe(false);
    wrapper.unmount();
  }
);
afterEach(() => vi.unstubAllGlobals());
const mobilePlatforms = [
  {
    name: "Android",
    userAgent: "Mozilla/5.0 (Linux; Android 14)",
    platform: "Linux",
    maxTouchPoints: 5,
  },
  {
    name: "iPhone",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
    platform: "iPhone",
    maxTouchPoints: 5,
  },
  {
    name: "iPadOS desktop UA",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    platform: "MacIntel",
    maxTouchPoints: 5,
  },
];
it.each(mobilePlatforms)(
  "$name hides all package operations through the real platform helper",
  async (platform) => {
    vi.stubGlobal("navigator", platform);
    const local = preset();
    const builtin = preset({
      id: "builtin:neutral",
      kind: "built_in",
      i18n_key: "lighting.presets.neutral",
    });
    invokeMock.mockImplementation(async (command) =>
      command === "list_lighting_presets" ? [local, builtin] : null
    );
    const manager = mount(Manager, { global: options("en") });
    const dialog = mount(ImportDialog, { global: options("en") });
    const select = mount(Select, { global: options("en") });
    await flushPromises();
    expect(
      manager.find("[data-open-import], [data-export], [data-export-batch], [data-select]").exists()
    ).toBe(false);
    expect(
      dialog.find("section, [data-pick], [data-parameter-only], [data-confirm-import]").exists()
    ).toBe(false);
    // Exercise handler gates too: hidden DOM alone does not prove native IO is disabled.
    await (manager.vm as any).exportOne(local);
    (manager.vm as any).selected = [local.id];
    await (manager.vm as any).exportBatch();
    await (dialog.vm as any).pick();
    for (const id of [local.id, builtin.id]) {
      await select.get(`[data-preset="${id}"]`).trigger("click");
      await flushPromises();
      expect(invokeMock).toHaveBeenCalledWith("apply_lighting_preset", { id });
    }
    expect(picker.open).not.toHaveBeenCalled();
    expect(picker.save).not.toHaveBeenCalled();
    expect(
      invokeMock.mock.calls.every(([command]) =>
        ["list_lighting_presets", "apply_lighting_preset"].includes(command)
      )
    ).toBe(true);
    manager.unmount();
    dialog.unmount();
    select.unmount();
  }
);
it.each(locales)("%s localizes the quality switch and its explanation", (locale) => {
  const expected = {
    "zh-CN": ["简化光影", "关闭泛光与 PNG 光效"],
    "zh-HK": ["簡化光影", "關閉泛光與 PNG 光效"],
    en: ["Simplified lighting", "Disable bloom and PNG effects"],
    ja: ["簡易ライティング", "ブルームと PNG 光効果を無効にする"],
  };
  const wrapper = mount(Quality, { global: options(locale) });
  expect(wrapper.findAll("span").map((span) => span.text())).toEqual(expected[locale]);
  wrapper.unmount();
});
it.each(locales)(
  "%s renders editor field and enum labels without changing wire values",
  async (locale) => {
    const lighting = createNeutralLighting();
    lighting.asset_layers = [
      {
        id: "layer",
        asset_hash: "a".repeat(64),
        media_type: "image/png",
        target: "both",
        placement: "front",
        z_index: 0,
        opacity: 1,
        blend_mode: "normal",
        fit: "cover",
        required: false,
      },
    ];
    const radial = { "zh-CN": "径向", "zh-HK": "徑向", en: "Radial", ja: "放射状" };
    for (const Component of [OverallPanel, CharacterPanel, ScenePanel, AssetPanel]) {
      const wrapper = mount(Component, {
        props: { modelValue: lighting },
        global: options(locale),
      });
      const dictionary = (messages[locale].settings as any).lighting;
      for (const label of wrapper.findAll("label")) {
        const input = label.get("[data-field]");
        const key = input
          .attributes("data-field")!
          .replace(/asset_layers\.\d+\./, "asset_layers.")
          .replace(/\./g, "_");
        expect(input.attributes("aria-label")).toBe(dictionary.fields[key]);
      }
      for (const option of wrapper.findAll("option")) {
        const value = option.attributes("value")!;
        if (value === "image/png") continue;
        expect(option.text(), value).toBe(dictionary.options?.[value]);
      }
      if (Component === OverallPanel) {
        expect(wrapper.get('option[value="radial"]').text()).toBe(radial[locale]);
        await wrapper.get('[data-field="main_light.shape"]').setValue("linear");
        expect((wrapper.emitted("update:modelValue")![0]![0] as any).main_light.shape).toBe(
          "linear"
        );
      }
      wrapper.unmount();
    }
  }
);
it.each(locales)(
  "%s interpolates literal preset names in export selection labels",
  async (locale) => {
    const name = "<b>原名</b>";
    invokeMock.mockResolvedValue([preset({ name })]);
    const wrapper = mount(Manager, { global: options(locale) });
    await flushPromises();
    const expected = {
      "zh-CN": `选择 ${name}`,
      "zh-HK": `選擇 ${name}`,
      en: `Select ${name}`,
      ja: `${name} を選択`,
    };
    expect(wrapper.get("[data-select]").attributes("aria-label")).toBe(expected[locale]);
    expect(wrapper.find("b").exists()).toBe(false);
    wrapper.unmount();
  }
);
it.each(locales)("%s localizes the editor preview warning notification title", async (locale) => {
  const wrapper = mount(EditModal, {
    props: { show: true, mode: "update", backgrounds: [] },
    global: { ...options(locale), stubs: { teleport: true, transition: false } },
  });
  await flushPromises();
  wrapper.getComponent(Preview).vm.$emit("warning", "resolver diagnostic");
  const expected = {
    "zh-CN": "预览警告",
    "zh-HK": "預覽警告",
    en: "Preview warning",
    ja: "プレビューの警告",
  };
  expect(ui.showWarning).toHaveBeenLastCalledWith({
    title: expected[locale],
    message: "resolver diagnostic",
    duration: 3000,
  });
  expect(wrapper.get("[role=dialog]").attributes("aria-label")).toBe(
    (messages[locale].settings as any).lighting.editorTitle
  );
  wrapper.unmount();
});
it.each(locales)(
  "%s localizes invalid draft asset hash diagnostics without resolving assets",
  async (locale) => {
    const lighting = createNeutralLighting();
    lighting.enabled = true;
    lighting.asset_layers = [
      {
        id: "<b>原文 layer</b>",
        asset_hash: "invalid",
        media_type: "image/png",
        target: "both",
        placement: "front",
        z_index: 0,
        opacity: 1,
        blend_mode: "normal",
        fit: "cover",
        required: false,
      },
    ];
    const before = JSON.stringify(lighting);
    const expected = {
      "zh-CN": "素材 SHA-256 格式无效",
      "zh-HK": "素材 SHA-256 格式無效",
      en: "Invalid asset SHA-256 format",
      ja: "素材の SHA-256 形式が無効です",
    };
    const wrapper = mount(Preview, { props: { lighting }, global: options(locale) });
    await flushPromises();
    expect(wrapper.get("[data-preview-warnings]").text()).toBe(
      `${lighting.asset_layers[0]!.id}: ${expected[locale]}`
    );
    expect(wrapper.find("b").exists()).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(JSON.stringify(lighting)).toBe(before);
    wrapper.unmount();
  }
);
it.each(locales)(
  "%s localizes unsafe or unavailable draft asset fallback diagnostics",
  async (locale) => {
    const lighting = createNeutralLighting();
    lighting.enabled = true;
    lighting.asset_layers = [
      {
        id: "original layer",
        asset_hash: "a".repeat(64),
        media_type: "image/png",
        target: "both",
        placement: "front",
        z_index: 0,
        opacity: 1,
        blend_mode: "normal",
        fit: "cover",
        required: false,
      },
    ];
    invokeMock.mockResolvedValue({
      hash: "a".repeat(64),
      supported: true,
      asset_protocol_path: "../unsafe.png",
      warning: null,
    });
    const expected = {
      "zh-CN": "素材不可解析或路径不安全",
      "zh-HK": "素材無法解析或路徑不安全",
      en: "Asset unavailable or unsafe path",
      ja: "素材を解決できないか、パスが安全ではありません",
    };
    const wrapper = mount(Preview, { props: { lighting }, global: options(locale) });
    await flushPromises();
    expect(wrapper.get("[data-preview-warnings]").text()).toBe(
      `original layer: ${expected[locale]}`
    );
    expect(wrapper.find("[data-lighting-assets] img").exists()).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("resolve_lighting_asset", { hash: "a".repeat(64) });
    wrapper.unmount();
  }
);
it.each(locales)(
  "%s localizes desktop import inspection units and conflict kinds",
  async (locale) => {
    const info = inspection({
      conflicts: ["built_in", "same_origin", "name"].map((kind) => ({
        kind: kind as "name",
        existing_id: kind,
        existing_name: "<b>原名</b>",
      })),
    });
    picker.open.mockResolvedValue("C:/example.linglight");
    invokeMock.mockResolvedValue(info);
    const expected = {
      "zh-CN": ["128 字节", "内置预设", "同源预设", "名称冲突"],
      "zh-HK": ["128 位元組", "內置預設", "同源預設", "名稱衝突"],
      en: ["128 bytes", "Built-in preset", "Same-origin preset", "Name conflict"],
      ja: ["128 バイト", "組み込みプリセット", "同じ出所のプリセット", "名前の競合"],
    };
    const wrapper = mount(ImportDialog, { global: options(locale) });
    await wrapper.get("[data-pick]").trigger("click");
    await flushPromises();
    for (const label of expected[locale]) expect(wrapper.text()).toContain(label);
    expect(wrapper.text()).toContain("<b>原名</b>");
    expect(wrapper.find("b").exists()).toBe(false);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["inspect_linglight"]);
    await wrapper.get("[data-cancel-import]").trigger("click");
    await flushPromises();
    wrapper.unmount();
  }
);
it.each(locales)("%s has matching lighting UI keys and interpolation contracts", (locale) => {
  const base = {
    ...flatten(cnSettings.lighting, "settings.lighting."),
    ...flatten(cnUI.lighting, "ui.lighting."),
  };
  const dictionary = {
    ...flatten(messages[locale].settings.lighting, "settings.lighting."),
    ...flatten(messages[locale].ui.lighting, "ui.lighting."),
  };
  expect(Object.keys(dictionary).sort()).toEqual(Object.keys(base).sort());
  const placeholders = (value: string) =>
    Array.from(value.matchAll(/\{(\w+)\}/g), ([, key]) => key).sort();
  for (const [key, value] of Object.entries(dictionary)) {
    expect(value, key).toBeTruthy();
    expect(placeholders(value), key).toEqual(placeholders(base[key]!));
  }
  const files = [
    ...globSync("src/components/settings/lighting/*.{ts,vue}"),
    ...globSync("src/components/settings/scene/**/*.{ts,vue}"),
    "src/composables/useSceneLighting.ts",
    "src/utils/scene-lighting/capabilities.ts",
  ];
  for (const file of files)
    for (const [, key] of readFileSync(file, "utf8").matchAll(/["'](ui\.lighting\.[^"']+)["']/g))
      expect(dictionary[key!], `${file}: ${key}`).toBeTruthy();
});
it.each(locales)(
  "%s renders existing AI lighting tool names in the real activity UI",
  async (locale) => {
    const { i18n } = await import("@/locales");
    (i18n.global.locale as unknown as { value: string }).value = locale;
    for (const tool of ["lighting_list", "lighting_switch", "lighting_reset"] as const) {
      const expected = messages[locale].ui.toolCalls.tools[tool];
      expect(expected).toBeTruthy();
      expect(toolDisplayName(tool)).toBe(expected);
      currentToolActivity.value = {
        callId: tool,
        tool,
        arguments: "{}",
        status: "running",
        sequence: 1,
      };
      const wrapper = mount(ToolActivity, {
        global: { ...options(locale), stubs: { transition: false } },
      });
      await nextTick();
      expect(wrapper.get("[role=status]").text()).toContain(expected);
      expect(wrapper.text()).not.toContain(tool);
      wrapper.unmount();
    }
    currentToolActivity.value = null;
  }
);
it("uses fully traditional Hong Kong wording for lighting field labels", () => {
  const lighting = createNeutralLighting();
  lighting.asset_layers = [
    {
      id: "layer",
      asset_hash: "a".repeat(64),
      media_type: "image/png",
      target: "both",
      placement: "front",
      z_index: 0,
      opacity: 1,
      blend_mode: "normal",
      fit: "cover",
      required: false,
    },
  ];
  const expected: Record<string, string> = {
    "asset_layers.0.target": "素材目標",
    "bloom.target": "泛光目標",
    link_character_background: "聯動角色與場景",
    "main_light.shape": "主光形狀",
    "main_light.target": "主光目標",
    "main_light.color_end": "主光結束色",
  };
  for (const Component of [OverallPanel, ScenePanel, AssetPanel]) {
    const wrapper = mount(Component, { props: { modelValue: lighting }, global: options("zh-HK") });
    for (const [field, label] of Object.entries(expected)) {
      const input = wrapper.find(`[data-field="${field}"]`);
      if (input.exists()) expect(input.attributes("aria-label"), field).toBe(label);
    }
    wrapper.unmount();
  }
});
it.each(locales)(
  "%s preserves desktop single/batch export and explicit parameter-only import",
  async (locale) => {
    const user = preset();
    invokeMock.mockImplementation(async (command) =>
      command === "list_lighting_presets"
        ? [user]
        : command === "inspect_linglight"
          ? inspection()
          : command === "commit_linglight_import"
            ? { preset: user, warnings: [] }
            : { items: [{ preset_id: user.id, path: "C:/out.linglight", error: null }] }
    );
    picker.save.mockResolvedValue("C:/one.linglight");
    picker.open.mockResolvedValue("C:/batch");
    const wrapper = mount(Manager, { global: options(locale) });
    await flushPromises();
    await wrapper.get(`[data-export="${user.id}"]`).trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("export_linglight", {
      presetId: user.id,
      targetPath: "C:/one.linglight",
    });
    await wrapper.get(`[data-select="${user.id}"]`).setValue(true);
    await wrapper.get("[data-export-batch]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("export_linglights", {
      presetIds: [user.id],
      targetDir: "C:/batch",
    });
    expect(ui.showSuccess).toHaveBeenLastCalledWith({
      title: messages[locale].settings.lighting.exported,
      duration: 2000,
    });
    picker.open.mockResolvedValue("C:/incoming.linglight");
    await wrapper.get("[data-open-import]").trigger("click");
    await wrapper.get("[data-pick]").trigger("click");
    await flushPromises();
    await wrapper.get("[data-parameter-only]").setValue(true);
    expect(invokeMock.mock.calls.some(([command]) => command === "commit_linglight_import")).toBe(
      false
    );
    await wrapper.get("[data-confirm-import]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("commit_linglight_import", {
      token: "token",
      strategy: "keep_both",
      parameterOnly: true,
    });
    expect(ui.showSuccess).toHaveBeenLastCalledWith({
      title: messages[locale].settings.lighting.imported,
      duration: 2000,
    });
    expect(invokeMock.mock.calls.some(([command]) => command.startsWith("apply_"))).toBe(false);
    wrapper.unmount();
  }
);
