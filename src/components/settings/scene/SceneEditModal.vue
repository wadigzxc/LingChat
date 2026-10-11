<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-9998 flex items-center justify-center bg-black/40 p-4
          backdrop-blur-md"
        @click="requestClose"
      >
        <div
          class="scene-editor relative flex max-h-[92dvh] w-full max-w-7xl overflow-hidden
            rounded-3xl border border-white/20 bg-slate-900/40 shadow-2xl backdrop-blur-2xl"
          data-editor-dialog
          role="dialog"
          aria-modal="true"
          :aria-label="text('editorTitle', '编辑场景及光影')"
          @keydown.esc.prevent.stop="requestClose"
          @click.stop
        >
          <!-- ====== 左栏：表单 ====== -->
          <div class="editor-properties flex w-[420px] shrink-0 flex-col border-r border-white/10">
            <!-- Header -->
            <div
              class="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/10
                p-4"
            >
              <h3 class="text-lg leading-none font-bold text-white">
                {{ text("editorTitle", "编辑场景及光影") }}
              </h3>
              <button
                :aria-label="text('close', '关闭')"
                @click="requestClose"
                class="flex items-center justify-center rounded-full p-2 text-white/50
                  transition-colors hover:bg-red-500/20 hover:text-white"
              >
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <!-- Scrollable body -->
            <div class="editor-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <fieldset data-editor-fields :disabled="saving || !!pendingAction" class="space-y-4">
                <RelightingPanel :model-value="lighting" @update:model-value="updateLighting" />
                <details open>
                  <summary>场景信息</summary>
                  <!-- 场景名称 -->
                  <section>
                    <label
                      class="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-widest
                        text-gray-200/90 uppercase opacity-80"
                    >
                      <span class="h-3 w-1 rounded-full bg-orange-500"></span>
                      {{ $t("settings.sceneEdit.label.sceneName") }}
                    </label>
                    <input
                      v-model="draft.sceneName"
                      :aria-label="text('sceneName', '场景名称')"
                      :placeholder="$t('settings.sceneEdit.placeholder.sceneName')"
                      class="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm
                        text-white placeholder-white/30 transition-all focus:border-indigo-400
                        focus:ring-1 focus:ring-indigo-400/50 focus:outline-none"
                    />
                  </section>

                  <!-- 场景图片 -->
                  <section>
                    <label
                      class="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-widest
                        text-gray-200/90 uppercase opacity-80"
                    >
                      <span class="h-3 w-1 rounded-full bg-indigo-500"></span>
                      {{ $t("settings.sceneEdit.label.sceneImage") }}
                    </label>
                    <div class="flex gap-2">
                      <select
                        v-model="draft.sceneImage"
                        :aria-label="text('sceneImage', '场景图片')"
                        class="flex-1 appearance-none rounded-xl border border-white/10 bg-black/40
                          px-3 py-2 text-sm text-white transition-all focus:border-indigo-400
                          focus:ring-1 focus:ring-indigo-400/50 focus:outline-none"
                      >
                        <option value="" class="bg-slate-800 text-white/50">
                          {{ $t("settings.sceneEdit.option.selectBackground") }}
                        </option>
                        <option
                          v-for="bg in backgrounds"
                          :key="bg.url"
                          :value="bg.url"
                          class="bg-slate-800 text-white"
                        >
                          {{ bg.title }}
                        </option>
                      </select>
                      <Button
                        @click="$emit('upload')"
                        class="rounded-xl border border-white/20 bg-white/10! px-4 text-sm!
                          whitespace-nowrap text-white! hover:bg-white/20!"
                      >
                        {{ $t("settings.sceneEdit.button.upload") }}
                      </Button>
                    </div>
                  </section>

                  <!-- 场景描述 -->
                  <section>
                    <label
                      class="mb-1.5 flex items-center gap-2 text-xs font-bold tracking-widest
                        text-gray-200/90 uppercase opacity-80"
                    >
                      <span class="h-3 w-1 rounded-full bg-emerald-500"></span>
                      {{ $t("settings.sceneEdit.label.sceneDescription") }}
                    </label>
                    <textarea
                      v-model="draft.sceneDescription"
                      :aria-label="text('sceneDescription', '场景描述')"
                      :placeholder="$t('settings.sceneEdit.placeholder.sceneDescription')"
                      rows="2"
                      class="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3
                        py-2 text-sm text-white placeholder-white/30 transition-all
                        focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/50
                        focus:outline-none"
                    ></textarea>
                  </section>
                </details>
                <details data-legacy-lighting>
                  <summary>光影与预设</summary>
                  <LightingPresetSelect
                    draft-only
                    :active-preset-id="draft.lighting_preset_id"
                    @select="choosePreset"
                    @loaded="presets = $event"
                  />
                  <p data-provenance class="text-sm text-white">
                    {{
                      draft.lighting_preset_id
                        ? `${text("basedOn", "基于")} ${sourcePreset ? presetName(sourcePreset) : draft.lighting_preset_id}${draft.lighting_customized ? `，${text("customized", "已自定义")}` : ""}${!sourcePreset ? `，${text("sourceDeleted", "来源已删除")}` : ""}`
                        : draft.lighting_customized
                          ? text("custom", "自定义")
                          : text("systemNeutral", "系统中性")
                    }}
                  </p>
                  <button
                    data-restore-preset
                    :disabled="!sourcePreset"
                    @click="sourcePreset && applyPreset(sourcePreset)"
                  >
                    {{ text("restorePreset", "恢复当前预设值") }}
                  </button>

                  <OverallPanel :model-value="lighting" @update:model-value="updateLighting" />
                  <CharacterPanel :model-value="lighting" @update:model-value="updateLighting" />
                  <ScenePanel :model-value="lighting" @update:model-value="updateLighting" />
                  <AssetLayersPanel :model-value="lighting" @update:model-value="updateLighting" />
                </details>
              </fieldset>
            </div>
            <p
              v-if="saveError"
              data-editor-save-error
              role="alert"
              class="px-4 text-sm text-red-300"
            >
              {{ saveError }}
            </p>
            <!-- Footer -->
            <div
              data-editor-footer
              class="flex shrink-0 flex-col gap-3 border-t border-white/10 bg-white/5 p-3"
            >
              <div
                v-if="pendingAction"
                role="alertdialog"
                :aria-label="text('unsavedDraft', '未保存的草稿')"
                class="rounded-xl border border-amber-300/30 bg-slate-800 p-3 text-white"
              >
                <p class="font-medium">{{ text("unsavedDraft", "未保存的草稿") }}</p>
                <p v-if="saveError" role="status">{{ saveError }}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    data-draft-save
                    :disabled="saving || !draft.sceneName.trim()"
                    @click="handleSubmit"
                    class="rounded-lg bg-indigo-500 px-3 py-2 disabled:opacity-50"
                  >
                    {{ text("save", "保存") }}
                  </button>
                  <button
                    :disabled="saving"
                    data-draft-discard
                    @click="discard"
                    class="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-50"
                  >
                    {{ text("discard", "放弃") }}
                  </button>
                  <button
                    :disabled="saving"
                    data-draft-cancel
                    @click="pendingAction = null"
                    class="rounded-lg border border-white/20 px-3 py-2 disabled:opacity-50"
                  >
                    {{ text("cancel", "取消") }}
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <button
                  data-reset-relighting
                  type="button"
                  :disabled="saving || !!pendingAction || !lighting.relighting"
                  @click="resetRelighting"
                  class="rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80
                    disabled:opacity-50"
                >
                  重置单灯受光
                </button>
                <button
                  data-restore-neutral
                  type="button"
                  :disabled="saving || !!pendingAction"
                  @click="restoreNeutral"
                  class="rounded-lg border border-white/20 px-3 py-2 text-sm text-white/80
                    hover:bg-white/10 disabled:opacity-50"
                >
                  {{ text("restoreNeutral", "恢复系统中性值") }}
                </button>
                <div class="flex items-center gap-2">
                  <Button
                    @click="requestClose"
                    :disabled="saving || !!pendingAction"
                    class="border border-white/20 bg-transparent! text-sm! text-white/70!
                      hover:bg-white/10! hover:text-white!"
                  >
                    {{ $t("settings.sceneEdit.button.cancel") }}
                  </Button>
                  <Button
                    @click="handleSubmit"
                    :disabled="saving || !!pendingAction || !draft.sceneName.trim()"
                    class="min-w-[70px] border-none bg-indigo-500! text-sm! text-white
                      shadow-[0_0_10px_rgba(99,102,241,0.5)] hover:bg-indigo-400!
                      disabled:opacity-50 disabled:shadow-none"
                  >
                    {{
                      mode === "create"
                        ? $t("settings.sceneEdit.button.create")
                        : $t("settings.sceneEdit.button.update")
                    }}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <SceneLightingPreview
            :disabled="saving || !!pendingAction"
            :lighting="lighting"
            :background-url="draft.sceneImage ? convertFileSrc(draft.sceneImage) : null"
            :avatar-url="previewAvatarUrl"
            :avatar-placement="previewRole"
            :live2d="!!previewRole?.live2d"
            @warning="
              ui.showWarning({
                title: $t('ui.lighting.previewWarningTitle'),
                message: $event,
                duration: 3000,
              })
            "
            @update:lighting="updateLighting"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
