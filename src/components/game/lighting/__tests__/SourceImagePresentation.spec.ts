import { beforeEach, expect, it, vi } from "vitest";

it("remeasures the same source during concurrent ancestor CSS transitions and ends idle", async () => {
  const scene = document.createElement("div");
  const parent = document.createElement("div");
  scene.append(parent);
  document.body.append(scene);
  let left = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    const x = this === scene ? 0 : left;
    const width = this === scene ? 500 : 100;
    const height = this === scene ? 300 : 100;
    return { left: x, top: 0, right: x + width, bottom: height, width, height } as DOMRect;
  });
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => pending.delete(key));
  const w = mount(SourceImagePresentation, {
    attachTo: parent,
    props: {
      src: "",
      lighting: stores.game.activeLighting,
      surface: "background",
      sceneRoot: scene,
    },
  });
  const event = (type: string, propertyName: string) => {
    const e = new Event(type, { bubbles: true });
    Object.defineProperty(e, "propertyName", { value: propertyName });
    parent.dispatchEvent(e);
  };
  const offset = () => {
    const route = w.vm.getRoute();
    expect(route.kind).toBe("webgl");
    return route.kind === "webgl" ? route.spec.localToScene[4] : NaN;
  };
  event("transitionrun", "left");
  event("transitionstart", "left");
  event("transitionrun", "top");
  left = 50;
  for (const [key, callback] of [...pending]) {
    pending.delete(key);
    callback(performance.now());
  }
  expect(offset()).toBe(50);
  event("transitionend", "left");
  expect(pending.size).toBe(1);
  left = 100;
  event("transitioncancel", "top");
  expect(offset()).toBe(100);
  expect(pending.size).toBe(0);
  w.unmount();
  scene.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
import { flushPromises, mount } from "@vue/test-utils";

for (const terminal of ["deadline", "root replacement", "unmount"] as const) {
  it(`cancels CSS geometry activity on ${terminal} without late updates`, async () => {
    const scene = document.createElement("div");
    document.body.append(scene);
    let left = 0;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const x = this === scene ? 0 : left;
      return { left: x, top: 0, right: x + 500, bottom: 300, width: 500, height: 300 } as DOMRect;
    });
    const pending = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pending.set(++id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => pending.delete(key));
    const w = mount(SourceImagePresentation, {
      attachTo: scene,
      props: {
        src: "",
        lighting: stores.game.activeLighting,
        surface: "background",
        sceneRoot: scene,
      },
    });
    scene.style.transitionProperty = "left";
    scene.style.transitionDuration = "0.1s";
    const start = new Event("transitionrun");
    Object.defineProperty(start, "propertyName", { value: "left" });
    scene.dispatchEvent(start);
    expect(pending.size).toBe(1);
    const late = [...pending.values()][0];
    if (terminal === "deadline") {
      now = 351;
      left = 100;
      for (const [key, callback] of [...pending]) {
        pending.delete(key);
        callback(now);
      }
      expect(pending.size).toBe(0);
      const route = w.vm.getRoute();
      expect(route.kind === "webgl" && route.spec.localToScene[4]).toBe(100);
      w.unmount();
    } else {
      if (terminal === "root replacement")
        await w.setProps({ sceneRoot: document.createElement("div") });
      else w.unmount();
      expect(pending.size).toBe(0);
      left = 200;
      late(100);
      expect(pending.size).toBe(0);
      if (terminal === "root replacement") w.unmount();
    }
    scene.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}
