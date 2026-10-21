import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import LightingEffectGroup from "../lighting/LightingEffectGroup.vue";

const props = {
  groupId: "bloom",
  title: "Bloom",
  enableLabel: "Bloom enabled",
  enableField: "bloom.enabled",
  enabled: false,
};
function group(enabled = false) {
  return mount(LightingEffectGroup, {
    props: { ...props, enabled },
    slots: { default: '<input aria-label="Presetune" />' },
  });
}
// FIRST-GREEN regression coverage: the producer was implemented by consumer-first RED→GREEN.
describe("LightingEffectGroup disclosure contract", () => {
  for (const enabled of [false, true])
    it(`initializes ${enabled} without emitting`, () => {
      const w = group(enabled);
      expect(w.get("button").attributes()).toMatchObject({
        type: "button",
        "aria-expanded": String(enabled),
      });
      expect(w.get("[data-effect-body]").isVisible()).toBe(enabled);
      expect(w.get('input[type="checkbox"]').element).toHaveProperty("checked", enabled);
      expect(w.emitted("update:enabled")).toBeUndefined();
    });
  it("uses sibling focusable controls, hidden arrow, and a unique controlled body per occurrence", () => {
    const w = mount(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(LightingEffectGroup, props),
            h(LightingEffectGroup, props),
            h(LightingEffectGroup, { ...props, groupId: "relighting" }, () =>
              h(LightingEffectGroup, props)
            ),
          ]),
      })
    );
    const ids = w.findAll("[data-effect-body]").map((body) => body.attributes("id"));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const g of w.findAllComponents(LightingEffectGroup)) {
      const button = g.get("button");
      const checkbox = g.get('input[type="checkbox"]');
      expect(button.element.parentElement).toBe(checkbox.element.parentElement);
      expect(button.find("input").exists()).toBe(false);
      expect(checkbox.element.closest("button")).toBeNull();
      expect(button.element.closest("label")).toBeNull();
      expect(button.get("span").attributes("aria-hidden")).toBe("true");
      expect(button.attributes("aria-controls")).toBe(g.get("[data-effect-body]").attributes("id"));
      expect(checkbox.attributes()).toMatchObject({
        "data-field": "bloom.enabled",
        "aria-label": "Bloom enabled",
      });
    }
  });
  for (const enabled of [false, true])
    it(`manual disclosure does not emit or change enabled=${enabled}`, async () => {
      const w = group(enabled);
      await w.get("button").trigger("click");
      expect(w.get("button").attributes("aria-expanded")).toBe(String(!enabled));
      expect(w.get('input[type="checkbox"]').element).toHaveProperty("checked", enabled);
      expect(w.emitted("update:enabled")).toBeUndefined();
      await w.setProps({ title: "Translated", enableLabel: "Localized enabled", enabled });
      expect(w.get("button").attributes("aria-expanded")).toBe(String(!enabled));
      await w.setProps({ enabled: !enabled });
      expect(w.get("button").attributes("aria-expanded")).toBe(String(!enabled));
      await w.setProps({ enabled });
      expect(w.get("button").attributes("aria-expanded")).toBe(String(enabled));
    });
  it("emits only user enable intent and relies on the accepted flag rather than manufacturing model state", async () => {
    const w = group(false);
    await w.get('input[type="checkbox"]').setValue(true);
    expect(w.emitted("update:enabled")).toEqual([[true]]);
    expect(w.get("button").attributes("aria-expanded")).toBe("false");
    await w.setProps({ enabled: true });
    expect(w.get("button").attributes("aria-expanded")).toBe("true");
    await w.get('input[type="checkbox"]').setValue(false);
    expect(w.emitted("update:enabled")).toEqual([[true], [false]]);
    await w.setProps({ enabled: false });
    expect(w.get("[data-effect-body]").isVisible()).toBe(false);
  });
  it("does not submit an enclosing form when toggling disclosure", async () => {
    let submits = 0;
    const w = mount(
      defineComponent({
        setup: () => () =>
          h(
            "form",
            {
              onSubmit: (e: Event) => {
                e.preventDefault();
                submits++;
              },
            },
            [h(LightingEffectGroup, props)]
          ),
      }),
      { attachTo: document.body }
    );
    (w.get("button").element as HTMLButtonElement).click();
    await nextTick();
    expect(submits).toBe(0);
    expect(w.get("button").attributes("aria-expanded")).toBe("true");
  });
  it("inherits the native pending-save fieldset disabled boundary for both header controls", async () => {
    let updates = 0;
    const disabled = ref(true);
    const w = mount(
      defineComponent({
        setup: () => () =>
          h("fieldset", { disabled: disabled.value }, [
            h(LightingEffectGroup, { ...props, "onUpdate:enabled": () => updates++ }),
          ]),
      }),
      { attachTo: document.body }
    );
    const button = w.get("button").element as HTMLButtonElement;
    const checkbox = w.get("input").element as HTMLInputElement;
    expect(button.matches(":disabled")).toBe(true);
    expect(checkbox.matches(":disabled")).toBe(true);
    button.click();
    checkbox.click();
    await nextTick();
    expect(updates).toBe(0);
    expect(w.get("button").attributes("aria-expanded")).toBe("false");
    disabled.value = false;
    await nextTick();
    button.click();
    checkbox.click();
    await nextTick();
    expect(updates).toBe(1);
    expect(w.get("button").attributes("aria-expanded")).toBe("true");
  });
  it("fresh mount forgets a prior instance manual choice", async () => {
    const old = group(true);
    await old.get("button").trigger("click");
    expect(old.get("button").attributes("aria-expanded")).toBe("false");
    old.unmount();
    const fresh = group(true);
    expect(fresh.get("button").attributes("aria-expanded")).toBe("true");
  });
});
