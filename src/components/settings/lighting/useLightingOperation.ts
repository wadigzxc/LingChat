import { ref } from "vue";
import { useUIStore } from "@/stores/modules/ui/ui";
import { useLightingText } from "./useLightingText";
export function useLightingOperation() {
  const ui = useUIStore();
  const { text, presetName } = useLightingText();
  const pending = ref(false);
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
