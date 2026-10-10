import { useSceneEditorText } from "./useSceneEditorText";
import { computed, ref, watch, onScopeDispose } from "vue";
import type { LightingParams, LightingPreset } from "@/types/scene-lighting";
import type { BackgroundImageInfo } from "@/types";
import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
import { getSceneLightingMetadataForSave, type SceneLightingMetadata } from "@/api/services/scene";
import { useUIStore } from "@/stores/modules/ui/ui";
export interface SceneEditorData extends SceneLightingMetadata {
  sceneName: string;
  sceneImage: string | null;
  sceneDescription: string;
  lighting?: LightingParams | null;
}
export type SceneEditorProps = {
  show: boolean;
  mode: "create" | "update";
  backgrounds: BackgroundImageInfo[];
  initialData?: SceneEditorData;
  sceneKey?: string | null;
  saveScene?: (
    data: SceneEditorData,
    context: { sceneKey?: string | null; mode: "create" | "update" }
  ) => Promise<void>;
};
export function useSceneLightingDraft(
  props: SceneEditorProps,
  events: { close: () => void; submit: (data: SceneEditorData) => void },
  onLoad: () => void
) {
  const { text } = useSceneEditorText();
  const ui = useUIStore();
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const empty = (): SceneEditorData => ({
    sceneName: "",
    sceneImage: null,
    sceneDescription: "",
    lighting: null,
    lighting_preset_id: null,
    lighting_preset_revision: null,
    lighting_customized: false,
  });
  const visible = ref(false);
  const draft = ref<SceneEditorData>(empty());
  const baseline = ref<SceneEditorData>(empty());
  const provenance = ref<SceneEditorData>(empty());
  const presets = ref<LightingPreset[]>([]);
  const sourcePreset = computed(() =>
    presets.value.find((p) => p.id === draft.value.lighting_preset_id)
  );
  const pendingAction = ref<(() => void) | null>(null);
  const saving = ref(false);
  const saveError = ref("");
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    pendingAction.value = null;
  });
  const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(baseline.value));
  function request(action: () => void, queueWhileSaving = false) {
    if (saving.value) {
      // 父级场景切换不能丢失；保留最新目标，但不改动正在保存的快照。
      if (queueWhileSaving) pendingAction.value = action;
      return;
    }
    if (pendingAction.value) return;
    if (dirty.value) pendingAction.value = action;
    else action();
  }
  function close() {
    visible.value = false;
    events.close();
  }
  function requestClose() {
    request(close);
  }
  function discard() {
    if (saving.value) return;
    const action = pendingAction.value;
    pendingAction.value = null;
    draft.value = clone(baseline.value);
    action?.();
  }
  const lighting = computed(() => draft.value.lighting ?? createNeutralLighting());
  const acceptedContext = ref({ sceneKey: props.sceneKey, mode: props.mode });
  function load(data: SceneEditorData, context: typeof acceptedContext.value) {
    draft.value = clone(data);
    baseline.value = clone(data);
    provenance.value = clone(data);
    acceptedContext.value = context;
    onLoad();
  }
  watch(
    () => props.show,
    (show) => {
      if (show && !visible.value) {
        visible.value = true;
        load(props.initialData ?? empty(), { sceneKey: props.sceneKey, mode: props.mode });
      } else if (!show && visible.value) request(close, true);
    },
    { immediate: true }
  );
  watch(
    () => [props.initialData, props.sceneKey, props.mode],
    () => {
      if (!props.show) return;
      const data = clone(props.initialData ?? empty());
      const context = { sceneKey: props.sceneKey, mode: props.mode };
      request(() => load(data, context), true);
    }
  );
  function updateLighting(value: LightingParams) {
    if (saving.value || pendingAction.value) return;
    draft.value.lighting = clone(value);
    Object.assign(draft.value, getSceneLightingMetadataForSave(provenance.value, value));
  }
  function applyPreset(preset: LightingPreset) {
    draft.value = {
      ...draft.value,
      lighting: clone(preset.lighting),
      lighting_preset_id: preset.id,
      lighting_preset_revision: preset.revision,
      lighting_customized: false,
    };
    provenance.value = clone(draft.value);
  }
  function restoreNeutral() {
    draft.value = {
      ...draft.value,
      lighting: createNeutralLighting(),
      lighting_preset_id: null,
      lighting_preset_revision: null,
      lighting_customized: false,
    };
    provenance.value = clone(draft.value);
  }
  function choosePreset(preset: LightingPreset) {
    const copy = clone(preset);
    request(() => applyPreset(copy));
  }
  async function handleSubmit() {
    if (saving.value || !draft.value.sceneName.trim()) return;
    const value = clone(draft.value);
    const metadata = getSceneLightingMetadataForSave(provenance.value, value.lighting ?? null);
    const payload = {
      ...value,
      ...metadata,
      sceneName: value.sceneName.trim(),
      sceneDescription: value.sceneDescription.trim(),
      sceneImage: value.sceneImage || null,
    };
    saving.value = true;
    saveError.value = "";
    try {
      if (props.saveScene) await props.saveScene(clone(payload), { ...acceptedContext.value });
      else if (pendingAction.value) throw new Error("保存需要异步确认");
      if (disposed) return;
      events.submit(payload);
      if (props.saveScene) ui.showSuccess({ title: text("saved", "场景已保存"), duration: 2000 });
      draft.value = clone(payload);
      baseline.value = clone(payload);
      const action = pendingAction.value;
      pendingAction.value = null;
      if (action) action();
      else if (props.saveScene) close();
    } catch (error) {
      if (disposed) return;
      saveError.value = String(error instanceof Error ? error.message : error);
      ui.showError({
        title: text("saveFailed", "保存失败"),
        message: saveError.value,
        duration: 3000,
      });
    } finally {
      saving.value = false;
    }
  }

  return {
    visible,
    draft,
    presets,
    sourcePreset,
    pendingAction,
    saving,
    saveError,
    lighting,
    requestClose,
    discard,
    updateLighting,
    applyPreset,
    restoreNeutral,
    choosePreset,
    handleSubmit,
  };
}
