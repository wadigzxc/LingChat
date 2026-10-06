import { createI18n } from "vue-i18n";
import { vi, type Mock } from "vitest";
import { tauriMocks } from "@/test/setup";
export const invokeMock = tauriMocks.invoke as unknown as Mock<
  (command: string, args?: Record<string, unknown>) => Promise<unknown>
>;
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import type { LightingPreset, ImportInspection } from "@/types/scene-lighting";
export const ui = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() };
export const picker = { open: vi.fn(), save: vi.fn() };
export function preset(overrides: Partial<LightingPreset> = {}): LightingPreset {
  return {
    id: "user:one",
    origin_id: "origin",
    revision: 1,
    kind: "user",
    name: "Moon",
    i18n_key: null,
    description: "Soft evening",
    aliases: ["Night"],
    tags: ["cool"],
    category: "cinematic",
    favorite: false,
    last_used_at: null,
    lighting: createNeutralLighting(),
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}
export function inspection(overrides: Partial<ImportInspection> = {}): ImportInspection {
  return {
    token: "token",
    preset: {
      name: "Imported moon",
      description: "Imported",
      tags: ["cool"],
      category: "cinematic",
      origin_id: "origin",
      revision: 2,
    },
    assets: [{ id: "flare", sha256: "a".repeat(64), byte_size: 128, width: 16, height: 16 }],
    warnings: ["backend warning"],
    conflicts: [{ kind: "same_origin", existing_id: "user:one", existing_name: "Moon" }],
    expires_at: "2099-01-01T00:00:00Z",
    ...overrides,
  };
}
export function globalOptions() {
  return { plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": {} } })] };
}
