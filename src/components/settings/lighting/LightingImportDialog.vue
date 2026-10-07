<script setup lang="ts">
  import { ref, computed, onBeforeUnmount } from "vue";
  import { open } from "@tauri-apps/plugin-dialog";
  import {
    inspectLightingImport,
    commitLightingImport,
    cancelLightingImport,
  } from "@/api/services/scene-lighting";
  import type { ImportInspection, ImportStrategy, LightingPreset } from "@/types/scene-lighting";
  import { useLightingOperation } from "./useLightingOperation";
  import { useUIStore } from "@/stores/modules/ui/ui";
  import { isMobile } from "@/utils/platform";
  const desktop = !isMobile();
  const ui = useUIStore();
  const { pending, run, text } = useLightingOperation();
  const emit = defineEmits<{ imported: [preset: LightingPreset] }>();
  const inspection = ref<ImportInspection | null>(null);
  let disposed = false;
  onBeforeUnmount(() => {
    disposed = true;
    if (inspection.value && !pending.value) {
      void cancelLightingImport(inspection.value.token).catch((error) =>
        ui.showError({
          title: text("cancelFailed", "取消导入失败"),
          message: String(error),
          duration: 3000,
        })
      );
    }
  });
  const strategy = ref<ImportStrategy>("keep_both");
  const parameterOnly = ref(false);
  const canOverwrite = computed(
    () =>
      Boolean(inspection.value?.preset.origin_id) &&
      inspection.value?.conflicts.filter((c) => c.kind === "same_origin").length === 1
  );
  async function commit() {
    await run(async () => {
      if (!inspection.value || (strategy.value === "overwrite_same_origin" && !canOverwrite.value))
        return;
      try {
        const result = await commitLightingImport(
          inspection.value.token,
          strategy.value,
          parameterOnly.value
        );
        emit("imported", result.preset);
        if (result.warnings.length)
          ui.showWarning({
            title: text("importedWithWarnings", "预设已导入（有警告）"),
            message: result.warnings.join("\n"),
            duration: 3000,
          });
        else ui.showSuccess({ title: text("imported", "预设已导入"), duration: 2000 });
      } finally {
        inspection.value = null;
      }
    });
  }
  async function cancel() {
    await run(async () => {
      if (!inspection.value) return;
      await cancelLightingImport(inspection.value.token);
      inspection.value = null;
    });
  }
  async function pick() {
    if (!desktop || inspection.value) return;
    await run(async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "LingLight", extensions: ["linglight"] }],
      });
      if (disposed || typeof path !== "string") return;
      const result = await inspectLightingImport(path);
      if (disposed) {
        await cancelLightingImport(result.token);
        return;
      }
      inspection.value = result;
      strategy.value = "keep_both";
      parameterOnly.value = false;
    });
  }
</script>
<template>
  <section
    v-if="desktop"
    class="lighting-import-dialog space-y-3 rounded-xl border border-white/20 bg-black/30 p-4
      text-white"
    :aria-label="text('importTitle', '导入光影预设')"
  >
    <button data-pick :disabled="pending || !!inspection" @click="pick">
      {{ text("chooseFile", "选择 .linglight 文件") }}
    </button>
    <div v-if="inspection" role="dialog" :aria-label="text('confirmImport', '确认导入')">
      <h3>{{ inspection.preset.name }}</h3>
      <p>{{ inspection.preset.description }}</p>
      <p>
        {{ inspection.preset.category }} · {{ inspection.preset.tags.join(", ") }} ·
        {{ inspection.preset.origin_id }} · r{{ inspection.preset.revision }}
      </p>
      <ul>
        <li v-for="asset in inspection.assets" :key="asset.id">
          {{ asset.id }} · {{ asset.sha256 }} ·
          {{ text("assetBytes", `${asset.byte_size} bytes`, { count: asset.byte_size }) }} ·
          {{ asset.width }} ×
          {{ asset.height }}
        </li>
      </ul>
      <ul>
        <li v-for="warning in inspection.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <ul>
        <li v-for="(conflict, i) in inspection.conflicts" :key="i">
          {{ text(`conflicts.${conflict.kind}`, conflict.kind) }} · {{ conflict.existing_name }} ·
          {{ conflict.existing_id }}
        </li>
      </ul>
      <label
        >{{ text("conflictStrategy", "冲突策略")
        }}<select data-strategy :disabled="pending" v-model="strategy">
          <option value="keep_both">{{ text("keepBoth", "保留两者") }}</option>
          <option value="overwrite_same_origin" :disabled="!canOverwrite">
            {{ text("overwriteOrigin", "覆盖同源预设") }}
          </option>
        </select></label
      >
      <label
        ><input data-parameter-only :disabled="pending" type="checkbox" v-model="parameterOnly" />{{
          text("parameterOnly", "仅导入参数（移除全部素材层）")
        }}</label
      >
      <p v-if="!canOverwrite">
        {{
          text(
            "overwriteUnavailable",
            "覆盖需要恰好一个同源用户预设；无来源或零个/多个候选时只能保留两者。"
          )
        }}
      </p>
      <button data-cancel-import :disabled="pending" @click="cancel">
        {{ text("cancelImport", "取消导入") }}
      </button>
      <button
        data-confirm-import
        :disabled="pending || (strategy === 'overwrite_same_origin' && !canOverwrite)"
        @click="commit"
      >
        {{ text("confirmImport", "确认导入") }}
      </button>
    </div>
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
