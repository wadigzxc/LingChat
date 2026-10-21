<script setup lang="ts">
  import { ref, useId, watch } from "vue";

  const props = defineProps<{
    groupId: string;
    title: string;
    enableLabel: string;
    enableField: string;
    enabled: boolean;
  }>();
  const emit = defineEmits<{ "update:enabled": [value: boolean] }>();
  const expanded = ref(props.enabled);
  const bodyId = `lighting-effect-${useId()}`;
  // Only actual flag changes override the user's local disclosure choice.
  watch(
    () => props.enabled,
    (enabled) => {
      expanded.value = enabled;
    }
  );
</script>

<template>
  <section :data-effect-group="groupId" class="effect-group">
    <div class="effect-header">
      <button
        type="button"
        data-effect-disclosure
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        @click="expanded = !expanded"
      >
        <span aria-hidden="true">{{ expanded ? "▾" : "▸" }}</span>
        {{ title }}
      </button>
      <input
        class="enable"
        type="checkbox"
        :aria-label="enableLabel"
        :data-field="enableField"
        :checked="enabled"
        @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
      />
    </div>
    <div v-show="expanded" :id="bodyId" data-effect-body class="effect-body"><slot /></div>
  </section>
</template>

<style scoped>
  .effect-group {
    min-width: 0;
  }
  .effect-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    text-align: left;
    font-weight: 600;
    padding: 0.5rem 0;
  }
  .enable {
    flex-shrink: 0;
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--accent-color, #818cf8);
  }
  .effect-body {
    padding-top: 0.5rem;
  }
  :focus-visible {
    outline: 2px solid var(--accent-color, #818cf8);
    outline-offset: 3px;
  }
</style>
