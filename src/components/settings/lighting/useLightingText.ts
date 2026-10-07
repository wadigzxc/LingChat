import { useI18n } from "vue-i18n";
import type { LightingPreset } from "@/types/scene-lighting";
/** Shared display text only: draft consumers never acquire runtime operations. */
export function useLightingText() {
  const { t, te } = useI18n();
  const text = (key: string, fallback: string, params: Record<string, string | number> = {}) =>
    te(`settings.lighting.${key}`) ? t(`settings.lighting.${key}`, params) : fallback;
  const presetName = (preset: LightingPreset) => {
    if (preset.kind !== "built_in" || !preset.i18n_key) return preset.name;
    // Backend keys are stable; locale modules live under the settings namespace.
    const key = te(preset.i18n_key) ? preset.i18n_key : `settings.${preset.i18n_key}`;
    return te(key) ? t(key) : preset.name;
  };
  return { text, presetName };
}