<script setup lang="ts">
  import { useSceneEditorText } from "./useSceneEditorText";
  import { computed, ref } from "vue";
  import {
    useSceneLightingDraft,
    type SceneEditorData,
    type SceneEditorProps,
  } from "./useSceneLightingDraft";
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import { Button } from "../../base";
  import { useGameStore } from "@/stores/modules/game";
  import { EMOTION_CONFIG_EMO } from "@/controllers/emotion/config";
  import LightingPresetSelect from "../lighting/LightingPresetSelect.vue";
  import { useUIStore } from "@/stores/modules/ui/ui";
  import SceneLightingPreview from "./SceneLightingPreview.vue";
  import AssetLayersPanel from "./lighting/AssetLayersPanel.vue";
  import ScenePanel from "./lighting/ScenePanel.vue";
  import CharacterPanel from "./lighting/CharacterPanel.vue";
  import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";
  import RelightingPanel from "./lighting/RelightingPanel.vue";
  import OverallPanel from "./lighting/OverallPanel.vue";
  const props = defineProps<SceneEditorProps>();
  const emit = defineEmits<{ close: []; submit: [data: SceneEditorData]; upload: [] }>();
  const { text, presetName } = useSceneEditorText();
  const ui = useUIStore();
  const gameStore = useGameStore();
  const previewAvatarUrl = ref("");
  const previewRole = computed(() =>
    gameStore.currentInteractRoleId
      ? gameStore.gameRoles[gameStore.currentInteractRoleId]
      : undefined
  );
  let avatarSequence = 0;
  async function resolveAvatar() {
    const sequence = ++avatarSequence;
    previewAvatarUrl.value = "";
    const roleId = gameStore.currentInteractRoleId;
    if (!roleId) return;
    const role = gameStore.gameRoles[roleId];
    if (!role) return;
    const emotion = EMOTION_CONFIG_EMO[role.emotion] || "正常";
    const request = {
      characterFolder: role.character_folder,
      clothesName: role.clothesName === "默认" || !role.clothesName ? "default" : role.clothesName,
    };
    try {
      let path: string;
      try {
        path = await invoke<string>("get_avatar_file", { ...request, emotion });
      } catch (error) {
        if (sequence !== avatarSequence) return;
        if (emotion === "正常") throw error;
        // 对话可能切到没有配图的表情；只回退同一角色、同一服装的正常立绘。
        path = await invoke<string>("get_avatar_file", { ...request, emotion: "正常" });
      }
      if (sequence === avatarSequence) previewAvatarUrl.value = convertFileSrc(path);
    } catch {
      if (sequence === avatarSequence) previewAvatarUrl.value = "";
    }
  }
  const {
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
  } = useSceneLightingDraft(
    props,
    { close: () => emit("close"), submit: (data) => emit("submit", data) },
    resolveAvatar
  );
  function resetRelighting() {
    updateLighting({ ...lighting.value, relighting: createRelightingParams() });
  }
