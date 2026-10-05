<script setup lang="ts">
  import { computed } from "vue";
  import type { LightingTarget } from "@/types/scene-lighting";
  import { compileLighting, type LightingCompileOptions } from "@/utils/scene-lighting/style";

  const props = defineProps<{
    lighting: unknown;
    /** Exact compiler slot: both is overall, not character + background. */
    surface: LightingTarget;
    options?: LightingCompileOptions;
    simplified?: boolean;
  }>();
  const compiled = computed(() => compileLighting(props.lighting, props.surface, props.options));
  const layerStyle = { position: "absolute", inset: "0", pointerEvents: "none" } as const;
</script>

<template>
  <div
    v-if="compiled.ambient"
    data-lighting-effect="ambient"
    aria-hidden="true"
    :style="{ ...compiled.ambient, ...layerStyle }"
  />
  <div
    v-if="compiled.mainLight"
    data-lighting-effect="main"
    aria-hidden="true"
    :style="{ ...compiled.mainLight, ...layerStyle }"
  />
  <div
    v-if="!simplified && compiled.bloom"
    data-lighting-effect="bloom"
    aria-hidden="true"
    :style="{ ...compiled.bloom, ...layerStyle }"
  />
</template>
