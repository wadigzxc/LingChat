import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
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
