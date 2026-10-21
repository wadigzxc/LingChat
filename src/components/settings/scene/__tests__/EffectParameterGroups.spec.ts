import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RelightingPanel from "../lighting/RelightingPanel.vue";
import OverallPanel from "../lighting/OverallPanel.vue";
import CharacterPanel from "../lighting/CharacterPanel.vue";
import ScenePanel from "../lighting/ScenePanel.vue";
import { readField } from "../lighting/fields";
import { nextTick, type Component } from "vue";
import zhCN from "@/locales/zh-CN/settings";
import zhHK from "@/locales/zh-HK/settings";
import en from "@/locales/en/settings";
import ja from "@/locales/ja/settings";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";
import type { LightingParams } from "@/types/scene-lighting";

import { createPinia } from "pinia";
import SceneEditModal from "../SceneEditModal.vue";
import { preset } from "../../lighting/__tests__/fixtures";
import { invoke } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  invoke: vi.fn(async (command: string, args?: { seedContent?: string }) =>
    command === "get_locale_messages" ? args?.seedContent : []
  ),
}));
vi.mock("@/stores/modules/game", () => ({
  useGameStore: () => ({ currentInteractRoleId: null, gameRoles: {} }),
}));
vi.mock("@/stores/modules/ui/ui", () => ({
  useUIStore: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));
const api = vi.hoisted(() => ({
  list: vi.fn<() => Promise<import("@/types/scene-lighting").LightingPreset[]>>(async () => []),
  apply: vi.fn(),
}));
vi.mock("@/api/services/scene-lighting", async (original) => ({
  ...(await original<typeof import("@/api/services/scene-lighting")>()),
  listLightingPresets: api.list,
  applyLightingPreset: api.apply,
}));
beforeEach(() => {
  api.list.mockResolvedValue([]);
  api.apply.mockClear();
});

function fixture() {
  const lighting = createNeutralLighting();
  lighting.relighting = createRelightingParams();
  return lighting;
}
function host(panel: Component, source = fixture()) {
  const value = ref(source);
  const updates: LightingParams[] = [];
  const language = createI18n({
    legacy: false,
    locale: "zh",
    messages: { zh: {} },
    missingWarn: false,
    fallbackWarn: false,
  });
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(panel, {
          modelValue: value.value,
          "onUpdate:modelValue": (next: LightingParams) => {
            updates.push(next);
            value.value = next;
          },
        }),
    }),
    { attachTo: document.body, global: { plugins: [language] } }
  );
  return { wrapper, value, updates, language };
}

