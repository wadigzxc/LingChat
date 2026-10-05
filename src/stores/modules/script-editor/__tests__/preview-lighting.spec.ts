import { describe, expect, it, vi } from "vitest";

import {
  capturePreviewRuntimeLighting,
  restorePreviewRuntimeLighting,
  stopPreviewInOrder,
} from "@/stores/modules/script-editor/actions";
import { lighting } from "@/test/scene-lighting-fixtures";
import type { SceneLightingSource } from "@/types/scene-lighting";
import { applySceneStatePayload, type SceneStateMirror } from "@/utils/scene-lighting/scene-state";

describe("script preview runtime lighting backup", () => {
  it("invalidates the preview generation before stop and drains late events after stop", async () => {
    const session = { previewing: true, previewGeneration: 7 as number | null };
    let finishStop!: () => void;
    const stopBackend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        })
    );
    const clearLateEvents = vi.fn();

    const stopping = stopPreviewInOrder(
      () => {
        session.previewing = false;
        session.previewGeneration = null;
      },
      stopBackend,
      clearLateEvents
    );

    expect(session).toEqual({ previewing: false, previewGeneration: null });
    expect(stopBackend).toHaveBeenCalledOnce();
    expect(clearLateEvents).not.toHaveBeenCalled();

    finishStop();
    await stopping;

    expect(clearLateEvents).toHaveBeenCalledOnce();
  });

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
      activeLightingSource: "manual" as const,
      activeLightingPresetId: "user:night",
      activeLightingPresetRevision: 8,
      activeLightingCustomized: true,
      lightingRevision: 42,
    };
    const snapshot = capturePreviewRuntimeLighting(runtime);
    runtime.activeLighting = lighting(0.25);
    runtime.activeLightingSource = "manual";
    runtime.activeLightingPresetId = null;
    runtime.activeLightingPresetRevision = null;
    runtime.activeLightingCustomized = false;

    restorePreviewRuntimeLighting(runtime, snapshot);

    expect(runtime).toEqual({
      activeLighting: lighting(1.25),
      activeLightingSource: "manual",
      activeLightingPresetId: "user:night",
      activeLightingPresetRevision: 8,
      activeLightingCustomized: true,
      lightingRevision: 42,
    });
    expect(runtime.activeLighting).not.toBe(snapshot.activeLighting);
  });

  it("keeps a newer preview revision until the authoritative stop event wins", () => {
    const runtime: SceneStateMirror = {
      currentScene: null,
      currentBackground: "before.png",
      activeLighting: lighting(1.25),
      activeLightingSource: "manual",
      activeLightingPresetId: "user:before",
      activeLightingPresetRevision: 8,
      activeLightingCustomized: true,
      lightingRevision: 42,
    };
    const snapshot = capturePreviewRuntimeLighting(runtime);
    runtime.activeLighting = lighting(0.25);
    runtime.activeLightingSource = "manual";
    runtime.activeLightingPresetId = null;
    runtime.activeLightingPresetRevision = null;
    runtime.activeLightingCustomized = false;
    runtime.lightingRevision = 43;

    // stopPreview first hides the preview, then waits for Rust to restore and emit revision 44.
    restorePreviewRuntimeLighting(runtime, snapshot);

    expect(runtime.lightingRevision).toBe(43);
    expect(runtime.activeLighting.master_intensity).toBe(0.25);

    const restored = applySceneStatePayload(runtime, {
      scene: null,
      background: "before.png",
      active_lighting: lighting(1.25),
      source: "manual",
      preset_id: "user:before",
      preset_revision: 8,
      customized: true,
      lighting_revision: 44,
    });
    const afterLatePreviewEvent = applySceneStatePayload(restored, {
      scene: null,
      background: "preview.png",
      active_lighting: lighting(0.5),
      source: "manual",
      preset_id: null,
      preset_revision: null,
      customized: true,
      lighting_revision: 43,
    });

    expect(restored.lightingRevision).toBe(44);
    expect(restored.activeLighting.master_intensity).toBe(1.25);
    expect(afterLatePreviewEvent).toBe(restored);
  });
});
