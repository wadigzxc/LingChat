<script setup lang="ts">
  import { computed } from "vue";
  import type { LightingParams, RelightingParams } from "@/types/scene-lighting";
  import { createRelightingParams } from "@/utils/scene-lighting/relighting-params";
  const props = defineProps<{ modelValue: LightingParams }>();
  const emit = defineEmits<{ "update:modelValue": [value: LightingParams] }>();
  const block = computed(() => props.modelValue.relighting ?? createRelightingParams());
  function update(change: (value: RelightingParams) => void) {
    const copy: LightingParams = JSON.parse(JSON.stringify(props.modelValue));
    copy.relighting ??= createRelightingParams();
    change(copy.relighting);
    if (copy.relighting.enabled) copy.enabled = true;
    emit("update:modelValue", copy);
  }
  function number(event: Event, min = 0, max = 4) {
    const input = event.target as HTMLInputElement;
    const raw = Number(input.value);
    const result = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : min));
    input.value = String(result);
    return result;
  }
  const value = (event: Event) => (event.target as HTMLInputElement).value;
</script>
<template>
  <section class="relighting-panel">
    <label class="enable"
      ><input
        aria-label="启用单灯受光"
        type="checkbox"
        :checked="block.enabled"
        @change="update((b) => (b.enabled = ($event.target as HTMLInputElement).checked))"
      />
      单灯受光</label
    >
    <p class="hint">仅照亮背景与角色，界面不受影响。停用后恢复旧光影。</p>
    <div v-if="block.enabled" class="controls">
      <label
        >模式<select
          aria-label="受光模式"
          :value="block.mode"
          @change="update((b) => (b.mode = value($event) as RelightingParams['mode']))"
        >
          <option value="original">原图加光</option>
          <option value="relight">重新打光</option>
        </select></label
      >
      <label
        >作用对象<select
          aria-label="作用对象"
          :value="block.target"
          @change="update((b) => (b.target = value($event) as RelightingParams['target']))"
        >
          <option value="both">角色与背景</option>
          <option value="character">仅角色</option>
          <option value="background">仅背景</option>
        </select></label
      >
      <h4>环境光</h4>
      <label
        >颜色<input
          aria-label="环境光颜色"
          type="color"
          :value="block.ambient.color"
          @input="update((b) => (b.ambient.color = value($event)))"
      /></label>
      <label
        >亮度<input
          aria-label="环境光亮度"
          type="number"
          min="0"
          max="2"
          step="0.05"
          :value="block.ambient.intensity"
          @input="update((b) => (b.ambient.intensity = number($event, 0, 2)))"
      /></label>
      <p v-if="block.mode === 'original'" data-ambient-original-note class="hint">
        原图加光模式下环境光不生效，仅叠加单点光。
      </p>
      <h4>单点光</h4>
      <label
        >启用<input
          aria-label="单灯启用"
          type="checkbox"
          :checked="block.point_light.enabled"
          @change="
            update((b) => (b.point_light.enabled = ($event.target as HTMLInputElement).checked))
          "
      /></label>
      <label
        >颜色<input
          aria-label="单灯颜色"
          type="color"
          :value="block.point_light.color"
          @input="update((b) => (b.point_light.color = value($event)))"
      /></label>
      <label
        >亮度<input
          aria-label="单灯亮度"
          type="number"
          min="0"
          max="4"
          step="0.05"
          :value="block.point_light.intensity"
          @input="update((b) => (b.point_light.intensity = number($event)))"
      /></label>
      <details>
        <summary>位置与范围精调</summary>
        <div class="controls">
          <label
            >位置 X<input
              aria-label="单灯位置X"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :value="block.point_light.x"
              @input="update((b) => (b.point_light.x = number($event, 0, 1)))"
          /></label>
          <label
            >位置 Y<input
              aria-label="单灯位置Y"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :value="block.point_light.y"
              @input="update((b) => (b.point_light.y = number($event, 0, 1)))"
          /></label>
          <label
            >范围<input
              aria-label="单灯范围"
              type="number"
              min="0.01"
              max="2"
              step="0.01"
              :value="block.point_light.radius"
              @input="update((b) => (b.point_light.radius = number($event, 0.01, 2)))"
          /></label>
          <label
            >柔度<input
              aria-label="单灯柔度"
              type="number"
              min="0"
              max="1"
              step="0.01"
              :value="block.point_light.softness"
              @input="update((b) => (b.point_light.softness = number($event, 0, 1)))"
          /></label>
        </div>
      </details>
      <p class="hint">拖动预览中的灯心与范围手柄，也可用方向键微调。高亮度可能使细节饱和。</p>
    </div>
  </section>
</template>
<style scoped>
  .relighting-panel {
    color: var(--text-primary, #f1f5f9);
  }
  .enable {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    font-weight: 600;
  }
  .hint {
    color: var(--text-secondary, #94a3b8);
    font-size: 0.8rem;
    margin: 0.5rem 0 1rem;
  }
  .controls {
    display: grid;
    gap: 0.7rem;
  }
  .controls label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    font-size: 0.875rem;
  }
  h4 {
    font-size: 0.8rem;
    font-weight: 600;
    margin-top: 0.65rem;
    color: var(--text-secondary, #cbd5e1);
  }
  select,
  input[type="number"] {
    width: 10rem;
    border: 1px solid var(--border-color, #475569);
    border-radius: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: var(--bg-secondary, #1e293b);
    color: inherit;
  }
  input[type="color"] {
    width: 3rem;
    height: 2rem;
  }
  :focus-visible {
    outline: 2px solid var(--accent-color, #818cf8);
    outline-offset: 3px;
  }
</style>
