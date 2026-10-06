<script setup lang="ts">
  import { ref, onMounted, watch } from "vue";
  import {
    listLightingPresets,
    createLightingPreset,
    updateLightingPreset,
    deleteLightingPreset,
    exportLightingPreset,
    exportLightingPresets,
  } from "@/api/services/scene-lighting";
  import type { LightingParams, LightingPreset, LightingPresetDraft } from "@/types/scene-lighting";
  import { createNeutralLighting } from "@/utils/scene-lighting/defaults";
  import { useLightingOperation } from "./useLightingOperation";
  import { useUIStore } from "@/stores/modules/ui/ui";
  import { isMobile } from "@/utils/platform";
  const desktop = !isMobile();
  import LightingImportDialog from "./LightingImportDialog.vue";
  const showImport = ref(false);
  const emit = defineEmits<{ changed: [] }>();
  async function imported() {
    await run(load);
    emit("changed");
  }
  const props = defineProps<{ activeLighting?: LightingParams | null }>();
  const ui = useUIStore();
  const { pending, run, text, presetName } = useLightingOperation();
  const presets = ref<LightingPreset[]>([]);
  const draft = ref<LightingPresetDraft | null>(null);
  import { normalizeLighting } from "@/utils/scene-lighting/normalize";
  const lightingJson = ref("");
  watch(
    () => draft.value?.lighting,
    (lighting) => {
      lightingJson.value = lighting ? JSON.stringify(lighting, null, 2) : "";
    },
    { deep: true }
  );
  async function applyJson() {
    await run(async () => {
      const parsed = JSON.parse(lightingJson.value);
      if (
        !parsed ||
        Array.isArray(parsed) ||
        parsed.schema_version !== 2 ||
        !parsed.character ||
        !parsed.background ||
        !Array.isArray(parsed.asset_layers)
      )
        throw new Error(text("invalidSnapshot", "需要完整的 V2 光影快照"));
      if (draft.value) draft.value.lighting = normalizeLighting(parsed);
    });
  }
  const editingId = ref<string | null>(null);
  function editPreset(preset: LightingPreset) {
    if (pending.value) return;
    editingId.value = preset.kind === "user" ? preset.id : null;
    draft.value = JSON.parse(
      JSON.stringify({
        name: presetName(preset),
        description: preset.description,
        aliases: preset.aliases,
        tags: preset.tags,
        category: preset.category,
        favorite: preset.favorite,
        last_used_at: preset.last_used_at,
        lighting: preset.lighting,
      })
    );
  }
  function listInput(event: Event): string[] {
    return (event.target as HTMLInputElement).value
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  async function load() {
    presets.value = await listLightingPresets("name");
  }
  function create() {
    if (pending.value) return;
    editingId.value = null;
    draft.value = {
      name: "",
      description: "",
      aliases: [],
      tags: [],
      category: "",
      favorite: false,
      last_used_at: null,
      lighting: JSON.parse(JSON.stringify(props.activeLighting ?? createNeutralLighting())),
    };
  }
  async function save(asNew = false) {
    await run(async () => {
      if (!draft.value) return;
      if (!draft.value.name.trim()) throw new Error(text("nameRequired", "预设名称不能为空"));
      const payload = JSON.parse(JSON.stringify(draft.value));
      if (editingId.value && !asNew) await updateLightingPreset(editingId.value, payload);
      else await createLightingPreset(payload);
      emit("changed");
      draft.value = null;
      await load();
      ui.showSuccess({ title: text("saved", "预设已保存"), duration: 2000 });
    });
  }
  async function favorite(preset: LightingPreset) {
    await run(async () => {
      if (preset.kind !== "user") return;
      await updateLightingPreset(preset.id, { favorite: !preset.favorite });
      emit("changed");
      await load();
      ui.showSuccess({ title: text("favoriteChanged", "收藏已更新"), duration: 2000 });
    });
  }
  import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  async function exportOne(preset: LightingPreset) {
    if (!desktop || preset.kind !== "user") return;
    await run(async () => {
      const path = await saveDialog({
        defaultPath: "preset.linglight",
        filters: [{ name: "LingLight", extensions: ["linglight"] }],
      });
      if (!path) return;
      await exportLightingPreset(preset.id, path);
      ui.showSuccess({ title: text("exported", "预设已导出"), duration: 2000 });
    });
  }
  const selected = ref<string[]>([]);
  async function exportBatch() {
    if (!desktop) return;
    await run(async () => {
      const ids = selected.value.filter((id) =>
        presets.value.some((p) => p.id === id && p.kind === "user")
      );
      if (!ids.length) return;
      const directory = await openDialog({ directory: true, multiple: false });
      if (typeof directory !== "string") return;
      const result = await exportLightingPresets(ids, directory);
      const failures = result.items.filter((item) => item.error);
      if (failures.length)
        ui.showWarning({
          title: text("exportPartial", "部分导出失败"),
          message: failures.map((item) => `${item.preset_id}: ${item.error}`).join("\n"),
          duration: 3000,
        });
      else ui.showSuccess({ title: text("exported", "预设已导出"), duration: 2000 });
    });
  }
  const deleting = ref<LightingPreset | null>(null);
  async function remove() {
    await run(async () => {
      if (!deleting.value || deleting.value.kind !== "user") return;
      await deleteLightingPreset(deleting.value.id);
      emit("changed");
      deleting.value = null;
      await load();
      ui.showSuccess({ title: text("deleted", "预设已删除"), duration: 2000 });
    });
  }
  onMounted(() => run(load));
</script>
<template>
  <section
    class="lighting-preset-manager space-y-3 rounded-xl border border-white/20 bg-black/30 p-4
      text-white"
    :aria-label="text('manager', '光影预设管理器')"
  >
    <button data-refresh-library :disabled="pending" @click="run(load)">
      {{ text("refresh", "刷新预设") }}
    </button>
    <button data-create :disabled="pending" @click="create">
      {{ text("createFromActive", "新建预设（当前活动光影）") }}
    </button>
    <button
      v-if="desktop"
      data-export-batch
      :disabled="pending || !selected.length"
      @click="exportBatch"
    >
      {{ text("exportSelected", "批量导出所选预设") }}
    </button>
    <button v-if="desktop" data-open-import :disabled="pending" @click="showImport = !showImport">
      {{ showImport ? text("closeImport", "关闭导入") : text("import", "导入 .linglight") }}
    </button>
    <LightingImportDialog v-if="showImport && desktop" @imported="imported" />
    <ul>
      <li v-for="preset in presets" :key="preset.id" :data-row="preset.id">
        <input
          v-if="desktop && preset.kind === 'user'"
          type="checkbox"
          :data-select="preset.id"
          :value="preset.id"
          v-model="selected"
          :aria-label="`选择 ${preset.name}`"
        />{{ presetName(preset) }}
        <button :data-edit="preset.id" :disabled="pending" @click="editPreset(preset)">
          {{ text("edit", "编辑") }}</button
        ><button
          v-if="preset.kind === 'user'"
          :data-delete="preset.id"
          :disabled="pending"
          @click="deleting = preset"
        >
          {{ text("delete", "删除") }}</button
        ><button
          v-if="preset.kind === 'user'"
          :data-favorite="preset.id"
          :disabled="pending"
          @click="favorite(preset)"
          :aria-pressed="preset.favorite"
        >
          {{ preset.favorite ? text("unfavorite", "取消收藏") : text("favorite", "收藏") }}</button
        ><button
          v-if="desktop && preset.kind === 'user'"
          :data-export="preset.id"
          :disabled="pending"
          @click="exportOne(preset)"
        >
          {{ text("export", "导出") }}
        </button>
      </li>
    </ul>
    <div v-if="deleting" role="alertdialog">
      {{ text("deletePrompt", "确认删除") }} {{ deleting.name }}？<button
        data-confirm-delete
        :disabled="pending"
        @click="remove"
      >
        {{ text("confirmDelete", "确认删除") }}</button
      ><button data-cancel-delete :disabled="pending" @click="deleting = null">
        {{ text("cancel", "取消") }}
      </button>
    </div>
    <form v-if="draft" @submit.prevent="save()" class="space-y-2">
      <fieldset :disabled="pending" class="space-y-2">
        <label
          >{{ text("name", "名称")
          }}<input data-name v-model="draft.name" class="rounded bg-white/10 p-2"
        /></label>
        <label
          >{{ text("description", "说明")
          }}<textarea data-description v-model="draft.description" />
        </label>
        <label
          >{{ text("tags", "标签")
          }}<input data-tags :value="draft.tags.join(', ')" @input="draft.tags = listInput($event)"
        /></label>
        <label
          >{{ text("aliases", "别名")
          }}<input
            data-aliases
            :value="draft.aliases.join(', ')"
            @input="draft.aliases = listInput($event)"
        /></label>
        <label
          >{{ text("category", "分类") }}<input data-category v-model="draft.category"
        /></label>
        <button
          data-use-active
          type="button"
          :disabled="pending || !activeLighting"
          @click="draft.lighting = JSON.parse(JSON.stringify(activeLighting))"
        >
          {{ text("useActive", "使用当前活动光影快照") }}
        </button>
        <label
          ><input data-lighting-enabled type="checkbox" v-model="draft.lighting.enabled" />{{
            text("enabled", "启用光影")
          }}</label
        >
        <label
          >{{ text("intensity", "总强度")
          }}<input
            data-intensity
            type="number"
            min="0"
            max="2"
            step="0.1"
            v-model.number="draft.lighting.master_intensity"
        /></label>
        <details>
          <summary>{{ text("snapshotJson", "高级：完整光影快照 JSON") }}</summary>
          <textarea
            data-lighting-json
            v-model="lightingJson"
            rows="10"
            class="w-full rounded bg-black/30 p-2 font-mono text-xs"
            :aria-label="text('snapshotJsonLabel', '光影参数 JSON')"
          /><button data-apply-json type="button" :disabled="pending" @click="applyJson">
            {{ text("applyToDraft", "应用到草稿") }}
          </button>
        </details>
        <button data-cancel-edit type="button" :disabled="pending" @click="draft = null">
          {{ text("cancel", "取消") }}
        </button>
        <button v-if="editingId" data-save-as type="button" :disabled="pending" @click="save(true)">
          {{ text("saveAsNew", "另存为新预设") }}
        </button>
        <button data-save type="submit" :disabled="pending">
          {{ editingId ? text("update", "更新") : text("saveAs", "另存为") }}
        </button>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
  button {
    border: 1px solid rgb(255 255 255 / 20%);
    border-radius: 0.5rem;
    padding: 0.35rem 0.65rem;
    margin: 0.2rem;
    background: rgb(255 255 255 / 8%);
  }
  button:hover:not(:disabled) {
    background: rgb(255 255 255 / 18%);
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  input:not([type="checkbox"]),
  textarea,
  select {
    color: white;
    background: #182437;
    border: 1px solid rgb(255 255 255 / 20%);
    border-radius: 0.4rem;
    padding: 0.4rem;
    max-width: 100%;
  }
  option {
    background: #182437;
    color: white;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-block: 0.4rem;
  }
  li {
    padding-block: 0.35rem;
    overflow-wrap: anywhere;
    border-bottom: 1px solid rgb(255 255 255 / 10%);
  }
  summary {
    cursor: pointer;
    padding-block: 0.4rem;
  }
</style>
