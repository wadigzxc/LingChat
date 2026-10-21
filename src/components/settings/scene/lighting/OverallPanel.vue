<script setup lang="ts">
  import { useSceneEditorText } from "../useSceneEditorText";
  import type { LightingParams } from "@/types/scene-lighting";
  import LightingFields from "./LightingFields.vue";
  import LightingEffectGroup from "./LightingEffectGroup.vue";
  import { range, toggle, color, select, targets, blends, updateField } from "./fields";
  const props = defineProps<{ modelValue: LightingParams }>();
  const { text } = useSceneEditorText();
  const emit = defineEmits<{ "update:modelValue": [value: LightingParams] }>();
  const fields = [
    toggle("enabled", "启用光影"),
    toggle("link_character_background", "联动角色与场景"),
    range("master_intensity", "总强度", 0, 2),
  ];
  const groups = [
    {
      id: "main_light" as const,
      title: "主光",
      enableLabel: "主光启用",
      fields: [
        select("main_light.shape", "主光形状", ["radial", "linear"]),
        select("main_light.target", "主光目标", targets),
        range("main_light.x", "主光位置X"),
        range("main_light.y", "主光位置Y"),
        range("main_light.angle", "主光角度", 0, 360, 1),
        range("main_light.radius", "主光半径"),
        color("main_light.color_start", "主光起始色"),
        color("main_light.color_end", "主光结束色"),
        range("main_light.opacity", "主光透明度"),
        select("main_light.blend_mode", "主光混合", blends),
      ],
    },
    {
      id: "vignette" as const,
      title: "暗角",
      enableLabel: "暗角启用",
      fields: [
        color("vignette.color", "暗角色"),
        range("vignette.intensity", "暗角强度"),
        range("vignette.radius", "暗角半径"),
        range("vignette.softness", "暗角柔和度"),
      ],
    },
  ];
</script>
<template>
  <fieldset
    data-lighting-panel="overall"
    class="space-y-2 rounded border border-white/20 p-3 text-white"
  >
    <legend>{{ text("overall", "整体") }}</legend>
    <LightingFields
      :model-value="modelValue"
      :fields="fields"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <LightingEffectGroup
      v-for="group in groups"
      :key="group.id"
      :group-id="group.id"
      :title="text(`groups.${group.id}`, group.title)"
      :enable-label="text(`fields.${group.id}_enabled`, group.enableLabel)"
      :enable-field="`${group.id}.enabled`"
      :enabled="modelValue[group.id].enabled"
      @update:enabled="
        emit('update:modelValue', updateField(props.modelValue, `${group.id}.enabled`, $event))
      "
    >
      <LightingFields
        :model-value="modelValue"
        :fields="group.fields"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </LightingEffectGroup>
  </fieldset>
</template>
