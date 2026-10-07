<script setup lang="ts">
  import { useSceneEditorText } from "../useSceneEditorText";
  import type { LightingParams } from "@/types/scene-lighting";
  import LightingFields from "./LightingFields.vue";
  import { range, toggle, color, select, targets } from "./fields";
  defineProps<{ modelValue: LightingParams }>();
  const { text } = useSceneEditorText();
  const emit = defineEmits<{ "update:modelValue": [value: LightingParams] }>();
  const fields = [
    range("character.brightness", "角色亮度", 0.3, 2.2),
    range("character.contrast", "角色对比度", 0.5, 2),
    range("character.saturation", "角色饱和度", 0, 2.5),
    range("character.sepia", "角色褐色"),
    range("character.glow_radius", "角色旧泛光半径", 0, 50, 1),
    color("character.glow_color", "角色旧泛光色"),
    toggle("character_ambient.enabled", "角色环境色启用"),
    color("character_ambient.color", "角色环境色"),
    range("character_ambient.opacity", "角色环境色透明度"),
    toggle("rim_light.enabled", "轮廓光启用"),
    color("rim_light.color", "轮廓光色"),
    range("rim_light.intensity", "轮廓光强度", 0, 2),
    range("rim_light.width", "轮廓光宽度", 0, 64),
    range("rim_light.softness", "轮廓光柔和度", 0, 64),
    range("rim_light.angle", "轮廓光角度", 0, 360, 1),
    range("rim_light.offset", "轮廓光偏移", 0, 64),
    toggle("bloom.enabled", "角色泛光启用"),
    select("bloom.target", "角色泛光目标", targets),
    color("bloom.color", "角色泛光色"),
    range("bloom.radius", "角色泛光半径", 0, 64),
    range("bloom.intensity", "角色泛光强度"),
  ];
</script>
<template>
  <fieldset class="space-y-2 rounded border border-white/20 p-3 text-white">
    <legend>{{ text("character", "角色") }}</legend>
    <LightingFields
      :model-value="modelValue"
      :fields="fields"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </fieldset>
</template>
