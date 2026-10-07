import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { tauriMocks, resetTauriMocks } from "@/test/setup";
import { invoke } from "@tauri-apps/api/core";
const invokeMock = vi.mocked(invoke);
import { provideSceneLighting } from "@/composables/useSceneLighting";
import ImageAcrossFade from "@/components/ui/ImageAcrossFade.vue";
import GameBackground from "../GameBackground.vue";
import GameRoleAvatar from "../GameRoleAvatar.vue";
import GameRolesStage from "../GameRolesStage.vue";
vi.mock("@/composables/useAsrInput", () => ({ setVoicePlaying: vi.fn() }));
vi.mock("@/components/game/live2d/Live2DStage.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      setup(_, { slots }) {
        return () => h("div", { "data-live2d-stage": "" }, [h("canvas"), slots.default?.()]);
      },
    }),
  };
});
import { live2dStageContextKey } from "@/components/game/live2d/live2d-stage-context";
import type { GameRole } from "@/stores/modules/game/state";
const stores = vi.hoisted(() => ({
  game: null as any,
  ui: null as any,
  settings: null as any,
  editor: null as any,
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("vue-i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key, te: () => false }),
}));
vi.mock("@/stores/modules/script-editor", () => ({ useScriptEditorStore: () => stores.editor }));
vi.mock("@/api/services/config", () => ({
  getEnvConfigByKey: vi.fn(async () => ({ value: "false" })),
}));
vi.mock("@/core/events/event-queue", () => ({
  eventQueue: { resume: vi.fn(), clear: vi.fn(), peek: vi.fn() },
}));
vi.mock("@/core/events/dialogue-merge", () => ({
  dialogueMerge: { armed: false, isAudioPlaying: false },
}));
vi.mock("@/components/tools/FreeModeTools.vue", () => ({
  default: { template: "<div data-ui />" },
}));
vi.mock("@/components/tools/ToolActivityStatus.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/tools/FullAccessWarning.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/ui/ImageSourcePicker.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/views/LoadingTransition.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/game/standard/GameExtraUI.vue", () => ({
  default: { template: "<div data-extra-ui />" },
}));
vi.mock("@/components/game/standard/GameDialog.vue", () => ({
  default: { template: "<div data-dialog />" },
}));
vi.mock("@/components/schedule/SchedulePanel.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@/components/settings/SettingsPanel.vue", () => ({ default: { template: "<div />" } }));
import MainChat from "@/components/views/MainChat.vue";
import CastWindow from "@/components/views/CastWindow.vue";
import PreviewStage from "@/components/script-editor/preview/PreviewStage.vue";
vi.mock("@/stores/modules/game", () => ({ useGameStore: () => stores.game }));
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => stores.ui }));
vi.mock("@/stores/modules/settings", () => ({ useSettingsStore: () => stores.settings }));
const stubs = {
  ImageAcrossFade: { template: "<div data-image />", methods: { waitForLoad: async () => {} } },
  AudioAcrossFade: true,
  AmbientLoopPlayer: true,
  StarField: true,
  Rain: true,
  Sakura: true,
  Snow: true,
  Fireworks: true,
};
function cssFilter(el: Element) {
  const style = (el as HTMLElement).style;
  return style.filter || style.getPropertyValue("-webkit-filter");
}
function lighting() {
  const l = createNeutralLighting();
  l.enabled = true;
  l.link_character_background = false;
  l.background.brightness = 0.8;
  l.character.brightness = 1.4;
  l.background_ambient = { enabled: true, color: "#123456", opacity: 0.2 };
  l.character_ambient = { enabled: true, color: "#654321", opacity: 0.3 };
  l.main_light.enabled = true;
  l.main_light.opacity = 0.5;
  l.main_light.target = "background";
  l.bloom = { enabled: true, target: "background", color: "#ffffff", radius: 8, intensity: 0.4 };
  return l;
}
beforeEach(() => {
  resetTauriMocks();
  stores.settings = reactive({
    display: { simplifiedLighting: false },
    text: { mergeLineDelay: 200 },
    update: (_path: string, value: boolean) => {
      stores.settings.display.simplifiedLighting = value;
    },
  });
  stores.editor = reactive({ previewing: true, detail: null, readiness: null });
  stores.game = reactive({
    activeLighting: lighting(),
    currentScene: { lighting: createNeutralLighting() },
    lightingRevision: 10,
    presentRoleIds: [1],
    presentRolesList: [],
    applySceneState: vi.fn(),
    initialized: true,
    currentStatus: "input",
    command: "touch",
  });
  stores.ui = reactive({
    currentBackground: "https://test/bg.png",
    currentBackgroundMusic: "None",
    ambientTracks: [],
    currentBackgroundEffect: "",
    aspectRatio: 1.5,
    viewportHeight: 800,
    showNotification: vi.fn(),
  });
});
function asset(
  id: string,
  target: "background" | "character" | "both",
  placement: "behind" | "front"
) {
  return {
    id,
    asset_hash: id.padEnd(64, "a"),
    target,
    placement,
    z_index: 7,
    opacity: 1,
    media_type: "image/png",
    blend_mode: "normal",
    fit: "cover",
    required: false,
  };
}
function role(live2d = false): GameRole {
  return {
    roleId: 1,
    live2d,
    show: true,
    scale: 0.8,
    offsetX: 15,
    offsetY: 20,
    character_folder: "test",
    emotion: "正常",
    clothesName: "默认",
    bodyPart: [],
    bubbleLeft: 30,
    bubbleTop: 20,
  } as unknown as GameRole;
}
function setupOverall() {
  stores.game.activeLighting.main_light.target = "both";
  stores.game.activeLighting.bloom.target = "both";
  stores.game.activeLighting.vignette = {
    enabled: true,
    color: "#000000",
    intensity: 0.6,
    radius: 0.6,
    softness: 0.3,
  };
  stores.game.activeLighting.asset_layers = [
    asset("b", "both", "behind"),
    asset("c", "both", "front"),
  ];
  stores.game.presentRolesList = [role()];
  invokeMock.mockImplementation(async (command: string, args?: any) =>
    command === "get_avatar_file"
      ? "G:/avatar.png"
      : command === "resolve_lighting_asset"
        ? { hash: args.hash, supported: true, asset_protocol_path: `G:/${args.hash}.png` }
        : command === "cast_get_snapshot"
          ? {
              backgroundEffect: "",
              presentRoleIds: [1],
              currentRoleId: 1,
              lightingRevision: 10,
              currentSceneId: null,
              activeLighting: stores.game.activeLighting,
            }
          : command === "cast_get_status"
            ? {}
            : undefined
  );
}
function verifyOverall(wrapper: ReturnType<typeof mount>) {
  expect(wrapper.findAll("[data-lighting-final]")).toHaveLength(2);
  const behind = wrapper.get('[data-lighting-overall="behind"]');
  const front = wrapper.get('[data-lighting-overall="front"]');
  expect((behind.element as HTMLElement).style.zIndex).toBe("1");
  expect((front.element as HTMLElement).style.zIndex).toBe("3");
  expect(behind.findAll('[data-lighting-assets="behind"]')).toHaveLength(1);
  expect(front.findAll('[data-lighting-assets="front"]')).toHaveLength(1);
  expect(front.findAll('[data-lighting-effect="vignette"]')).toHaveLength(1);
  expect(behind.find('[data-lighting-effect="vignette"]').exists()).toBe(false);
  expect(wrapper.findAll('[data-lighting-effect="main"]')).toHaveLength(1);
  expect(wrapper.findAll('[data-lighting-effect="bloom"]')).toHaveLength(1);
  expect(front.find('[data-lighting-effect="main"]').exists()).toBe(true);
  expect(
    wrapper.get("[data-dialog]").element.closest("[data-lighting-dialog]")?.getAttribute("style")
  ).toContain("z-index: 4");
  expect(wrapper.get("[data-lighting-background]").attributes("style")).toContain("z-index: 0");
  expect(wrapper.get("[data-lighting-stage]").attributes("style")).toContain("z-index: 2");
}
it.each(["cast", "preview"])(
  "%s consumes simplified quality while keeping ambient/main/vignette",
  async (kind) => {
    setupOverall();
    stores.settings.display.simplifiedLighting = true;
    const play = HTMLMediaElement.prototype.play;
    const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!;
    const wrapper = mount(kind === "cast" ? CastWindow : PreviewStage, {
      global: { stubs: { ...stubs, teleport: true }, mocks: { $t: (key: string) => key } },
    });
    await flushPromises();
    try {
      expect(wrapper.findAll("[data-lighting-assets]")).toHaveLength(0);
      expect(wrapper.find('[data-lighting-effect="bloom"]').exists()).toBe(false);
      expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(true);
      expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
      expect(wrapper.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
      expect(stores.game.lightingRevision).toBe(10);
    } finally {
      wrapper.unmount();
      HTMLMediaElement.prototype.play = play;
      Object.defineProperty(HTMLMediaElement.prototype, "volume", volume);
    }
  }
);
it("MainChat exposes a usable quality switch above lighting without changing runtime revision", async () => {
  setupOverall();
  const wrapper = mount(MainChat, { global: { stubs, mocks: { $t: (key: string) => key } } });
  await flushPromises();
  const toggle = wrapper.get('input[type="checkbox"]');
  expect(toggle.element.closest("#menu-panel")).not.toBeNull();
  await toggle.setValue(true);
  expect(stores.settings.display.simplifiedLighting).toBe(true);
  expect(wrapper.findAll("[data-lighting-assets]")).toHaveLength(0);
  expect(wrapper.find('[data-lighting-effect="bloom"]').exists()).toBe(false);
  expect(wrapper.find('[data-lighting-effect="vignette"]').exists()).toBe(true);
  expect(wrapper.find('[data-lighting-effect="main"]').exists()).toBe(true);
  expect(stores.game.lightingRevision).toBe(10);
  expect(stores.game.activeLighting.bloom.enabled).toBe(true);
  expect(stores.game.activeLighting.asset_layers).toHaveLength(2);
});
it("PreviewStage uses the same Final and single overall slots inside its teleported stage", async () => {
  setupOverall();
  const wrapper = mount(PreviewStage, {
    global: { stubs: { ...stubs, teleport: true }, mocks: { $t: (key: string) => key } },
  });
  await flushPromises();
  verifyOverall(wrapper);
});
it("CastWindow mounts Final slots with overall effects below dialogue and preserves cast layout", async () => {
  setupOverall();
  const play = HTMLMediaElement.prototype.play;
  const volume = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!;
  const wrapper = mount(CastWindow, { global: { stubs, mocks: { $t: (key: string) => key } } });
  await flushPromises();
  try {
    verifyOverall(wrapper);
    expect(wrapper.find(".cast-role-layer").exists()).toBe(true);
  } finally {
    wrapper.unmount();
    HTMLMediaElement.prototype.play = play;
    Object.defineProperty(HTMLMediaElement.prototype, "volume", volume);
  }
});
it("MainChat mounts single overall effects and Final PNG/vignette between stage and dialog", async () => {
  setupOverall();
  const wrapper = mount(MainChat, { global: { stubs, mocks: { $t: (key: string) => key } } });
  await flushPromises();
  verifyOverall(wrapper);
});
it("a host shares one reactive asset cache with background and character consumers", async () => {
  stores.game.activeLighting.asset_layers = [
    asset("b", "background", "front"),
    asset("b", "character", "front"),
  ];
  invokeMock.mockImplementation(async (command: string, args?: any) =>
    command === "get_avatar_file"
      ? "G:/avatar.png"
      : { hash: args.hash, supported: true, asset_protocol_path: "G:/shared.png" }
  );
  const Host = defineComponent({
    setup() {
      provideSceneLighting();
      return () => h("div", [h(GameBackground), h(GameRoleAvatar, { role: role() })]);
    },
  });
  const wrapper = mount(Host, { global: { stubs } });
  await flushPromises();
  expect(wrapper.findAll('img[src*="shared.png"]')).toHaveLength(2);
  expect(
    invokeMock.mock.calls.filter(([command]) => command === "resolve_lighting_asset")
  ).toHaveLength(1);
});
it("role stage has no screen-wide character overlay or legacy gradient", async () => {
  stores.game.presentRolesList = [role()];
  stores.game.currentInteractRoleId = 1;
  stores.game.currentScene.lighting = {
    overlay_enabled: true,
    overlay_target: "character",
    blend_mode: "normal",
    light_x: 20,
    light_y: 30,
    overlay_color1: "#ff0000",
    overlay_color2: "#00000000",
    overlay_radius: 50,
    overlay_opacity: 1,
  };
  stores.game.activeLighting.main_light.target = "character";
  invokeMock.mockResolvedValue("G:/avatar.png");
  const wrapper = mount(GameRolesStage, { global: { stubs } });
  await flushPromises();
  const outsideVisual = Array.from(
    (wrapper.element as HTMLElement).querySelectorAll("[style]")
  ).filter(
    (el) =>
      (el as HTMLElement).style.background.includes("radial-gradient") &&
      !el.closest("[data-lighting-frame]")
  );
  expect(outsideVisual).toHaveLength(0);
  expect(wrapper.findAll('[data-lighting-effect="main"]')).toHaveLength(1);
  expect(
    wrapper.get('[data-lighting-effect="main"]').element.closest("[data-lighting-frame]")
  ).not.toBeNull();
  expect(wrapper.get("[data-lighting-stage]").attributes("style")).toContain("z-index: 2");
});
it("static character keeps fixed PNG slots and simplified color/rim without bloom", async () => {
  stores.game.activeLighting.asset_layers = [
    asset("b", "character", "behind"),
    asset("c", "character", "front"),
  ];
  stores.game.activeLighting.bloom.target = "character";
  stores.game.activeLighting.rim_light = {
    enabled: true,
    color: "#abcdef",
    intensity: 0.4,
    width: 3,
    softness: 2,
    angle: 90,
    offset: 1,
  };
  stores.game.activeLighting.main_light.target = "character";
  invokeMock.mockImplementation(async (command: string, args?: any) =>
    command === "get_avatar_file"
      ? "G:/avatar.png"
      : { hash: args.hash, supported: true, asset_protocol_path: `G:/${args.hash}.png` }
  );
  const wrapper = mount(GameRoleAvatar, { props: { role: role() }, global: { stubs } });
  await flushPromises();
  const frame = wrapper.get("[data-lighting-frame]");
  const slots = Array.from(frame.element.children).map((el) =>
    el.hasAttribute("data-lighting-visual")
      ? "visual"
      : el.hasAttribute("data-lighting-character-effects")
        ? "effects"
        : el.getAttribute("data-lighting-assets")
  );
  expect(slots).toEqual(["behind", "visual", "effects", "front"]);
  expect(frame.findAll('[data-lighting-effect="main"]')).toHaveLength(1);
  expect(frame.findAll('[data-lighting-effect="bloom"]')).toHaveLength(0);
  expect(cssFilter(frame.get("[data-lighting-visual]").element)).toContain("drop-shadow(0 0 8px");
  stores.settings.display.simplifiedLighting = true;
  await nextTick();
  expect(frame.findAll("img")).toHaveLength(0);
  const filter = cssFilter(frame.get("[data-lighting-visual]").element);
  expect(filter).toContain("brightness(1.4)");
  expect(filter).toContain("drop-shadow(1px 0px 2px");
  expect(filter).not.toContain("drop-shadow(0 0 8px");
  expect(frame.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
  expect(frame.find('[data-lighting-effect="main"]').exists()).toBe(true);
});
it("lights only a visible Live2D static fallback, not a hidden or missing fallback", async () => {
  const ready = ref(new Set<number>());
  const r = reactive(role(true));
  invokeMock.mockResolvedValue("G:/fallback.png");
  const wrapper = mount(GameRoleAvatar, {
    props: { role: r },
    global: {
      stubs,
      provide: {
        [live2dStageContextKey as symbol]: {
          readyRoleIds: ready,
          unavailableRoleIds: ref(new Set([1])),
        },
      },
      mocks: { $t: (key: string) => key },
    },
  });
  await flushPromises();
  expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
  expect((wrapper.get("[data-image]").element as HTMLElement).style.display).not.toBe("none");
  r.show = false;
  await nextTick();
  expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("none");
  expect(wrapper.find("[data-lighting-character-effects]").exists()).toBe(false);
  r.show = true;
  invokeMock.mockRejectedValue(new Error("no fallback"));
  r.clothesName = "other";
  await flushPromises();
  expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("none");
});
it("real fallback artwork does not remain visible after its URL disappears", async () => {
  class LoadedImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
    decode() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("Image", LoadedImage);
  const ready = ref(new Set<number>());
  const r = reactive(role(true));
  invokeMock.mockResolvedValue("G:/fallback.png");
  const wrapper = mount(GameRoleAvatar, {
    props: { role: r },
    global: {
      stubs: { ...stubs, ImageAcrossFade: false },
      provide: {
        [live2dStageContextKey as symbol]: {
          readyRoleIds: ready,
          unavailableRoleIds: ref(new Set([1])),
        },
      },
      mocks: { $t: (key: string) => key },
    },
  });
  try {
    await flushPromises();
    expect(
      wrapper
        .get("[data-lighting-visual]")
        .findAll("[style]")
        .some((el) => (el.element as HTMLElement).style.backgroundImage.includes("fallback.png"))
    ).toBe(true);
    expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
    ready.value.add(1);
    await nextTick();
    expect(wrapper.getComponent(ImageAcrossFade).attributes("style")).toContain("display: none");
    expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("none");
    expect(wrapper.find("[data-lighting-character-effects]").exists()).toBe(false);
    ready.value.delete(1);
    await nextTick();
    r.show = false;
    await nextTick();
    expect(wrapper.get("[data-lighting-frame]").attributes("style")).toContain("opacity: 0");
    expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("none");
    r.show = true;
    await nextTick();
    invokeMock.mockRejectedValue(new Error("missing fallback"));
    r.clothesName = "missing";
    await flushPromises();
    expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("none");
    expect(
      wrapper
        .get("[data-lighting-visual]")
        .findAll("[style]")
        .some((el) => (el.element as HTMLElement).style.backgroundImage.includes("fallback.png"))
    ).toBe(false);
  } finally {
    wrapper.unmount();
    vi.unstubAllGlobals();
  }
});
it("Live2D ready never lights the hidden static fallback", async () => {
  const ready = ref(new Set([1]));
  invokeMock.mockResolvedValue("G:/fallback.png");
  const wrapper = mount(GameRoleAvatar, {
    props: { role: role(true) },
    global: {
      stubs,
      provide: {
        [live2dStageContextKey as symbol]: {
          readyRoleIds: ready,
          unavailableRoleIds: ref(new Set()),
        },
      },
      mocks: { $t: (key: string) => key },
    },
  });
  await flushPromises();
  expect((wrapper.get("[data-image]").element as HTMLElement).style.display).toBe("none");
  expect(cssFilter(wrapper.get("[data-lighting-visual]").element)).toBe("none");
  expect(wrapper.find("[data-lighting-character-effects]").exists()).toBe(false);
});
it("lights only the static visual while preserving role transforms and unfiltered accessories", async () => {
  const wrapper = mount(GameRoleAvatar, {
    props: { role: role(), castScale: 0.9, castOffsetY: -10 },
    global: { stubs: { ...stubs, TouchAreas: { template: "<div data-touch />" } } },
  });
  await flushPromises();
  const frame = wrapper.get("[data-lighting-frame]");
  expect(cssFilter(frame.get("[data-lighting-visual]").element)).toBe("brightness(1.4)");
  const bubble = wrapper.get(".bubble");
  expect(bubble.element.closest("[data-lighting-visual]")).toBeNull();
  expect(wrapper.get("[data-touch]").element.closest("[data-lighting-visual]")).toBeNull();
  expect(cssFilter(bubble.element.parentElement!)).toBe("");
  expect((frame.element as HTMLElement).style.transform).toBe(
    "translateX(-50%) scale(0.7200000000000001)"
  );
  expect((frame.element as HTMLElement).style.left).toBe("calc(50% + 15px)");
  expect((frame.element as HTMLElement).style.top).toBe("10px");
  expect(frame.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
});
it("background PNG slots stay image → behind → directional → front even with z-index 7", async () => {
  stores.game.activeLighting.asset_layers = [
    asset("b", "background", "behind"),
    asset("c", "background", "front"),
  ];
  invokeMock.mockImplementation(async (_command: string, args?: any) => ({
    hash: args.hash,
    supported: true,
    asset_protocol_path: `G:/${args.hash}.png`,
  }));
  const wrapper = mount(GameBackground, { global: { stubs } });
  await flushPromises();
  const root = wrapper.get("[data-lighting-background]");
  const behind = root.get('[data-lighting-assets="behind"]');
  const front = root.get('[data-lighting-assets="front"]');
  expect(Number((behind.element.parentElement as HTMLElement).style.zIndex)).toBe(1);
  expect(Number((front.element.parentElement as HTMLElement).style.zIndex)).toBe(3);
  expect(root.get('[data-lighting-effect="main"]').element.parentElement!.style.zIndex).toBe("2");
  expect((front.get("img").element as HTMLElement).style.zIndex).toBe("7");
  stores.settings.display.simplifiedLighting = true;
  await nextTick();
  expect(root.findAll("img")).toHaveLength(0);
  expect(root.find('[data-lighting-effect="bloom"]').exists()).toBe(false);
  expect(root.find('[data-lighting-effect="ambient"]').exists()).toBe(true);
  expect(root.find('[data-lighting-effect="main"]').exists()).toBe(true);
  expect(cssFilter(root.get("[data-lighting-background-visual]").element)).toBe("brightness(0.8)");
});
it("background uses active lighting inside a bounded slot below the stage", async () => {
  const wrapper = mount(GameBackground, { global: { stubs } });
  const root = wrapper.get("[data-lighting-background]");
  expect((root.element as HTMLElement).style.isolation).toBe("isolate");
  expect((root.element as HTMLElement).style.zIndex).toBe("0");
  const image = root.get("[data-lighting-background-visual]");
  expect(cssFilter(image.element)).toBe("brightness(0.8)");
  expect(root.findAll('[data-lighting-effect="main"]')).toHaveLength(1);
  expect(root.findAll('[data-lighting-effect="ambient"]')).toHaveLength(1);
  expect(root.findAll('[data-lighting-effect="bloom"]')).toHaveLength(1);
  stores.game.activeLighting.main_light.target = "both";
  await nextTick();
  expect(root.find('[data-lighting-effect="main"]').exists()).toBe(false);
});
