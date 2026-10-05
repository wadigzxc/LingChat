import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it } from "vitest";
import { persist } from "@/stores/plugins/persist";
import { useSettingsStore } from "..";
function fresh() {
  const pinia = createPinia().use(persist);
  createApp({}).use(pinia);
  setActivePinia(pinia);
  return useSettingsStore();
}
beforeEach(() => localStorage.clear());
it("defaults old settings to full lighting and restores persisted quality in a fresh store", async () => {
  localStorage.setItem("lingchat-settings", JSON.stringify({ display: { locale: "ja" } }));
  const store = fresh();
  expect(store.display.simplifiedLighting).toBe(false);
  expect(store.display.locale).toBe("ja");
  store.update("display.simplifiedLighting", true);
  await nextTick();
  expect(JSON.parse(localStorage.getItem("lingchat-settings")!).display.simplifiedLighting).toBe(
    true
  );
  expect(fresh().display.simplifiedLighting).toBe(true);
});
