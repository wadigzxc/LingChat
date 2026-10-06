import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { globalOptions, preset, ui, invokeMock } from "./fixtures";
import SettingsBackground from "../../pages/SettingsBackground.vue";
const game = reactive({
  activeLighting: preset().lighting,
  activeLightingPresetId: "user:one",
  currentScene: { id: "scene", scene_name: "Scene", lighting: preset().lighting },
});
vi.mock("@/stores/modules/game", () => ({ useGameStore: () => game }));
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));
vi.mock("@/stores/modules/ui/dialog", () => ({ useDialogStore: () => ({}) }));
vi.mock("@/stores/modules/user/user", () => ({ useUserStore: () => ({}) }));
vi.mock("@/stores/modules/settings", () => ({
  useSettingsStore: () => ({ meteorFps: 30, starsFps: 30 }),
}));
vi.mock("@/api/services/background", () => ({
  getBackgroundImages: async () => [],
  uploadBackgroundImage: vi.fn(),
  generateBackgroundImage: vi.fn(),
  openBackgroundsFolder: vi.fn(),
}));
vi.mock("@/api/services/cpu-perf", () => ({
  getCpuInfo: async () => ({ brand: "CPU", tier: "High" }),
  redetectCpu: vi.fn(),
  getTierLabel: () => "High",
  getSuggestedMaxFps: () => 60,
  getPerfTierColor: () => "#ffffff",
  getCombinedTier: () => "High",
}));
vi.mock("@/api/services/gpu-perf", () => ({
  getGpuInfo: async () => null,
  getActiveGpu: async () => null,
  redetectGpu: vi.fn(),
}));
function options() {
  return {
    ...globalOptions(),
    stubs: {
      MenuPage: { template: "<main><slot /></main>" },
      MenuItem: { template: "<section><slot /></section>" },
      Button: { template: "<button><slot /></button>" },
      Toggle: { template: "<div><slot /></div>" },
      Slider: true,
      SceneEditModal: true,
      DialogAppearancePanel: true,
      PluginTag: true,
      MessageSquare: true,
    },
    mocks: { $t: (key: string) => key },
  };
}
describe("SettingsBackground Task14 minimal entry", () => {
  it("opens the manager with active lighting rather than the current scene default", async () => {
    game.activeLighting.master_intensity = 1.8;
    game.currentScene.lighting.master_intensity = 0.2;
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "list_scenes" ? [] : cmd === "list_lighting_presets" ? [preset()] : preset()
    );
    const w = mount(SettingsBackground, { global: options(), attachTo: document.body });
    await flushPromises();
    expect(w.find('[data-preset="user:one"]').exists()).toBe(true);
    await w.get("[data-manage-lighting]").trigger("click");
    await flushPromises();
    await w.get("[data-create]").trigger("click");
    await w.get("[data-name]").setValue("Active snapshot");
    await w.get("[data-save]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("create_lighting_preset", {
      draft: expect.objectContaining({
        lighting: expect.objectContaining({ master_intensity: 1.8 }),
      }),
    });
    expect(
      invokeMock.mock.calls.some((c) =>
        ["update_scene", "save_active_lighting_as_scene_default"].includes(c[0])
      )
    ).toBe(false);
  });
  it("refreshes the selector after CRUD without saving any scene", async () => {
    let items = [preset()];
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "list_scenes") return [];
      if (cmd === "list_lighting_presets") return items;
      if (cmd === "update_lighting_preset") {
        items = [preset({ name: "Updated name" })];
        return items[0];
      }
      return preset();
    });
    const w = mount(SettingsBackground, { global: options(), attachTo: document.body });
    await flushPromises();
    await w.get("[data-manage-lighting]").trigger("click");
    await flushPromises();
    await w.get('[data-edit="user:one"]').trigger("click");
    await w.get("[data-name]").setValue("Updated name");
    await w.get("[data-save]").trigger("click");
    await flushPromises();
    expect(w.get('[data-preset="user:one"]').text()).toContain("Updated name");
  });
});