const legacyCases = [
  ...[
    { group: "background_ambient", field: "background_ambient.opacity", tune: 0.44 },
    { group: "bloom", field: "bloom.intensity", tune: 0.56 },
  ].map((row) => ({
    ...row,
    panel: ScenePanel,
    name: "scene",
    publicFields: [
      "background.brightness",
      "background.contrast",
      "background.saturation",
      "background.sepia",
      "background.glow_radius",
      "background.glow_color",
    ],
  })),
  ...[
    { group: "character_ambient", field: "character_ambient.opacity", tune: 0.42 },
    { group: "rim_light", field: "rim_light.intensity", tune: 1.36 },
    { group: "bloom", field: "bloom.intensity", tune: 0.57 },
  ].map((row) => ({
    ...row,
    panel: CharacterPanel,
    name: "character",
    publicFields: [
      "character.brightness",
      "character.contrast",
      "character.saturation",
      "character.sepia",
      "character.glow_radius",
      "character.glow_color",
    ],
  })),
  {
    panel: OverallPanel,
    name: "overall",
    group: "main_light",
    field: "main_light.opacity",
    tune: 0.63,
    publicFields: ["enabled", "link_character_background", "master_intensity"],
  },
  {
    panel: OverallPanel,
    name: "overall",
    group: "vignette",
    field: "vignette.intensity",
    tune: 0.61,
    publicFields: ["enabled", "link_character_background", "master_intensity"],
  },
];
function setFlag(value: LightingParams, path: string, enabled: boolean) {
  (value as unknown as Record<string, { enabled: boolean }>)[path]!.enabled = enabled;
}
for (const row of legacyCases) {
  describe(`${row.name}/${row.group}`, () => {
    for (const enabled of [false, true])
      it(`initializes from own enabled=${enabled}, not the global master`, () => {
        const source = fixture();
        source.enabled = !enabled;
        setFlag(source, row.group, enabled);
        const { wrapper: w, updates } = host(row.panel, source);
        const group = w.get(`[data-effect-group="${row.group}"]`);
        expect(w.get(`[data-lighting-panel="${row.name}"]`).element.tagName).toBe("FIELDSET");
        expect(group.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe(
          String(enabled)
        );
        expect(group.get("[data-effect-body]").isVisible()).toBe(enabled);
        expect(group.get(`[data-field="${row.group}.enabled"]`).element).toHaveProperty(
          "checked",
          enabled
        );
        for (const path of row.publicFields)
          expect(w.get(`[data-field="${path}"]`).element.closest("[data-effect-group]")).toBeNull();
        expect(updates).toHaveLength(0);
        w.unmount();
      });
    it("preserves disabled presetuning and local manual fold across ordinary parent input", async () => {
      const source = fixture();
      source.link_character_background = false;
      setFlag(source, row.group, false);
      const before = JSON.stringify(source);
      const { wrapper: w, value, updates } = host(row.panel, source);
      const group = w.get(`[data-effect-group="${row.group}"]`);
      const button = group.get("[data-effect-disclosure]");
      const enabled = group.get(`[data-field="${row.group}.enabled"]`);
      await button.trigger("click");
      expect(updates).toHaveLength(0);
      await group.get(`[data-field="${row.field}"]`).setValue(row.tune);
      expect(readField(value.value, row.field)).toBe(row.tune);
      expect(readField(value.value, `${row.group}.enabled`)).toBe(false);
      expect(value.value.enabled).toBe(false);
      expect(button.attributes("aria-expanded")).toBe("true");
      await enabled.setValue(true);
      await button.trigger("click");
      const count = updates.length;
      value.value = { ...value.value, master_intensity: 1.4 };
      await nextTick();
      expect(button.attributes("aria-expanded")).toBe("false");
      expect(updates).toHaveLength(count);
      await enabled.setValue(false);
      expect(button.attributes("aria-expanded")).toBe("false");
      await enabled.setValue(true);
      expect(button.attributes("aria-expanded")).toBe("true");
      expect(readField(value.value, row.field)).toBe(row.tune);
      expect(JSON.stringify(source)).toBe(before);
      w.unmount();
    });
  });
}

// FIRST-GREEN matrix: all controls stay on the original updateField/update-clone path.
const parameters: Record<string, [string, string | number][]> = {
  main_light: [
    ["shape", "linear"],
    ["target", "background"],
    ["x", 0.22],
    ["y", 0.78],
    ["angle", 123],
    ["radius", 0.64],
    ["color_start", "#123456"],
    ["color_end", "#aabbcc"],
    ["opacity", 0.58],
    ["blend_mode", "soft_light"],
  ],
  vignette: [
    ["color", "#234567"],
    ["intensity", 0.58],
    ["radius", 0.44],
    ["softness", 0.36],
  ],
  character_ambient: [
    ["color", "#345678"],
    ["opacity", 0.47],
  ],
  background_ambient: [
    ["color", "#456789"],
    ["opacity", 0.46],
  ],
  rim_light: [
    ["color", "#56789a"],
    ["intensity", 1.7],
    ["width", 42],
    ["softness", 23],
    ["angle", 240],
    ["offset", 17],
  ],
  bloom: [
    ["target", "character"],
    ["color", "#6789ab"],
    ["radius", 31],
    ["intensity", 0.77],
  ],
};
for (const row of legacyCases)
  it(`${row.name}/${row.group} retains every parameter through disabled presetuning and disable/re-enable`, async () => {
    const source = fixture();
    source.link_character_background = false;
    const before = JSON.stringify(source);
    const { wrapper: w, value } = host(row.panel, source);
    const group = w.get(`[data-effect-group="${row.group}"]`);
    await group.get("[data-effect-disclosure]").trigger("click");
    for (const [key, value] of parameters[row.group]!)
      await group.get(`[data-field="${row.group}.${key}"]`).setValue(value);
    expect(readField(value.value, `${row.group}.enabled`)).toBe(false);
    const snapshot = JSON.stringify((value.value as unknown as Record<string, unknown>)[row.group]);
    const enabled = group.get(`[data-field="${row.group}.enabled"]`);
    await enabled.setValue(true);
    await enabled.setValue(false);
    expect(group.get("[data-effect-body]").isVisible()).toBe(false);
    expect(JSON.stringify((value.value as unknown as Record<string, unknown>)[row.group])).toBe(
      snapshot
    );
    await enabled.setValue(true);
    for (const [key, expected] of parameters[row.group]!)
      expect(readField(value.value, `${row.group}.${key}`)).toBe(expected);
    expect(JSON.stringify(source)).toBe(before);
    w.unmount();
  });
for (const rootEnabled of [false, true])
  for (const pointEnabled of [false, true])
    it(`relighting initialization is independent: root=${rootEnabled}, point=${pointEnabled}`, async () => {
      const source = fixture();
      source.enabled = !rootEnabled;
      source.relighting!.enabled = rootEnabled;
      source.relighting!.point_light.enabled = pointEnabled;
      const { wrapper: w, updates } = host(RelightingPanel, source);
      const buttons = w.findAll("[data-effect-disclosure]");
      expect(buttons.map((b) => b.attributes("aria-expanded"))).toEqual([
        String(rootEnabled),
        String(pointEnabled),
      ]);
      if (!rootEnabled) await buttons[0]!.trigger("click");
      expect(
        w.get('[data-effect-group="relighting.point_light"] [data-effect-body]').isVisible()
      ).toBe(pointEnabled);
      expect(
        w
          .get('[aria-label="环境光颜色"]')
          .element.closest("[data-effect-group]")
          ?.getAttribute("data-effect-group")
      ).toBe("relighting");
      expect(w.findAll('input[type="checkbox"]')).toHaveLength(2);
      expect(updates).toHaveLength(0);
      w.unmount();
    });
for (const absent of ["missing", "null"] as const)
  it(`manual UI does not manufacture ${absent} relighting`, async () => {
    const source = createNeutralLighting();
    if (absent === "null") source.relighting = null;
    else delete source.relighting;
    const before = JSON.stringify(source);
    const { wrapper: w, updates } = host(RelightingPanel, source);
    for (const button of w.findAll("[data-effect-disclosure]")) {
      await button.trigger("click");
      await button.trigger("click");
    }
    expect(updates).toHaveLength(0);
    expect(JSON.stringify(source)).toBe(before);
    w.unmount();
  });
it("retains every relighting root and point parameter without enabling disabled root", async () => {
  const source = fixture();
  source.relighting!.point_light.enabled = false;
  const before = JSON.stringify(source);
  const { wrapper: w, value } = host(RelightingPanel, source);
  const root = w.get('[data-effect-group="relighting"]');
  const point = w.get('[data-effect-group="relighting.point_light"]');
  await root.get("[data-effect-disclosure]").trigger("click");
  await point.get("[data-effect-disclosure]").trigger("click");
  (w.get("details").element as HTMLDetailsElement).open = true;
  for (const [label, tune] of [
    ["受光模式", "relight"],
    ["作用对象", "background"],
    ["环境光颜色", "#123456"],
    ["环境光亮度", 0.7],
    ["单灯颜色", "#abcdef"],
    ["单灯亮度", 2.4],
    ["单灯位置X", 0.23],
    ["单灯位置Y", 0.76],
    ["单灯范围", 1.3],
    ["单灯柔度", 0.37],
  ] as const)
    await w.get(`[aria-label="${label}"]`).setValue(tune);
  expect(value.value.enabled).toBe(false);
  expect(value.value.relighting!.enabled).toBe(false);
  expect(value.value.relighting!.point_light.enabled).toBe(false);
  const snapshot = JSON.parse(JSON.stringify(value.value.relighting));
  await root.get('[data-field="relighting.enabled"]').setValue(true);
  await point.get('[data-field="relighting.point_light.enabled"]').setValue(true);
  await point.get('[data-field="relighting.point_light.enabled"]').setValue(false);
  await root.get('[data-field="relighting.enabled"]').setValue(false);
  expect(value.value.relighting).toEqual(snapshot);
  await root.get('[data-field="relighting.enabled"]').setValue(true);
  await point.get('[data-field="relighting.point_light.enabled"]').setValue(true);
  expect(value.value.relighting).toEqual({
    ...snapshot,
    enabled: true,
    point_light: { ...snapshot.point_light, enabled: true },
  });
  expect(JSON.stringify(source)).toBe(before);
  w.unmount();
});
function allPanels(source = fixture()) {
  const state = ref(source);
  const changes: LightingParams[] = [];
  const language = createI18n({
    legacy: false,
    locale: "zh",
    messages: { zh: {} },
    missingWarn: false,
    fallbackWarn: false,
  });
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          "div",
          [RelightingPanel, OverallPanel, CharacterPanel, ScenePanel].map((panel) =>
            h(panel, {
              modelValue: state.value,
              "onUpdate:modelValue": (next: LightingParams) => {
                changes.push(next);
                state.value = next;
              },
            })
          )
        ),
    }),
    { attachTo: document.body, global: { plugins: [language] } }
  );
  return { wrapper, state, changes };
}
for (const startPanel of ["character", "scene"])
  it(`shared bloom synchronizes accepted flags from ${startPanel} but keeps local disclosure choices independent`, async () => {
    const { wrapper: w, state, changes } = allPanels();
    const a = w.get(`[data-lighting-panel="${startPanel}"] [data-effect-group="bloom"]`);
    const b = w.get(
      `[data-lighting-panel="${startPanel === "character" ? "scene" : "character"}"] [data-effect-group="bloom"]`
    );
    await a.get("[data-effect-disclosure]").trigger("click");
    expect(b.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("false");
    expect(changes).toHaveLength(0);
    await a.get('[data-field="bloom.enabled"]').setValue(true);
    expect(b.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("true");
    await a.get("[data-effect-disclosure]").trigger("click");
    await b.get('[data-field="bloom.intensity"]').setValue(0.67);
    expect(a.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("false");
    expect(b.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("true");
    expect(a.get('[data-field="bloom.intensity"]').element).toHaveProperty("value", "0.67");
    await b.get('[data-field="bloom.enabled"]').setValue(false);
    expect(
      [a, b].map((g) => g.get("[data-effect-disclosure]").attributes("aria-expanded"))
    ).toEqual(["false", "false"]);
    await a.get('[data-field="bloom.enabled"]').setValue(true);
    expect(
      [a, b].map((g) => g.get("[data-effect-disclosure]").attributes("aria-expanded"))
    ).toEqual(["true", "true"]);
    expect(state.value.bloom.intensity).toBe(0.67);
    w.unmount();
  });
for (const linked of [false, true])
  for (const from of ["character_ambient", "background_ambient"])
    it(`ambient flags preserve original bidirectional linked=${linked} rules from ${from}`, async () => {
      const source = fixture();
      source.link_character_background = linked;
      const { wrapper: w, state } = allPanels(source);
      const peer = from === "character_ambient" ? "background_ambient" : "character_ambient";
      const a = w.get(`[data-effect-group="${from}"]`),
        b = w.get(`[data-effect-group="${peer}"]`);
      await a.get(`[data-field="${from}.enabled"]`).setValue(true);
      expect(b.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe(String(linked));
      if (linked) await b.get("[data-effect-disclosure]").trigger("click");
      await a.get(`[data-field="${from}.opacity"]`).setValue(0.31);
      expect(b.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("false");
      expect(readField(state.value, `${peer}.opacity`)).toBe(linked ? 0.31 : 0);
      await a.get(`[data-field="${from}.enabled"]`).setValue(false);
      expect(readField(state.value, `${peer}.enabled`)).toBe(false);
      w.unmount();
    });
it("all nine occurrence body ids are unique and every disclosure controls its own body", () => {
  const { wrapper: w } = allPanels();
  const groups = w.findAll("[data-effect-group]");
  expect(groups).toHaveLength(9);
  const ids = groups.map((g) => g.get("[data-effect-body]").attributes("id"));
  expect(new Set(ids).size).toBe(9);
  for (const group of groups) {
    const button = group.get("[data-effect-disclosure]");
    expect(button.attributes("aria-controls")).toBe(
      group.get("[data-effect-body]").attributes("id")
    );
    expect(button.find("input").exists()).toBe(false);
  }
  w.unmount();
});

const initialScene = (lighting: LightingParams | null) => ({
  sceneName: "用户场景",
  sceneDescription: "User 日本語 description",
  sceneImage: null,
  lighting,
  lighting_preset_id: null,
  lighting_preset_revision: null,
  lighting_customized: false,
});
async function editor(
  source: LightingParams | null = fixture(),
  extra: Record<string, unknown> = {}
) {
  const language = createI18n({
    legacy: false,
    locale: "zh",
    messages: { zh: {}, en: {} },
    missingWarn: false,
    fallbackWarn: false,
  });
  const w = mount(SceneEditModal, {
    attachTo: document.body,
    props: {
      show: false,
      mode: "update",
      backgrounds: [],
      initialData: initialScene(source),
      ...extra,
    },
    global: { plugins: [createPinia(), language], stubs: { teleport: false, transition: false } },
  });
  await w.setProps({ show: true });
  await flushPromises();
  const dialog = new DOMWrapper(document.body.querySelector("[data-editor-dialog]")!);
  return { w, dialog, language };
}
function saveButton(dialog: DOMWrapper<Element>) {
  return dialog.findAll("button").find((b) => b.text() === "settings.sceneEdit.button.update")!;
}
for (const enabled of [false, true])
  it(`real editor all nine manual disclosures survive refresh/locale/unrelated input and reinitialize only after genuine close/reopen (${enabled})`, async () => {
    const source = fixture();
    source.enabled = !enabled;
    source.relighting!.enabled = enabled;
    source.relighting!.point_light.enabled = enabled;
    for (const id of Object.keys(parameters)) setFlag(source, id, enabled);
    const before = JSON.stringify(source);
    api.list.mockResolvedValue([preset()]);
    const { w, dialog, language } = await editor(source, { lightingPresetRefreshKey: 0 });
    const legacy = dialog.get("[data-legacy-lighting]").element as HTMLDetailsElement;
    expect(legacy.open).toBe(false);
    legacy.open = true;
    const groups = dialog.findAll("[data-effect-group]");
    expect(groups).toHaveLength(9);
    const buttons = groups.map((g) => g.get("[data-effect-disclosure]"));
    const elements = buttons.map((b) => b.element);
    // Open the root first for nested controls; collapse it last if initially enabled.
    for (const button of enabled ? [...buttons].reverse() : buttons) await button.trigger("click");
    expect(buttons.map((b) => b.attributes("aria-expanded"))).toEqual(
      Array(9).fill(String(!enabled))
    );
    const provenance = dialog.get("[data-provenance]").text();
    await w.setProps({
      lightingPresetRefreshKey: 1,
      backgrounds: [{ title: "Room", url: "C:/room.png", time: "" }],
    });
    await flushPromises();
    language.global.locale.value = "en";
    await nextTick();
    expect(buttons.map((b) => b.element)).toEqual(elements);
    expect(buttons.map((b) => b.attributes("aria-expanded"))).toEqual(
      Array(9).fill(String(!enabled))
    );
    expect(dialog.get("[data-provenance]").text()).toBe(provenance);
    expect(dialog.get('[aria-label="场景名称"]').element).toHaveProperty("value", "用户场景");
    expect(dialog.get("textarea").element).toHaveProperty("value", "User 日本語 description");
    expect(dialog.find('[role="alertdialog"]').exists()).toBe(false);
    // Actual ordinary draft input, then exact restore: no whole-object UI reset.
    await dialog.get('[data-field="master_intensity"]').setValue(0.72);
    expect(buttons.map((b) => b.attributes("aria-expanded"))).toEqual(
      Array(9).fill(String(!enabled))
    );
    await dialog.get('[data-field="master_intensity"]').setValue(source.master_intensity);
    expect(api.apply).not.toHaveBeenCalled();
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => /apply|recent|usage/.test(cmd))).toEqual(
      []
    );
    await dialog.get('button[aria-label="关闭"]').trigger("click");
    expect(dialog.find('[role="alertdialog"]').exists()).toBe(false);
    expect(w.emitted("close")).toHaveLength(1);
    await w.setProps({ show: false });
    await vi.waitFor(() => expect(document.body.querySelector("[data-editor-dialog]")).toBeNull());
    await w.setProps({ show: true });
    await flushPromises();
    const fresh = new DOMWrapper(document.body.querySelector("[data-editor-dialog]")!);
    const reopened = fresh.findAll("[data-effect-disclosure]");
    expect(reopened).toHaveLength(9);
    expect(reopened.map((b) => b.attributes("aria-expanded"))).toEqual(
      Array(9).fill(String(enabled))
    );
    expect(reopened[0]!.element).not.toBe(elements[0]);
    expect((fresh.get("[data-legacy-lighting]").element as HTMLDetailsElement).open).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
    w.unmount();
  });
for (const absent of ["scene-null", "missing", "null"] as const)
  it(`real editor UI-only disclosure remains clean and saves unchanged optional relighting (${absent})`, async () => {
    const source = absent === "scene-null" ? null : createNeutralLighting();
    if (source) {
      if (absent === "null") source.relighting = null;
      else delete source.relighting;
    }
    const before = JSON.stringify(source);
    const { w, dialog } = await editor(source);
    const root = dialog.get('[data-effect-group="relighting"] [data-effect-disclosure]');
    await root.trigger("click");
    await root.trigger("click");
    expect(dialog.get("[data-provenance]").text()).toBe("系统中性");
    await saveButton(dialog).trigger("click");
    await flushPromises();
    expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
      lighting: source,
      lighting_customized: false,
    });
    expect(JSON.stringify(source)).toBe(before);
    expect(api.apply).not.toHaveBeenCalled();
    w.unmount();
  });
it("disabled presetuning dirties only the draft, guard cancel keeps manual state, discard leaves source unchanged", async () => {
  const source = fixture();
  source.relighting!.point_light.enabled = false;
  const before = JSON.stringify(source);
  const { w, dialog } = await editor(source);
  const group = dialog.get('[data-effect-group="relighting"]');
  await group.get("[data-effect-disclosure]").trigger("click");
  await dialog.get('[aria-label="环境光亮度"]').setValue(0.46);
  expect(dialog.get('[data-field="relighting.enabled"]').element).toHaveProperty("checked", false);
  expect(dialog.get('[data-field="enabled"]').element).toHaveProperty("checked", false);
  await dialog.get('button[aria-label="关闭"]').trigger("click");
  expect(dialog.find('[role="alertdialog"]').exists()).toBe(true);
  await dialog.get("[data-draft-cancel]").trigger("click");
  expect(group.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("true");
  expect(dialog.get('[aria-label="环境光亮度"]').element).toHaveProperty("value", "0.46");
  await dialog.get('button[aria-label="关闭"]').trigger("click");
  await dialog.get("[data-draft-discard]").trigger("click");
  expect(w.emitted("close")).toHaveLength(1);
  expect(w.emitted("submit")).toBeUndefined();
  expect(JSON.stringify(source)).toBe(before);
  expect(api.apply).not.toHaveBeenCalled();
  w.unmount();
});
for (const failure of [false, true])
  it(`all nine new controls obey actual pending-save fieldset lock and preserve captured payload (${failure})`, async () => {
    const source = fixture();
    source.relighting!.enabled = true;
    let settle!: () => void;
    const saveScene = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settle = () => (failure ? reject(new Error("disk full")) : resolve());
        })
    );
    const { w, dialog } = await editor(source, { saveScene, sceneKey: "old" });
    (dialog.get("[data-legacy-lighting]").element as HTMLDetailsElement).open = true;
    await dialog.get('[data-field="master_intensity"]').setValue(0.73);
    await saveButton(dialog).trigger("click");
    const buttons = dialog.findAll("[data-effect-disclosure]");
    const checkboxes = dialog.findAll(
      '[data-effect-group] > .effect-header input[type="checkbox"]'
    );
    expect(buttons).toHaveLength(9);
    expect(checkboxes).toHaveLength(9);
    const folds = buttons.map((b) => b.attributes("aria-expanded"));
    const flags = checkboxes.map((c) => (c.element as HTMLInputElement).checked);
    for (const control of [...buttons, ...checkboxes]) {
      expect(control.element.matches(":disabled")).toBe(true);
      (control.element as HTMLElement).click();
    }
    await nextTick();
    expect(buttons.map((b) => b.attributes("aria-expanded"))).toEqual(folds);
    expect(checkboxes.map((c) => (c.element as HTMLInputElement).checked)).toEqual(flags);
    expect(saveScene).toHaveBeenCalledTimes(1);
    expect(saveScene).toHaveBeenCalledWith(
      expect.objectContaining({ lighting: { ...source, master_intensity: 0.73 } }),
      { sceneKey: "old", mode: "update" }
    );
    settle();
    await flushPromises();
    if (failure) {
      expect(w.emitted("submit")).toBeUndefined();
      expect(dialog.get("[data-editor-save-error]").text()).toContain("disk full");
      expect(buttons.every((b) => !b.element.matches(":disabled"))).toBe(true);
    } else expect(w.emitted("submit")).toHaveLength(1);
    w.unmount();
  });

