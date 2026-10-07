import { useI18n } from "vue-i18n";
import type { LightingPreset } from "@/types/scene-lighting";
/** Same fallback namespace as the existing lighting manager; full locales land in Task 17. */
export function useSceneEditorText() {
  const { t, te } = useI18n();
  const text = (key: string, fallback: string) =>
    te(`settings.lighting.${key}`) ? t(`settings.lighting.${key}`) : fallback;
  const presetName = (preset: LightingPreset) =>
    preset.kind === "built_in" && preset.i18n_key && te(preset.i18n_key)
      ? t(preset.i18n_key)
      : preset.name;
  return { text, presetName };
}
