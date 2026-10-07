<script setup lang="ts">
  import { useI18n } from "vue-i18n";
  import type { LightingParams } from "@/types/scene-lighting";
  import { readField, updateField, type LightingField } from "./fields";
  const props = defineProps<{ modelValue: LightingParams; fields: LightingField[] }>();
  const emit = defineEmits<{ "update:modelValue": [value: LightingParams] }>();
  const { t, te } = useI18n();
  const label = (f: LightingField) => {
    const key = `settings.lighting.fields.${f.path
      .replace(/^asset_layers\.\d+\./, "asset_layers.")
      .split(".")
      .join("_")}`;
    return te(key) ? t(key) : f.label;
  };
  const optionLabel = (value: string) => {
    const key = `settings.lighting.options.${value}`;
    return te(key) ? t(key) : value;
  };
  function update(f: LightingField, event: Event) {
    const input = event.target as HTMLInputElement;
    const value =
      f.type === "checkbox"
        ? input.checked
        : f.type === "range"
          ? Number(input.value)
          : input.value;
    emit("update:modelValue", updateField(props.modelValue, f.path, value));
  }
</script>
<template>
  <label
    v-for="field in fields"
    :key="field.path"
    class="flex items-center justify-between gap-3 py-1 text-xs"
  >
    <span>{{ label(field) }}</span>
    <select
      v-if="field.type === 'select'"
      :aria-label="label(field)"
      :data-field="field.path"
      :data-asset-field="
        field.path.startsWith('asset_layers.') ? field.path.split('.').pop() : undefined
      "
      :value="readField(modelValue, field.path) as string"
      @change="update(field, $event)"
      class="max-w-44 rounded bg-slate-800 p-1"
    >
      <option v-for="option in field.options" :key="option" :value="option">
        {{ optionLabel(option) }}
      </option>
    </select>
    <template v-else>
      <input
        :type="field.type"
        :aria-label="label(field)"
        :data-field="field.path"
        :data-asset-field="
          field.path.startsWith('asset_layers.') ? field.path.split('.').pop() : undefined
        "
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :checked="readField(modelValue, field.path) === true"
        :value="readField(modelValue, field.path) as string | number"
        @input="field.type === 'range' && update(field, $event)"
        @change="field.type !== 'range' && update(field, $event)"
        class="max-w-44 rounded bg-slate-800 p-1 accent-purple-400"
      />
      <output v-if="field.type === 'range'" class="w-10 text-right tabular-nums">{{
        readField(modelValue, field.path)
      }}</output>
    </template>
  </label>
</template>
