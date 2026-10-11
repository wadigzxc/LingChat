import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, it, expect, vi } from "vitest";

// Real native wire contract: return the actual bundled seed JSON, not a mock t().
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  invoke: vi.fn(async (command: string, args?: { seedContent?: string }) =>
    command === "get_locale_messages" ? args?.seedContent : []
  ),
}));
import { i18n, setLocale, SUPPORTED_LOCALES } from "@/locales";
import RelightingPanel from "../lighting/RelightingPanel.vue";
import SceneLightingPreview from "../SceneLightingPreview.vue";
import SceneEditModal from "../SceneEditModal.vue";
import RelightingGizmo from "../RelightingGizmo.vue";
vi.mock("@/stores/modules/game", () => ({
  useGameStore: () => ({ currentInteractRoleId: null, gameRoles: {} }),
}));
vi.mock("@/stores/modules/ui/ui", () => ({
  useUIStore: () => ({ showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}));
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";

const prefix = "settings.lighting.relighting.";
const panelKeys = [
  "title",
  "enableAria",
  "hint",
  "mode",
  "modeAria",
  "original",
  "relight",
  "target",
  "both",
  "character",
  "background",
  "ambient",
  "color",
  "intensity",
  "ambientColorAria",
  "ambientIntensityAria",
  "originalNote",
  "point",
  "enable",
  "pointEnableAria",
  "pointColorAria",
  "pointIntensityAria",
  "fineTune",
  "positionX",
  "positionY",
  "pointXAria",
  "pointYAria",
  "radius",
  "radiusAria",
  "softness",
  "softnessAria",
  "dragHint",
];
function message(key: string) {
  expect(
    i18n.global.te(
      prefix + key,
      (i18n.global.locale as unknown as { value: (typeof SUPPORTED_LOCALES)[number]["value"] })
        .value
    )
  ).toBe(true);
  return i18n.global.t(prefix + key);
}
async function language(locale: (typeof SUPPORTED_LOCALES)[number]["value"]) {
  setLocale(locale);
  await flushPromises();
}
function bootstrap() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return { plugins: [pinia, i18n] };
}
function lighting(enabled = true) {
  const value = createNeutralLighting();
  value.enabled = enabled;
  value.relighting = { ...createRelightingParams(), enabled };
  return value;
}

describe("real scene editor localization", () => {
  it.each(SUPPORTED_LOCALES)(
    "has an explicit complete nonempty dictionary for $value (no fallback)",
    async ({ value }) => {
      bootstrap();
      await language(value);
      const base = i18n.global.getLocaleMessage("zh-CN").settings.lighting.relighting;
      const translated = i18n.global.getLocaleMessage(value).settings.lighting.relighting;
      expect(Object.keys(translated).sort()).toEqual(Object.keys(base).sort());
      for (const key of Object.keys(base)) {
        expect(i18n.global.te(prefix + key, value)).toBe(true);
        expect((translated as Record<string, string>)[key]).toEqual(expect.any(String));
        expect((translated as Record<string, string>)[key].trim().length).toBeGreaterThan(0);
        if (value === "en")
          expect((translated as Record<string, string>)[key]).not.toMatch(/[\u4e00-\u9fff]/);
      }
      expect(Object.keys(base)).toHaveLength(43);
    }
  );
  it("switches gizmo aria and drag hint in place, retaining disabled controls", async () => {
    const global = bootstrap();
    await language("en");
    const w = mount(RelightingGizmo, { props: { lighting: lighting(), disabled: true }, global });
    expect(w.get("[data-relighting-center]").attributes("aria-label")).toBe(
      "Point light position; fine-tune with arrow keys"
    );
    const element = w.element;
    for (const { value } of SUPPORTED_LOCALES) {
      await language(value);
      expect(w.element).toBe(element);
      expect(w.get("[data-relighting-center]").attributes("aria-label")).toBe(
        message("centerHandleAria")
      );
      expect(w.get("[data-relighting-radius]").attributes("aria-label")).toBe(
        message("radiusHandleAria")
      );
      expect(w.get("[data-relighting-radius]").attributes("title")).toBe(
        message("radiusHandleHint")
      );
      expect(w.get("[data-relighting-radius]").attributes("disabled")).toBeDefined();
      await w.get("[data-relighting-center]").trigger("keydown", { key: "ArrowRight" });
      expect(w.emitted("update:lighting")).toBeUndefined();
    }
    w.unmount();
  });
  it("switches scene information, presets and reset text without translating user data; preserves disabled/reset behavior", async () => {
    const global = bootstrap();
    await language("en");
    const initialData = {
      sceneName: "用户的场景",
      sceneDescription: "User description 日本語",
      sceneImage: null,
      lighting: lighting(),
      lighting_preset_id: null,
      lighting_preset_revision: null,
      lighting_customized: false,
    };
    const w = mount(SceneEditModal, {
      props: { show: false, mode: "update", backgrounds: [], initialData },
      global: { ...global, stubs: { teleport: true } },
    });
    await w.setProps({ show: true });
    await flushPromises();
    expect(w.get("[data-legacy-lighting] summary").text()).toBe("Lighting and presets");
    const element = w.get("[data-editor-dialog]").element;
    for (const { value } of SUPPORTED_LOCALES) {
      await language(value);
      expect(w.get("[data-editor-dialog]").element).toBe(element);
      expect(w.get("[data-legacy-lighting] summary").text()).toBe(message("presetsTitle"));
      expect(w.findAll("summary").map((s) => s.text())).toContain(message("sceneInfo"));
      expect(w.get("[data-reset-relighting]").text()).toBe(message("reset"));
      expect(w.get("textarea").element).toHaveProperty("value", initialData.sceneDescription);
      expect(w.get('input[type="text"], input:not([type])').element).toHaveProperty(
        "value",
        initialData.sceneName
      );
    }
    // Dirty close disables fields and reset until the user chooses an action.
    await w.get("[data-reset-relighting]").trigger("click");
    expect(w.get('.relighting-panel input[type="checkbox"]').element).toHaveProperty(
      "checked",
      false
    );
    const dialog = w.get("[data-editor-dialog]");
    await dialog.trigger("keydown", { key: "Escape" });
    expect(w.get("[data-editor-fields]").attributes("disabled")).toBeDefined();
    expect(w.get("[data-reset-relighting]").attributes("disabled")).toBeDefined();
    w.unmount();
  });
  it("updates all three preview states and pending/error source status in place on language switch", async () => {
    const global = bootstrap();
    await language("en");
    const w = mount(SceneLightingPreview, {
      props: { lighting: lighting(false), disabled: true },
      global,
    });
    const element = w.element;
    expect(w.get("[data-preview-status]").text()).toBe(
      "No character artwork · Background preview only"
    );
    const source = document.createElement("div");
    source.dataset.relightingImage = "true";
    source.dataset.relightingReason = "loading";
    w.get("[data-preview-stage]").element.append(source);
    await flushPromises();
    for (const { value } of SUPPORTED_LOCALES) {
      await language(value);
      expect(w.element).toBe(element);
      expect(w.get("[data-preview-status]").text()).toBe(
        `${message("backgroundPreview")} · ${message("loadingPreview")}`
      );
      await w.setProps({ avatarUrl: "character.png", live2d: true });
      expect(w.get("[data-preview-status]").text()).toBe(
        `${message("staticPreview")} · ${message("loadingPreview")}`
      );
      await w.setProps({ live2d: false });
      expect(w.get("[data-preview-status]").text()).toBe(
        `${message("scenePreview")} · ${message("loadingPreview")}`
      );
      expect(w.get("[data-view-original]").attributes("disabled")).toBeDefined();
      await w.setProps({ avatarUrl: null });
    }
    source.dataset.relightingReason = "decode-error";
    await flushPromises();
    for (const { value } of SUPPORTED_LOCALES) {
      await language(value);
      expect(w.get("[data-preview-status]").text()).toContain(
        i18n.global.t(prefix + "sourceUnavailable", { reasons: "decode-error" })
      );
      expect(i18n.global.te(prefix + "sourceUnavailable", value)).toBe(true);
    }
    w.unmount();
  });
  it("translates panel controls, hints and aria live in every supported locale without remounting", async () => {
    const global = bootstrap();
    await language("zh-CN");
    const w = mount(RelightingPanel, { props: { modelValue: lighting() }, global });
    const element = w.element;
    await language("en");
    expect(w.get(".enable").text()).toBe("Single-light relighting (supports Live2D models)");
    for (const { value } of SUPPORTED_LOCALES) {
      await language(value);
      expect(w.element).toBe(element);
      for (const key of panelKeys.filter((key) => !key.endsWith("Aria"))) {
        expect(w.text()).toContain(message(key));
      }
      for (const key of panelKeys.filter((key) => key.endsWith("Aria"))) {
        expect(w.find(`[aria-label="${message(key)}"]`).exists()).toBe(true);
      }
      expect(
        w
          .get("select")
          .findAll("option")
          .map((option) => option.text())
      ).toEqual([message("original"), message("relight")]);
      if (value === "en")
        expect(w.get(".enable").text()).toBe("Single-light relighting (supports Live2D models)");
      if (value === "ja")
        expect(w.get(".enable").text()).toBe("単一ライトのライティング（Live2Dモデル対応）");
    }
    await w.setProps({ modelValue: lighting(false) });
    expect(w.find(".controls").exists()).toBe(false);
    await w.get('input[type="checkbox"]').setValue(true);
    const emitted = w.emitted("update:modelValue")![0][0] as ReturnType<typeof lighting>;
    expect(emitted.relighting!.enabled).toBe(true);
    await w.setProps({ modelValue: emitted });
    expect(w.find(".controls").exists()).toBe(true);
    const relight = lighting();
    relight.relighting!.mode = "relight";
    await w.setProps({ modelValue: relight });
    expect(w.find("[data-ambient-original-note]").exists()).toBe(false);
    w.unmount();
  });
});
