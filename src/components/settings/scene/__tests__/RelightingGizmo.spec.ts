import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi } from "vitest";
import RelightingGizmo from "../RelightingGizmo.vue";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";
function setup() {
  const lighting = createNeutralLighting();
  lighting.enabled = true;
  lighting.relighting = { ...createRelightingParams(), enabled: true };
  const stage = document.createElement("div");
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 400,
    height: 200,
  } as DOMRect);
  const w = mount(RelightingGizmo, { props: { lighting, stage } });
  return { w, lighting };
}
function pointer(type: string, x: number, y: number, id = 9) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: id });
  return event;
}
describe("single lamp range", () => {
  it("keeps minimum-radius controls separately hittable without changing the circle", async () => {
    const { w, lighting } = setup();
    lighting.relighting!.point_light.radius = 0.01;
    await w.setProps({ lighting: JSON.parse(JSON.stringify(lighting)) });
    await flushPromises();
    const center = w.get("[data-relighting-center]").element as HTMLElement,
      radius = w.get("[data-relighting-radius]").element as HTMLElement;
    expect(
      Math.abs(parseFloat(radius.style.left) - parseFloat(center.style.left))
    ).toBeGreaterThanOrEqual(44);
    expect(w.get("[data-relighting-range]").attributes("style")).toContain("4px");
    w.unmount();
  });
  for (const x of [0, 1])
    it(`keeps edge ${x} controls inside the stage and large radius stable on pickup`, async () => {
      const { w, lighting } = setup();
      lighting.relighting!.point_light.x = x;
      lighting.relighting!.point_light.y = x;
      lighting.relighting!.point_light.radius = 2;
      await w.setProps({ lighting: JSON.parse(JSON.stringify(lighting)) });
      await flushPromises();
      for (const selector of ["[data-relighting-center]", "[data-relighting-radius]"]) {
        const style = (w.get(selector).element as HTMLElement).style;
        const left = parseFloat(style.left || "0") + x * 400,
          top = parseFloat(style.top || "0") + x * 200;
        expect(left).toBeGreaterThanOrEqual(22);
        expect(left).toBeLessThanOrEqual(378);
        expect(top).toBeGreaterThanOrEqual(22);
        expect(top).toBeLessThanOrEqual(178);
      }
      const handle = w.get("[data-relighting-radius]");
      handle.element.dispatchEvent(pointer("pointerdown", 100, 100));
      window.dispatchEvent(pointer("pointermove", 100, 100));
      await flushPromises();
      expect(
        (w.emitted("update:lighting")![0][0] as typeof lighting).relighting!.point_light.radius
      ).toBe(2);
      window.dispatchEvent(pointer("pointermove", 80, 100));
      await flushPromises();
      expect(
        (w.emitted("update:lighting")![1][0] as typeof lighting).relighting!.point_light.radius
      ).toBeCloseTo(1.9);
      window.dispatchEvent(pointer("pointerup", 80, 100));
      w.unmount();
    });
  it("scales its circle in scene units and adjusts bounded radius by pointer and keyboard", async () => {
    const { w, lighting } = setup();
    expect(w.get("[data-relighting-range]").attributes("style")).toContain("300px");
    const handle = w.get("[data-relighting-radius]");
    const capture = vi.fn();
    Object.assign(handle.element, {
      setPointerCapture: capture,
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    handle.element.dispatchEvent(pointer("pointerdown", 350, 100));
    window.dispatchEvent(pointer("pointermove", 400, 100));
    await flushPromises();
    expect(capture).toHaveBeenCalledWith(9);
    expect(
      (w.emitted("update:lighting")![0][0] as typeof lighting).relighting!.point_light.radius
    ).toBe(1);
    window.dispatchEvent(pointer("pointerup", 400, 100));
    await handle.trigger("keydown", { key: "ArrowRight" });
    expect(
      (w.emitted("update:lighting")![1][0] as typeof lighting).relighting!.point_light.radius
    ).toBe(0.76);
    w.unmount();
  });
  for (const terminal of ["pointercancel", "lostpointercapture", "blur"])
    it(`terminates drag on ${terminal}`, async () => {
      const { w } = setup();
      const center = w.get("[data-relighting-center]");
      Object.assign(center.element, {
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => true,
        releasePointerCapture: vi.fn(),
      });
      center.element.dispatchEvent(pointer("pointerdown", 200, 100));
      if (terminal === "blur") window.dispatchEvent(new Event("blur"));
      else if (terminal === "lostpointercapture")
        center.element.dispatchEvent(pointer(terminal, 200, 100));
      else window.dispatchEvent(pointer(terminal, 200, 100));
      window.dispatchEvent(pointer("pointermove", 10, 10));
      await flushPromises();
      expect(w.emitted("update:lighting")).toBeUndefined();
      w.unmount();
    });
});
