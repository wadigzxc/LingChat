<script setup lang="ts">
  import { computed } from "vue";
  import { useSettingsStore } from "@/stores/modules/settings";
  const settings = useSettingsStore();
  const simplified = computed({
    get: () => settings.display.simplifiedLighting,
    set: (value: boolean) => settings.update("display.simplifiedLighting", value),
  });
</script>
<template>
  <label class="flex items-center gap-2 text-sm">
    <input v-model="simplified" type="checkbox" />
    <span>简化光影</span>
    <span class="text-xs opacity-60">关闭泛光与 PNG 光效</span>
  </label>
</template>
