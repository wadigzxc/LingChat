import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ImageAcrossFade from "../ImageAcrossFade.vue";
import type { ImageVisualController } from "@/utils/scene-lighting/relighting/types";

const images: HTMLImageElement[] = [];
function loader() {
  vi.stubGlobal("Image", function () {
    const img = document.createElement("img");
    Object.defineProperties(img, { naturalWidth: { value: 40 }, naturalHeight: { value: 20 } });
    img.decode = vi.fn().mockResolvedValue(undefined);
    images.push(img);
    return img;
  });
}
afterEach(() => {
  images.length = 0;
  vi.unstubAllGlobals();
});
it("exports the decoded borrowed source at the same waitForLoad boundary", async () => {
  loader();
  const wrapper = mount(ImageAcrossFade, {
    props: { src: "first.png", duration: 300 },
    attachTo: document.body,
  });
  images[0].onload!(new Event("load"));
  await flushPromises();
  const controller = wrapper.vm as unknown as ImageVisualController;
  await controller.waitForLoad();
  expect(typeof controller.getFrame).toBe("function");
  const frame = controller.getFrame();
  expect(frame.layers).toHaveLength(1);
  expect(frame.layers[0].source.resource).toBe(images[0]);
  expect(frame.layers[0].source.ownership).toBe("borrowed");
  expect(frame.layers[0].source.naturalSizePx).toEqual([40, 20]);
  wrapper.unmount();
});
it("retires the scheduled fade on unmount before rAF", async () => {
  loader();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    callbacks.push(fn);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const wrapper = mount(ImageAcrossFade, { props: { src: "first.png" } });
  images[0].onload!(new Event("load"));
  await flushPromises();
  const controller = wrapper.vm as unknown as ImageVisualController;
  const listener = vi.fn();
  controller.subscribeFrame(listener);
  wrapper.unmount();
  callbacks.forEach((fn) => fn(10));
  expect(controller.getFrame().transitionActive).toBe(false);
  expect(listener).not.toHaveBeenCalled();
});
it("samples actual CSS opacity without inventing an easing clock", async () => {
  loader();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    callbacks.push(fn);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const wrapper = mount(ImageAcrossFade, {
    props: { src: "first.png", duration: 300 },
    attachTo: document.body,
  });
  images[0].onload!(new Event("load"));
  await flushPromises();
  const listener = vi.fn();
  (wrapper.vm as unknown as ImageVisualController).subscribeFrame(listener);
  (wrapper.findAll("div")[2].element as HTMLElement).style.opacity = "0.37";
  callbacks.shift()!(performance.now());
  await flushPromises();
  expect(listener).toHaveBeenCalled();
  expect(listener.mock.calls[0][0].layers[0].opacity).toBe(0.37);
  expect(listener.mock.calls[0][0].transitionActive).toBe(true);
  wrapper.unmount();
});
it("uses fractional visual bounds rather than rounded clientWidth for the source frame", async () => {
  loader();
  const wrapper = mount(ImageAcrossFade, {
    props: { src: "fractional.png", objectFit: "cover" },
    attachTo: document.body,
  });
  Object.defineProperty(wrapper.element, "clientWidth", { configurable: true, value: 100 });
  Object.defineProperty(wrapper.element, "clientHeight", { configurable: true, value: 50 });
  vi.spyOn(wrapper.element, "getBoundingClientRect").mockReturnValue({
    width: 100.5,
    height: 50.25,
  } as DOMRect);
  images[0].onload!(new Event("load"));
  await flushPromises();
  const frame = (wrapper.vm as unknown as ImageVisualController).getFrame();
  expect(frame.layers[0].drawRectCss).toEqual([0, 0, 100.5, 50.25]);
  wrapper.unmount();
});
it("reports only the current failed source to fallback hosts, not late failures", async () => {
  loader();
  const w = mount(ImageAcrossFade, { props: { src: "A.png" } });
  await w.setProps({ src: "B.png" });
  images[0].onerror!(new Event("error"));
  await flushPromises();
  expect(w.emitted("sourceError")).toBeUndefined();
  images[1].onerror!(new Event("error"));
  await flushPromises();
  expect(w.emitted("sourceError")).toEqual([["B.png"]]);
  w.unmount();
});
it("duration zero settles the current source without an active animation loop", async () => {
  loader();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    callbacks.push(fn);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const wrapper = mount(ImageAcrossFade, { props: { src: "instant.png", duration: 0 } });
  images[0].onload!(new Event("load"));
  await flushPromises();
  callbacks.shift()!(performance.now());
  const frame = (wrapper.vm as unknown as ImageVisualController).getFrame();
  expect(frame.transitionActive).toBe(false);
  expect(frame.layers[0].opacity).toBe(1);
  expect(callbacks).toHaveLength(0);
  wrapper.unmount();
});