</script>
<style scoped>
  .scene-editor {
    height: min(860px, 92dvh);
    background: var(--panel-bg, #172235);
    border-color: var(--border-color, #334155);
    backdrop-filter: none;
    border-radius: 1rem;
  }
  .editor-properties {
    width: 360px;
    min-height: 0;
    order: 2;
    border-left: 1px solid #ffffff15;
    border-right: 0;
  }
  .scene-editor :deep(section:has(> [data-preview-stage])) {
    order: 1;
    min-height: 0;
  }
  .scene-editor :deep([data-preview-stage]) {
    min-height: 0;
  }
  summary {
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-secondary, #cbd5e1);
    padding: 0.65rem 0;
  }
  summary:focus-visible {
    outline: 2px solid var(--accent-color, #818cf8);
  }
  [data-editor-footer] {
    font-size: 0.8rem;
  }
  @media (max-width: 760px) {
    .scene-editor {
      display: grid;
      grid-template-rows: minmax(160px, 35%) minmax(0, 1fr);
      height: 94dvh;
      max-height: 94dvh;
    }
    .editor-properties {
      width: 100%;
      border-left: 0;
      overflow: hidden;
    }
    .scene-editor :deep(section:has(> [data-preview-stage])) {
      padding: 0.5rem;
    }
  }
</style>