it("real editor routes shared bloom flags/parameters through draft updates while keeping each view disclosure local", async () => {
  const source = fixture();
  const before = JSON.stringify(source);
  const { w, dialog } = await editor(source);
  (dialog.get("[data-legacy-lighting]").element as HTMLDetailsElement).open = true;
  const character = dialog.get('[data-lighting-panel="character"] [data-effect-group="bloom"]');
  const scene = dialog.get('[data-lighting-panel="scene"] [data-effect-group="bloom"]');
  await character.get('[data-field="bloom.enabled"]').setValue(true);
  expect(scene.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("true");
  await character.get("[data-effect-disclosure]").trigger("click");
  await scene.get('[data-field="bloom.radius"]').setValue(28);
  expect(character.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("false");
  expect(character.get('[data-field="bloom.radius"]').element).toHaveProperty("value", "28");
  await scene.get('[data-field="bloom.enabled"]').setValue(false);
  expect(
    [character, scene].map((g) => g.get("[data-effect-disclosure]").attributes("aria-expanded"))
  ).toEqual(["false", "false"]);
  await character.get("[data-effect-disclosure]").trigger("click");
  await character.get('[data-field="bloom.intensity"]').setValue(0.69);
  expect(scene.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("false");
  expect(
    [character, scene].map(
      (g) => (g.get('[data-field="bloom.enabled"]').element as HTMLInputElement).checked
    )
  ).toEqual([false, false]);
  await saveButton(dialog).trigger("click");
  await flushPromises();
  expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
    lighting: { enabled: false, bloom: { enabled: false, radius: 28, intensity: 0.69 } },
  });
  expect(JSON.stringify(source)).toBe(before);
  expect(api.apply).not.toHaveBeenCalled();
  w.unmount();
});
it("real editor preserves linked ambient synchronization without synchronizing manual folds", async () => {
  const source = fixture();
  source.link_character_background = true;
  const { w, dialog } = await editor(source);
  (dialog.get("[data-legacy-lighting]").element as HTMLDetailsElement).open = true;
  const character = dialog.get('[data-effect-group="character_ambient"]');
  const scene = dialog.get('[data-effect-group="background_ambient"]');
  await character.get('[data-field="character_ambient.enabled"]').setValue(true);
  expect(scene.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("true");
  await scene.get("[data-effect-disclosure]").trigger("click");
  await character.get('[data-field="character_ambient.opacity"]').setValue(0.37);
  expect(scene.get("[data-effect-disclosure]").attributes("aria-expanded")).toBe("false");
  await character.get('[data-field="character_ambient.enabled"]').setValue(false);
  expect(
    [character, scene].map((g) => g.get("[data-effect-disclosure]").attributes("aria-expanded"))
  ).toEqual(["false", "false"]);
  await scene.get('[data-field="background_ambient.enabled"]').setValue(true);
  expect(
    [character, scene].map((g) => g.get("[data-effect-disclosure]").attributes("aria-expanded"))
  ).toEqual(["true", "true"]);
  await saveButton(dialog).trigger("click");
  await flushPromises();
  expect(w.emitted("submit")?.[0]?.[0]).toMatchObject({
    lighting: {
      enabled: false,
      character_ambient: { enabled: true, opacity: 0.37 },
      background_ambient: { enabled: true, opacity: 0.37 },
    },
  });
  expect(source.character_ambient.enabled).toBe(false);
  expect(api.apply).not.toHaveBeenCalled();
  w.unmount();
});

const dictionaries = { "zh-CN": zhCN, "zh-HK": zhHK, en, ja };
it("localizes all nine mounted occurrences and existing enable labels live without resetting manual fold", async () => {
  const source = fixture();
  source.relighting!.enabled = true;
  const language = createI18n({
    legacy: false,
    locale: "zh-CN",
    fallbackLocale: false,
    messages: Object.fromEntries(
      Object.entries(dictionaries).map(([key, settings]) => [key, { settings }])
    ),
  });
  const w = mount(
    defineComponent({
      setup: () => () =>
        h(
          "div",
          [RelightingPanel, OverallPanel, CharacterPanel, ScenePanel].map((panel) =>
            h(panel, { modelValue: source })
          )
        ),
    }),
    { attachTo: document.body, global: { plugins: [language] } }
  );
  const groups = w.findAll("[data-effect-group]");
  expect(groups).toHaveLength(9);
  const root = groups[0]!.get("[data-effect-disclosure]");
  await root.trigger("click");
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    language.global.locale.value = locale;
    await nextTick();
    const labels = (dictionary.lighting as unknown as { groups: Record<string, string> }).groups;
    expect(Object.keys(labels ?? {}).sort()).toEqual([
      "background_ambient",
      "bloom",
      "character_ambient",
      "main_light",
      "rim_light",
      "vignette",
    ]);
    for (const group of groups) {
      const id = group.attributes("data-effect-group");
      const button = group.get("[data-effect-disclosure]");
      const expected =
        id === "relighting"
          ? dictionary.lighting.relighting.title
          : id === "relighting.point_light"
            ? dictionary.lighting.relighting.point
            : labels[id!];
      expect(expected).toBeTruthy();
      expect(button.text()).toContain(expected);
      const checkbox = group.get('input[type="checkbox"]');
      const field = checkbox.attributes("data-field")!;
      const expectedEnable =
        id === "relighting"
          ? dictionary.lighting.relighting.enableAria
          : id === "relighting.point_light"
            ? dictionary.lighting.relighting.pointEnableAria
            : (dictionary.lighting.fields as Record<string, string>)[field.split(".").join("_")];
      expect(checkbox.attributes("aria-label")).toBe(expectedEnable);
    }
    expect(root.attributes("aria-expanded")).toBe("false");
  }
  w.unmount();
});

describe("effect parameter groups", () => {
  it("nested point keeps its independent manual fold across root folding and disabled presetuning", async () => {
    const source = fixture();
    source.relighting!.enabled = true;
    source.relighting!.point_light.enabled = false;
    const { wrapper: w, value, updates } = host(RelightingPanel, source);
    const root = w.get('[data-effect-group="relighting"]');
    const point = w.get('[data-effect-group="relighting.point_light"]');
    const button = point.get("[data-effect-disclosure]");
    expect(button.attributes("aria-expanded")).toBe("false");
    await button.trigger("click");
    await point.get('[aria-label="单灯亮度"]').setValue(2.3);
    expect(value.value.relighting!.point_light).toMatchObject({ enabled: false, intensity: 2.3 });
    await root.get("[data-effect-disclosure]").trigger("click");
    await root.get("[data-effect-disclosure]").trigger("click");
    expect(button.attributes("aria-expanded")).toBe("true");
    await point.get('[data-field="relighting.point_light.enabled"]').setValue(true);
    await button.trigger("click");
    const count = updates.length;
    await w.get('[aria-label="环境光亮度"]').setValue(0.8);
    expect(button.attributes("aria-expanded")).toBe("false");
    expect(updates).toHaveLength(count + 1);
    await point.get('[data-field="relighting.point_light.enabled"]').setValue(false);
    await point.get('[data-field="relighting.point_light.enabled"]').setValue(true);
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(value.value.relighting!.point_light.intensity).toBe(2.3);
    w.unmount();
  });
  it("relighting root allows disabled presetuning without enabling or mutating the source", async () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const { wrapper: w, value, updates } = host(RelightingPanel, source);
    const group = w.get('[data-effect-group="relighting"]');
    const button = group.get("[data-effect-disclosure]");
    expect(button.attributes("aria-expanded")).toBe("false");
    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(updates).toHaveLength(0);
    await group.get('[aria-label="环境光亮度"]').setValue(0.65);
    expect(value.value.relighting).toMatchObject({ enabled: false, ambient: { intensity: 0.65 } });
    expect(value.value.enabled).toBe(false);
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(JSON.stringify(source)).toBe(before);
    await group.get('[data-field="relighting.enabled"]').setValue(true);
    await button.trigger("click");
    expect(button.attributes("aria-expanded")).toBe("false");
    await group.get('[data-field="relighting.enabled"]').setValue(false);
    await group.get('[data-field="relighting.enabled"]').setValue(true);
    expect(button.attributes("aria-expanded")).toBe("true");
    expect(value.value.relighting!.ambient.intensity).toBe(0.65);
    w.unmount();
  });
});