import { reactive, defineComponent, h, ref } from "vue";
import { provideSceneLighting } from "@/composables/useSceneLighting";
import StaticRolePresentation from "@/components/game/standard/StaticRolePresentation.vue";
import SourceImagePresentation from "../SourceImagePresentation.vue";
it("keeps unsupported image layout at identity with a reason rather than silently assuming contain", async () => {
  const wrapper = mount(SourceImagePresentation, {
    props: {
      src: "layout.png",
      lighting: stores.game.activeLighting,
      surface: "background",
      objectFit: "17px 23px",
      position: "left top",
    },
  });
  await flushPromises();
  expect(wrapper.vm.getRoute()).toEqual({
    kind: "identity",
    legacyAllowed: false,
    reason: "unsupported-image-layout",
  });
  wrapper.unmount();
});
it("rechecks image layout when fit or position changes after mount", async () => {
  const wrapper = mount(SourceImagePresentation, {
    props: { src: "layout.png", lighting: stores.game.activeLighting, surface: "background" },
  });
  await wrapper.setProps({ objectFit: "17px 23px" });
  expect(wrapper.vm.getRoute()).toEqual({
    kind: "identity",
    legacyAllowed: false,
    reason: "unsupported-image-layout",
  });
  wrapper.unmount();
});

it("passes the scene root into the actual background and static character source consumers", async () => {
  const root = ref<HTMLElement | null>(null);
  const parent = defineComponent({
    setup() {
      (provideSceneLighting as (...args: unknown[]) => unknown)(root);
      return () =>
        h("div", { ref: root }, [
          h(GameBackground),
          h(StaticRolePresentation, {
            src: "avatar.png",
            layerStyle: {},
            animationClasses: {},
            objectFit: "contain",
          }),
        ]);
    },
  });
  const wrapper = mount(parent, {
    global: { stubs: { AudioAcrossFade: true, AmbientLoopPlayer: true } },
  });
  await flushPromises();
  const sources = wrapper.findAllComponents({ name: "SourceImagePresentation" });
  expect(sources).toHaveLength(2);
  expect(sources[0].props("sceneRoot")).toBe(root.value);
  expect(sources[1].props("sceneRoot")).toBe(root.value);
  expect(sources[1].props("surface")).toBe("character");
  // Replacement must propagate through the provided Ref without remounting either consumer.
  // Real awaited-decode/GPU/geometry permutations live in Task4 closure-v1 browser evidence.
  const background = sources[0].element;
  const character = sources[1].element;
  const replacement = document.createElement("div");
  document.body.appendChild(replacement);
  root.value = replacement;
  await flushPromises();
  const replaced = wrapper.findAllComponents({ name: "SourceImagePresentation" });
  expect(replaced[0].element).toBe(background);
  expect(replaced[1].element).toBe(character);
  expect(replaced[0].props("sceneRoot")).toBe(replacement);
  expect(replaced[1].props("sceneRoot")).toBe(replacement);
  wrapper.unmount();
  replacement.remove();
});
import GameBackground from "@/components/game/standard/GameBackground.vue";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";
const stores = vi.hoisted(() => ({ game: null as any, ui: null as any, settings: null as any }));
vi.mock("@/stores/modules/game", () => ({ useGameStore: () => stores.game }));
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => stores.ui }));
vi.mock("@/stores/modules/settings", () => ({ useSettingsStore: () => stores.settings }));
beforeEach(() => {
  stores.game = reactive({
    activeLighting: {
      ...createNeutralLighting(),
      enabled: true,
      relighting: { ...createRelightingParams(), enabled: true, target: "background" },
    },
  });
  stores.ui = reactive({
    currentBackground: "bg.png",
    currentBackgroundMusic: "None",
    ambientTracks: [],
    currentBackgroundEffect: "",
    showNotification: vi.fn(),
  });
  stores.settings = reactive({ display: { simplifiedLighting: false } });
});
it("GameBackground mounts a source-only consumer instead of lighting its particle/audio siblings", async () => {
  const wrapper = mount(GameBackground, {
    global: {
      stubs: {
        AudioAcrossFade: true,
        AmbientLoopPlayer: true,
        Rain: true,
        Snow: true,
        StarField: true,
        Sakura: true,
        Fireworks: true,
      },
    },
  });
  await flushPromises();
  expect(wrapper.find("[data-relighting-image]").exists()).toBe(true);
  const source = wrapper.get("[data-relighting-image]");
  expect(source.find("audio").exists()).toBe(false);
  expect(source.find("audio-across-fade-stub").exists()).toBe(false);
  expect(wrapper.find("[data-lighting-effect]").exists()).toBe(false);
  wrapper.unmount();
});
