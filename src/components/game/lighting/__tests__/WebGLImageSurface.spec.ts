import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import WebGLImageSurface from "../WebGLImageSurface.vue";
import type {
  AdapterState,
  ImageBinding,
  ImageVisualFrame,
  SurfaceRoute,
} from "@/utils/scene-lighting/relighting/types";
const mock = vi.hoisted(() => ({
  calls: [] as { notify: (s: AdapterState) => void; binding: ImageBinding }[],
  hold: false,
  resolvers: [] as (() => void)[],
}));
vi.mock("@/utils/scene-lighting/relighting/bindings", () => ({
  createDomImageBinding: async (_canvas: HTMLCanvasElement, notify: (s: AdapterState) => void) => {
    const binding = {
      setFrame: vi.fn(),
      update: vi.fn(),
      getState: () => ({ kind: "identity", reason: "loading" }) as AdapterState,
      dispose: vi.fn(),
    };
    mock.calls.push({ notify, binding });
    if (mock.hold) await new Promise<void>((r) => mock.resolvers.push(r));
    return binding;
  },
}));
const frame: ImageVisualFrame = {
  requestToken: 1,
  revision: 1,
  layers: [],
  transitionActive: false,
};
const route: SurfaceRoute = {
  kind: "webgl",
  legacyAllowed: false,
  spec: {
    sourceSizeCss: [8, 8],
    localToScene: [1, 0, 0, 1, 0, 0],
    lightSceneCss: [4, 4],
    radiusSceneCss: 4,
    softness: 0,
    baseSignedLinear: [1, 1, 1],
    pointLinear: [0, 0, 0],
  },
};
beforeEach(() => {
  mock.calls = [];
  mock.resolvers = [];
  mock.hold = false;
});
it("does not emit a retired binding callback after hidden reactivation", async () => {
  const wrapper = mount(WebGLImageSurface, { props: { route, frame } });
  await flushPromises();
  const first = mock.calls[0];
  await wrapper.setProps({ visible: false });
  await wrapper.setProps({ visible: true });
  await flushPromises();
  expect(mock.calls).toHaveLength(2);
  const before = wrapper.emitted("state")?.length ?? 0;
  first.notify({ kind: "active", sourceRevision: 1 });
  expect(wrapper.emitted("state")?.length ?? 0).toBe(before);
  mock.calls[1].notify({ kind: "active", sourceRevision: 1 });
  expect(wrapper.emitted("state")?.length).toBe(before + 1);
  wrapper.unmount();
});
it("disposes a binding returned after component unmount without frame or route updates", async () => {
  mock.hold = true;
  const wrapper = mount(WebGLImageSurface, { props: { route, frame } });
  await flushPromises();
  expect(mock.calls).toHaveLength(1);
  wrapper.unmount();
  mock.resolvers[0]();
  await flushPromises();
  expect(mock.calls[0].binding.dispose).toHaveBeenCalledOnce();
  expect(mock.calls[0].binding.setFrame).not.toHaveBeenCalled();
  expect(mock.calls[0].binding.update).not.toHaveBeenCalled();
});
it("hidden and identity props never create a renderer binding", async () => {
  const wrapper = mount(WebGLImageSurface, { props: { route, frame, visible: false } });
  await flushPromises();
  expect(mock.calls).toHaveLength(0);
  expect(wrapper.find("canvas").exists()).toBe(false);
  await wrapper.setProps({
    visible: true,
    route: { kind: "identity", legacyAllowed: false, reason: "compare-bypass" },
  });
  await flushPromises();
  expect(mock.calls).toHaveLength(0);
  wrapper.unmount();
});
