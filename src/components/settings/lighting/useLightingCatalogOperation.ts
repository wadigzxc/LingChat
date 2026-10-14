import { onBeforeUnmount, ref } from "vue";
import { useUIStore } from "@/stores/modules/ui/ui";
import { useLightingText } from "./useLightingText";

/** Catalog requests may finish after their selector/editor has been removed. */
export function useLightingCatalogOperation() {
  const ui = useUIStore();
  const { text, presetName } = useLightingText();
  const pending = ref(false);
  let active = true;
  onBeforeUnmount(() => {
    active = false;
  });
  const isActive = () => active;
  async function run(action: () => Promise<void>, success?: string) {
    if (!active || pending.value) return;
    pending.value = true;
    try {
      await action();
      if (active && success) ui.showSuccess({ title: success, duration: 2000 });
    } catch (error) {
      if (active)
        ui.showError({
          title: text("failed", "操作失败"),
          message: String(error instanceof Error ? error.message : error),
          duration: 3000,
        });
    } finally {
      if (active) pending.value = false;
    }
  }
  return { pending, run, text, presetName, isActive };
}
