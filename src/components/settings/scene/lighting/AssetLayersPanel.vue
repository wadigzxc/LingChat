<script setup lang="ts">
  import { useSceneEditorText } from "../useSceneEditorText";
  import type { LightingParams } from "@/types/scene-lighting";
  import LightingFields from "./LightingFields.vue";
  import { range, toggle, color, select, targets, blends } from "./fields";
  const props = defineProps<{ modelValue: LightingParams }>();
  const { text } = useSceneEditorText();
  const emit = defineEmits<{ "update:modelValue": [value: LightingParams] }>();
  let nextId = 0;
  function add() {
    if (props.modelValue.asset_layers.length >= 8) return;
    const copy: LightingParams = JSON.parse(JSON.stringify(props.modelValue));
    let id: string;
    do {
      id = `layer-${++nextId}`;
    } while (copy.asset_layers.some((l) => l.id === id));
    copy.asset_layers.push({
      id,
      asset_hash: "",
      media_type: "image/png",
      target: "both",
      placement: "behind",
      z_index: 0,
      opacity: 1,
      blend_mode: "normal",
      fit: "cover",
      required: false,
    });
    emit("update:modelValue", copy);
  }
  function remove(index: number) {
    const copy: LightingParams = JSON.parse(JSON.stringify(props.modelValue));
    copy.asset_layers.splice(index, 1);
    emit("update:modelValue", copy);
  }
  function fields(index: number) {
    const path = (key: string) => `asset_layers.${index}.${key}`;
    return [
      color(path("id"), "素材层ID"),
      color(path("asset_hash"), "素材SHA-256"),
      select(path("media_type"), "素材格式", ["image/png"]),
      select(path("target"), "素材目标", targets),
      select(path("placement"), "素材位置", ["behind", "front"]),
      range(path("z_index"), "素材层级", 0, 7, 1),
      select(path("fit"), "素材适配", ["cover", "contain", "stretch"]),
      range(path("opacity"), "素材透明度"),
      select(path("blend_mode"), "素材混合", blends),
      toggle(path("required"), "素材必需"),
    ];
  }
</script>
<template>
  <fieldset class="space-y-2 rounded border border-white/20 p-3 text-white">
    <legend>{{ text("assets", "素材层") }}</legend>
    <p class="text-xs">{{ text("assetHelp", "使用已有导入素材的 SHA-256；不上传新素材。") }}</p>
    <button data-add-asset :disabled="modelValue.asset_layers.length >= 8" @click="add">
      {{ text("addAsset", "添加 PNG 素材层") }}
    </button>
    <div
      v-for="(layer, index) in modelValue.asset_layers"
      :key="index"
      data-asset-row
      class="rounded border border-white/10 p-2"
    >
      <button data-remove-asset @click="remove(index)">
        {{ text("removeAsset", "移除素材层") }}
      </button>
      <LightingFields
        :model-value="modelValue"
        :fields="fields(index)"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>
  </fieldset>
</template>
