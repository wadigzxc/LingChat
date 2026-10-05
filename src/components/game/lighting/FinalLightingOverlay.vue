<script setup lang="ts">
  import { computed } from "vue";
  import type { AssetPlacement } from "@/types/scene-lighting";
  import { compileLighting, type LightingCompileOptions } from "@/utils/scene-lighting/style";
  import type { LightingAssetResolver } from "./index";
  import LightingAssetStack from "./LightingAssetStack.vue";

  const props = withDefaults(
    defineProps<{
      lighting: unknown;
      simplified?: boolean;
      /** Behind mounts below the character stage; front mounts above it, below dialogue. */
      placement?: AssetPlacement;
      showVignette?: boolean;
      resolveAsset?: LightingAssetResolver;
      options?: LightingCompileOptions;
    }>(),
    { placement: "front", showVignette: true }
  );
  const compiled = computed(() => compileLighting(props.lighting, "both", props.options));
</script>

<template>
  <div
    data-lighting-final
    :style="{ position: 'absolute', inset: '0', isolation: 'isolate', pointerEvents: 'none' }"
  >
    <LightingAssetStack
      v-if="resolveAsset"
      :lighting="lighting"
      surface="both"
      :placement="placement"
      :resolve-asset="resolveAsset"
      :options="options"
      :simplified="simplified"
    />
    <div
      v-if="placement === 'front' && showVignette && compiled.vignette"
      data-lighting-effect="vignette"
      aria-hidden="true"
      :style="{
        ...compiled.vignette,
        position: 'absolute',
        inset: '0',
        zIndex: 3,
        pointerEvents: 'none',
      }"
    />
  </div>
</template>
