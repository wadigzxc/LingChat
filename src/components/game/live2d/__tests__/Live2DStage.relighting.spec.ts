import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import Live2DStage from "../Live2DStage.vue";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";
const fixture = vi.hoisted(() => ({
  game: null as any,
  app: null as any,
  runtimeGate: null as Promise<void> | null,
  bind: vi.fn(),
  update: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("@/composables/useSceneLighting", () => ({
  useSceneLighting: () => ({
    lighting: {
      get value() {
        return fixture.game.lighting;
      },
    },
    sceneRoot: { value: null },
  }),
}));
vi.mock("@/utils/scene-lighting/relighting/geometry", async (original) => ({
  ...(await original<typeof import("@/utils/scene-lighting/relighting/geometry")>()),
  sceneProvider: () => ({ sizeCss: [320, 180] }),
  sourceMeasure: () => ({ sizeCss: [320, 180], localToScene: [1, 0, 0, 1, 0, 0] }),
  observeGeometry: () => () => {},
}));
vi.mock("@/utils/scene-lighting/relighting/bindings", () => ({
  bindPixiCharacterSurface: fixture.bind,
}));
vi.mock("../live2d-runtime", () => ({
  loadLive2dRuntime: async () => {
    await fixture.runtimeGate;
    return {
      pixi: {
        Application: class {
          constructor() {
            return fixture.app;
          }
        },
      },
      engine: {},
    };
  },
}));
beforeEach(() => {
  fixture.game = reactive({
    lighting: {
      ...createNeutralLighting(),
      enabled: true,
      relighting: { ...createRelightingParams(), enabled: true },
    },
  });
  fixture.runtimeGate = null;
  fixture.update.mockReset();
  fixture.dispose.mockReset();
  fixture.bind.mockReset();
  fixture.bind.mockReturnValue({
    update: fixture.update,
    dispose: fixture.dispose,
    getState: () => ({ kind: "active" }),
  });
  fixture.app = {
    init: vi.fn(async () => {}),
    destroy: vi.fn(),
    canvas: document.createElement("canvas"),
    renderer: { gl: {}, on: vi.fn(), off: vi.fn() },
    screen: { x: 0, y: 0, width: 320, height: 180 },
    stage: {},
    ticker: { speed: 1, add: vi.fn() },
  };
});
it("remeasures the host after actual renderer resize without borrowing a ticker listener", async () => {
  const w = mount(Live2DStage, { props });
  await flushPromises();
  expect(fixture.app.renderer.on).toHaveBeenCalledWith("resize", expect.any(Function));
  const resize = fixture.app.renderer.on.mock.calls[0][1];
  fixture.update.mockClear();
  fixture.app.screen.width = 400;
  resize();
  expect(fixture.update).toHaveBeenCalledOnce();
  expect(fixture.bind.mock.calls[0][0].screen.width).toBe(400);
  w.unmount();
  expect(fixture.app.renderer.off).toHaveBeenCalledWith("resize", resize);
});
it("unmount during SDK runtime await never allocates or binds a late application", async () => {
  let release!: () => void;
  fixture.runtimeGate = new Promise((resolve) => {
    release = resolve;
  });
  const w = mount(Live2DStage, { props });
  await flushPromises();
  w.unmount();
  release();
  await flushPromises();
  expect(fixture.app.init).not.toHaveBeenCalled();
  expect(fixture.bind).not.toHaveBeenCalled();
});
const props = {
  roles: [
    { roleId: 1, live2d: { default_variant: "missing", clothes_variants: {}, variants: {} } },
  ] as any,
  mode: "standard" as const,
  activeSpeakerId: null,
  audioElement: null,
  voiceDataUrl: "",
};
it("binds the actual SDK application stage to source-only lighting and detaches before owner teardown", async () => {
  const w = mount(Live2DStage, { props });
  await flushPromises();
  expect(fixture.bind).toHaveBeenCalledOnce();
  expect(fixture.bind.mock.calls[0][0].stage).toBe(fixture.app.stage);
  expect(fixture.update.mock.calls[fixture.update.mock.calls.length - 1]?.[0].kind).toBe("webgl");
  fixture.game.lighting.relighting.target = "background";
  await flushPromises();
  expect(fixture.update.mock.calls[fixture.update.mock.calls.length - 1]?.[0]).toMatchObject({
    kind: "identity",
    legacyAllowed: false,
  });
  fixture.game.lighting.relighting.enabled = false;
  await flushPromises();
  expect(fixture.update.mock.calls[fixture.update.mock.calls.length - 1]?.[0]).toMatchObject({
    kind: "legacy",
    legacyAllowed: true,
  });
  expect(fixture.app.ticker.add).toHaveBeenCalledTimes(1);
  w.unmount();
  expect(fixture.dispose).toHaveBeenCalledOnce();
  expect(fixture.dispose.mock.invocationCallOrder[0]).toBeLessThan(
    fixture.app.destroy.mock.invocationCallOrder[0]
  );
});
