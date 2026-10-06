import type { LightingPreset } from "@/types/scene-lighting";
import { ref } from "vue";
import { useUIStore } from "@/stores/modules/ui/ui";
import { useI18n } from "vue-i18n";
/** Task 17 can supply keys without replacing the UI's existing i18n/toast mechanism. */
export function useLightingOperation() {
  const ui = useUIStore();
  const { t, te } = useI18n();
  const pending = ref(false);
  const text = (key: string, fallback: string) =>
    te(`settings.lighting.${key}`) ? t(`settings.lighting.${key}`) : fallback;
  const presetName = (preset: LightingPreset) =>
    preset.kind === "built_in" && preset.i18n_key && te(preset.i18n_key)
      ? t(preset.i18n_key)
      : preset.name;
  async function run(action: () => Promise<void>, success?: string) {
    if (pending.value) return;
    pending.value = true;
    try {
      await action();
      if (success) ui.showSuccess({ title: success, duration: 2000 });
    } catch (error) {
      ui.showError({
        title: text("failed", "操作失败"),
        message: String(error instanceof Error ? error.message : error),
        duration: 3000,
      });
    } finally {
      pending.value = false;
    }
  }
  return { pending, run, text, presetName };
}
