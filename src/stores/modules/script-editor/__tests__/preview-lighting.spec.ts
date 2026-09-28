import { describe, expect, it } from "vitest";

import {
  capturePreviewRuntimeLighting,
  restorePreviewRuntimeLighting,
} from "@/stores/modules/script-editor/actions";
import { lighting } from "@/test/scene-lighting-fixtures";
import type { SceneLightingSource } from "@/types/scene-lighting";

describe("script preview runtime lighting backup", () => {
  it("captures and restores all temporary runtime lighting metadata", () => {
    const runtime: {
      activeLighting: ReturnType<typeof lighting>;
      activeLightingSource: SceneLightingSource;
      activeLightingPresetId: string | null;
      activeLightingPresetRevision: number | null;
      activeLightingCustomized: boolean;
      lightingRevision: number;
    } = {
      activeLighting: lighting(1.25),
      activeLightingSource: "manual_preset" as const,
      activeLightingPresetId: "user:night",
      activeLightingPresetRevision: 8,
      activeLightingCustomized: true,
      lightingRevision: 42,
    };
    const snapshot = capturePreviewRuntimeLighting(runtime);
    runtime.activeLighting = lighting(0.25);
    runtime.activeLightingSource = "manual_custom";
    runtime.activeLightingPresetId = null;
    runtime.activeLightingPresetRevision = null;
    runtime.activeLightingCustomized = false;
    runtime.lightingRevision = 43;

    restorePreviewRuntimeLighting(runtime, snapshot);

    expect(runtime).toEqual({
      activeLighting: lighting(1.25),
      activeLightingSource: "manual_preset",
      activeLightingPresetId: "user:night",
      activeLightingPresetRevision: 8,
      activeLightingCustomized: true,
      lightingRevision: 42,
    });
    expect(runtime.activeLighting).not.toBe(snapshot.activeLighting);
  });
});
