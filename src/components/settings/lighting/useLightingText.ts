import { useI18n } from "vue-i18n";
import type { LightingPreset } from "@/types/scene-lighting";
/** Shared display text only: draft consumers never acquire runtime operations. */
export function useLightingText() {
  const { t, te } = useI18n();
  const text = (key: string, fallback: string, params: Record<string, string | number> = {}) =>
    te(`settings.lighting.${key}`) ? t(`settings.lighting.${key}`, params) : fallback;
  const builtinKey = (preset: LightingPreset) => {
    if (preset.kind !== "built_in") return undefined;
    return ["neutral", "cold_backlight", "warm_side", "moonlight", "indoor_soft"].find(
      (key) => preset.i18n_key === `lighting.presets.${key}`
    );
  };
  const presetName = (preset: LightingPreset) => {
    if (!builtinKey(preset) || !preset.i18n_key) return preset.name;
    // Backend keys are stable; locale modules live under the settings namespace.
    const key = te(preset.i18n_key) ? preset.i18n_key : `settings.${preset.i18n_key}`;
    return te(key) ? t(key) : preset.name;
  };
  const presetDescription = (preset: LightingPreset) => {
    const key = builtinKey(preset);
    return key ? text(`presetDescriptions.${key}`, preset.description) : preset.description;
  };
  const presetClassifications = (preset: LightingPreset) => {
    const seen = new Set<string>();
    return [preset.category, ...preset.tags]
      .map((value) => {
        const trimmed = value.trim();
        return builtinKey(preset)
          ? text(`presetCategories.${trimmed.toLowerCase()}`, trimmed)
          : trimmed;
      })
      .filter((value) => {
        const key = value.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  return { text, presetName, presetDescription, presetClassifications };
}
