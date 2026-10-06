import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeMock } from "./fixtures";
import { preset, inspection, globalOptions, ui, picker } from "./fixtures";
import LightingImportDialog from "../LightingImportDialog.vue";
vi.mock("@/stores/modules/ui/ui", () => ({ useUIStore: () => ui }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => picker.open(...args),
  save: (...args: unknown[]) => picker.save(...args),
}));
beforeEach(() => {
  picker.open.mockReset();
  picker.open.mockResolvedValue("C:/incoming/moon.linglight");
  invokeMock.mockImplementation(async (cmd) =>
    cmd === "inspect_linglight" ? inspection() : { preset: preset(), warnings: [] }
  );
});
describe("LightingImportDialog DOM", () => {
  it("inspects a desktop file and shows manifest assets warnings conflicts without committing", async () => {
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    expect(picker.open).toHaveBeenCalledWith({
      multiple: false,
      directory: false,
      filters: [{ name: "LingLight", extensions: ["linglight"] }],
    });
    expect(invokeMock.mock.calls).toEqual([
      ["inspect_linglight", { path: "C:/incoming/moon.linglight" }],
    ]);
    expect(w.text()).toContain("Imported moon");
    expect(w.text()).toContain("cinematic");
    expect(w.text()).toContain("cool");
    expect(w.text()).toContain("flare");
    expect(w.text()).toContain("128");
    expect(w.text()).toContain("16");
    expect(w.text()).toContain("backend warning");
    expect(w.text()).toContain("Moon");
    expect(w.text()).toContain("same_origin");
    expect(w.find("[data-confirm-import]").exists()).toBe(true);
  });
  it("commits only after explicit confirmation with the chosen strategy and parameter-only flag", async () => {
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    await w.get("[data-strategy]").setValue("overwrite_same_origin");
    await w.get("[data-parameter-only]").setValue(true);
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(["inspect_linglight"]);
    await w.get("[data-confirm-import]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("commit_linglight_import", {
      token: "token",
      strategy: "overwrite_same_origin",
      parameterOnly: true,
    });
    expect(w.find("[data-confirm-import]").exists()).toBe(false);
    expect(w.emitted("imported")?.[0]).toEqual([preset()]);
    expect(ui.showSuccess).toHaveBeenCalledWith(expect.objectContaining({ duration: 2000 }));
  });
  it("disables overwrite when origin is absent or same-origin candidates are zero or multiple", async () => {
    for (const info of [
      inspection({ preset: { ...inspection().preset, origin_id: "" } }),
      inspection({ conflicts: [] }),
      inspection({
        conflicts: [{ kind: "name", existing_id: "different", existing_name: "Moon" }],
      }),
      inspection({
        conflicts: [
          ...inspection().conflicts,
          { kind: "same_origin", existing_id: "two", existing_name: "Second" },
        ],
      }),
    ]) {
      invokeMock.mockResolvedValue(info);
      const w = mount(LightingImportDialog, { global: globalOptions() });
      await w.get("[data-pick]").trigger("click");
      await flushPromises();
      expect(w.get('option[value="overwrite_same_origin"]').attributes("disabled")).toBeDefined();
      await w.get("[data-strategy]").setValue("overwrite_same_origin");
      await w.get("[data-confirm-import]").trigger("click");
      await flushPromises();
      expect(invokeMock.mock.calls.some((c) => c[0] === "commit_linglight_import")).toBe(false);
      w.unmount();
    }
  });
  it("cancels the staged token without committing and resets the inspection", async () => {
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    await w.get("[data-cancel-import]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("cancel_linglight_import", { token: "token" });
    expect(invokeMock.mock.calls.some((c) => c[0] === "commit_linglight_import")).toBe(false);
    expect(w.find("[data-confirm-import]").exists()).toBe(false);
  });
  it("recovers from inspect rejection including required unknown assets without offering commit", async () => {
    invokeMock.mockRejectedValueOnce(new Error("required unknown media rejected"));
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "required unknown media rejected", duration: 3000 })
    );
    expect(w.find("[data-confirm-import]").exists()).toBe(false);
    expect(w.get("[data-pick]").attributes("disabled")).toBeUndefined();
    invokeMock.mockResolvedValue(inspection());
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    expect(w.find("[data-confirm-import]").exists()).toBe(true);
  });
  it("prevents duplicate commits and requires a fresh inspection after a consumed-token error", async () => {
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    let reject!: (reason: Error) => void;
    invokeMock.mockImplementation((cmd) =>
      cmd === "commit_linglight_import"
        ? new Promise((_, r) => {
            reject = r;
          })
        : Promise.resolve(inspection())
    );
    await w.get("[data-confirm-import]").trigger("click");
    await w.get("[data-confirm-import]").trigger("click");
    expect(invokeMock.mock.calls.filter((c) => c[0] === "commit_linglight_import")).toHaveLength(1);
    reject(new Error("token expired or conflict changed"));
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "token expired or conflict changed" })
    );
    expect(w.find("[data-confirm-import]").exists()).toBe(false);
    expect(w.get("[data-pick]").attributes("disabled")).toBeUndefined();
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    expect(w.find("[data-confirm-import]").exists()).toBe(true);
  });
  it("uses backend optional-unknown warnings and permits explicit parameter-only import", async () => {
    invokeMock.mockImplementation(async (cmd) =>
      cmd === "inspect_linglight"
        ? inspection({ warnings: ["optional future media: choose parameter-only"] })
        : { preset: preset(), warnings: ["removed unsupported layer"] }
    );
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("optional future media: choose parameter-only");
    await w.get("[data-parameter-only]").setValue(true);
    await w.get("[data-confirm-import]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("commit_linglight_import", {
      token: "token",
      strategy: "keep_both",
      parameterOnly: true,
    });
    expect(ui.showWarning).toHaveBeenCalledWith(
      expect.objectContaining({ message: "removed unsupported layer", duration: 3000 })
    );
  });
  it("does not send IPC or toast when the native file picker is cancelled", async () => {
    picker.open.mockResolvedValue(null);
    ui.showError.mockClear();
    ui.showSuccess.mockClear();
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(ui.showError).not.toHaveBeenCalled();
    expect(ui.showSuccess).not.toHaveBeenCalled();
    expect(w.find("[data-confirm-import]").exists()).toBe(false);
  });
  it("guards repeated picker actions and releases a token returned after unmount", async () => {
    let resolve!: (value: ReturnType<typeof inspection>) => void;
    invokeMock.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await w.get("[data-pick]").trigger("click");
    expect(picker.open).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    w.unmount();
    invokeMock.mockResolvedValue(undefined);
    resolve(inspection());
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("cancel_linglight_import", { token: "token" });
  });
  it("hides the archive picker on Android and iOS", async () => {
    for (const agent of ["Android", "iPhone"]) {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
      const w = mount(LightingImportDialog, { global: globalOptions() });
      expect(w.find("[data-pick]").exists()).toBe(false);
      w.unmount();
    }
    expect(picker.open).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
  it("recovers from failed cancel and prevents double cancellation", async () => {
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    let reject!: (reason: Error) => void;
    invokeMock.mockImplementation(
      () =>
        new Promise((_, r) => {
          reject = r;
        })
    );
    await w.get("[data-cancel-import]").trigger("click");
    await w.get("[data-cancel-import]").trigger("click");
    expect(invokeMock.mock.calls.filter((c) => c[0] === "cancel_linglight_import")).toHaveLength(1);
    reject(new Error("cancel failed"));
    await flushPromises();
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "cancel failed" })
    );
    expect(w.find("[data-confirm-import]").exists()).toBe(true);
    invokeMock.mockResolvedValue(undefined);
    await w.get("[data-cancel-import]").trigger("click");
    await flushPromises();
    expect(w.find("[data-confirm-import]").exists()).toBe(false);
  });
  it("does not inspect a picker result delivered after the component closes", async () => {
    let resolve!: (value: string) => void;
    picker.open.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    w.unmount();
    resolve("C:/late.linglight");
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalled();
  });
  it("uses backend rejection for optional unknown assets unless parameter-only is chosen", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "inspect_linglight")
        return inspection({ warnings: ["unsupported optional asset"] });
      throw new Error("must choose parameter-only");
    });
    const w = mount(LightingImportDialog, { global: globalOptions() });
    await w.get("[data-pick]").trigger("click");
    await flushPromises();
    await w.get("[data-confirm-import]").trigger("click");
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("commit_linglight_import", {
      token: "token",
      strategy: "keep_both",
      parameterOnly: false,
    });
    expect(ui.showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "must choose parameter-only" })
    );
    expect(w.emitted("imported")).toBeUndefined();
  });
});
