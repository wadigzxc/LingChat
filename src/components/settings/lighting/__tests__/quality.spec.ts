import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { expect, it } from "vitest";
import LightingQualityToggle from "../LightingQualityToggle.vue";
import { useSettingsStore } from "@/stores/modules/settings";
it("changes persistent quality with a labelled native checkbox", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useSettingsStore();
  const wrapper = mount(LightingQualityToggle, { global: { plugins: [pinia] } });
  expect(wrapper.get("label").text()).toContain("简化光影");
  const input = wrapper.get("input[type=checkbox]");
  expect((input.element as HTMLInputElement).checked).toBe(false);
  await input.setValue(true);
  expect(store.display.simplifiedLighting).toBe(true);
  store.update("display.simplifiedLighting", false);
  await wrapper.vm.$nextTick();
  expect((input.element as HTMLInputElement).checked).toBe(false);
});
