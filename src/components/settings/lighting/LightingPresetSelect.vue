<script setup lang="ts">
  import { ref, onMounted, computed, watch } from "vue";
  import { listLightingPresets, applyLightingPreset } from "@/api/services/scene-lighting";
  import type { LightingPreset, PresetSort } from "@/types/scene-lighting";
  import { matchesLightingPreset } from "@/utils/scene-lighting/search";
  const props = defineProps<{
    refreshKey?: number;
    activePresetId?: string | null;
    draftOnly?: boolean;
  }>();
  const emit = defineEmits<{
    select: [preset: LightingPreset];
    loaded: [presets: LightingPreset[]];
  }>();
  const presets = ref<LightingPreset[]>([]);

  const query = ref("");
  const sort = ref<PresetSort>("favorite_first");
  const visible = computed(() =>
    presets.value
      .filter((p) =>
        matchesLightingPreset(p, query.value, displayName(p), [
          presetDescription(p),
          ...presetClassifications(p),
        ])
      )
      .sort((a, b) => {
        if (sort.value === "favorite_first" && a.favorite !== b.favorite)
          return Number(b.favorite) - Number(a.favorite);
        if (sort.value === "recently_used") {
          const recent = (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "");
          if (recent) return recent;
        }
        return displayName(a).localeCompare(displayName(b));
      })
  );
  function parts(text: string) {
    const needle = query.value.trim().toLowerCase();
    if (!needle) return [{ text, match: false }];
    const result: { text: string; match: boolean }[] = [];
    let start = 0;
    let index = text.toLowerCase().indexOf(needle);
    while (index >= 0) {
      result.push(
        { text: text.slice(start, index), match: false },
        { text: text.slice(index, index + needle.length), match: true }
      );
      start = index + needle.length;
      index = text.toLowerCase().indexOf(needle, start);
    }
    result.push({ text: text.slice(start), match: false });
    return result;
  }
  import { useLightingOperation } from "./useLightingOperation";
  import { useLightingText } from "./useLightingText";
  const { pending, run, text, presetName: displayName } = useLightingOperation();
  const { presetClassifications, presetDescription } = useLightingText();
  async function load() {
    presets.value = await listLightingPresets("favorite_first");
    emit("loaded", JSON.parse(JSON.stringify(presets.value)));
  }
  async function apply(id: string) {
    if (props.draftOnly) {
      const preset = presets.value.find((p) => p.id === id);
      if (preset) emit("select", JSON.parse(JSON.stringify(preset)));
      return;
    }
    await run(
      async () => {
        await applyLightingPreset(id);
        await load();
      },
      text("applied", "已临时应用光影")
    );
  }
  onMounted(() => run(load));
  let refreshQueued = false;
  watch(
    () => props.refreshKey,
    () => {
      if (pending.value) refreshQueued = true;
      else void run(load);
    }
  );
  watch(pending, (value) => {
    if (!value && refreshQueued) {
      refreshQueued = false;
      void run(load);
    }
  });
</script>
<template>
  <section class="space-y-2 rounded-xl border border-white/20 bg-black/20 p-3 text-white">
    <details open>
      <summary data-toggle-presets class="cursor-pointer py-2">
        {{ text("choosePreset", "选择光影预设") }}
      </summary>
      <button data-reload :disabled="pending" @click="run(load)">
        {{ text("refresh", "刷新预设") }}
      </button>
      <input
        data-search
        v-model="query"
        :aria-label="text('search', '搜索预设')"
        class="w-full rounded bg-white/10 p-2"
      />
      <select
        data-sort
        v-model="sort"
        :aria-label="text('sort', '预设排序')"
        class="rounded bg-white/10 p-2"
      >
        <option value="favorite_first">{{ text("favoriteFirst", "收藏优先") }}</option>
        <option value="recently_used">{{ text("recentFirst", "最近使用") }}</option>
        <option value="name">{{ text("name", "名称") }}</option>
      </select>
      <div role="listbox" class="max-h-72 overflow-y-auto">
        <button
          v-for="preset in visible"
          :key="preset.id"
          :data-preset="preset.id"
          @click="apply(preset.id)"
          :disabled="pending"
          role="option"
          :aria-selected="activePresetId === preset.id"
          class="flex w-full flex-wrap items-center gap-2 rounded-lg p-2 text-left
            hover:bg-white/10"
        >
          <span
            data-color
            class="h-3 w-3 rounded-full"
            :style="{ backgroundColor: preset.lighting.main_light.color_start }"
          ></span>
          <span data-preset-name>
            <template v-for="(part, i) in parts(displayName(preset))" :key="i">
              <mark v-if="part.match">{{ part.text }}</mark
              ><span v-else>{{ part.text }}</span>
            </template>
          </span>
          <span data-preset-description class="w-full text-sm text-white/70">
            <template v-for="(part, i) in parts(presetDescription(preset))" :key="i">
              <mark v-if="part.match">{{ part.text }}</mark
              ><span v-else>{{ part.text }}</span>
            </template>
          </span>
          <small
            v-for="classification in presetClassifications(preset)"
            :key="classification"
            data-preset-classification
            class="rounded bg-white/10 px-2 py-0.5"
          >
            <template v-for="(part, i) in parts(classification)" :key="i">
              <mark v-if="part.match">{{ part.text }}</mark
              ><span v-else>{{ part.text }}</span>
            </template>
          </small>
        </button>
      </div>
    </details>
  </section>
</template>
<style scoped>
  option {
    background: #182437;
    color: white;
  }
  [role="option"][aria-selected="true"] {
    background: rgb(56 189 248 / 20%);
    outline: 1px solid rgb(56 189 248 / 40%);
  }
  [role="option"]:disabled {
    opacity: 0.5;
  }
  mark {
    border-radius: 0.2rem;
    background: #fde68a;
    color: #172033;
  }
</style>
