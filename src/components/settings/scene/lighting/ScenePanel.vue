<script setup lang="ts">
  import { useSceneEditorText } from "../useSceneEditorText";
  import type { LightingParams } from "@/types/scene-lighting";
  import LightingFields from "./LightingFields.vue";
  import { range, toggle, color, select, targets } from "./fields";
  defineProps<{ modelValue: LightingParams }>();
  const { text } = useSceneEditorText();
  const emit = defineEmits<{ "update:modelValue": [value: LightingParams] }>();
  const fields = [
    range("background.brightness", "场景亮度", 0.3, 2.2),
    range("background.contrast", "场景对比度", 0.5, 2),
    range("background.saturation", "场景饱和度", 0, 2.5),
    range("background.sepia", "场景褐色"),
    range("background.glow_radius", "场景旧泛光半径", 0, 50, 1),
    color("background.glow_color", "场景旧泛光色"),
    toggle("background_ambient.enabled", "场景环境色启用"),
    color("background_ambient.color", "场景环境色"),
    range("background_ambient.opacity", "场景环境色透明度"),
    toggle("bloom.enabled", "场景泛光启用"),
    select("bloom.target", "场景泛光目标", targets),
    color("bloom.color", "场景泛光色"),
    range("bloom.radius", "场景泛光半径", 0, 64),
    range("bloom.intensity", "场景泛光强度"),
  ];
</script>
<template>
  <fieldset class="space-y-2 rounded border border-white/20 p-3 text-white">
    <legend>{{ text("scene", "场景") }}</legend>
    <LightingFields
      :model-value="modelValue"
      :fields="fields"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </fieldset>
</template>
