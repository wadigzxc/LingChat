<script setup lang="ts">
  import { computed } from "vue";
  import { normalizeLighting } from "@/utils/scene-lighting/normalize";
  import { compileLighting, type LightingCompileOptions } from "@/utils/scene-lighting/style";
  import type { LightingAssetResolver } from "./index";
  import LightingOverlay from "./LightingOverlay.vue";
  import LightingAssetStack from "./LightingAssetStack.vue";

  const props = defineProps<{
    lighting: unknown;
    simplified?: boolean;
    live2d?: boolean;
    live2dReady?: boolean;
    /** Host reports actual visible fallback, not merely the existence of its URL. */
    fallbackVisible?: boolean;
    options?: LightingCompileOptions;
    resolveAsset?: LightingAssetResolver;
  }>();
  const staticVisible = computed(
    () => !props.live2d || (!props.live2dReady && props.fallbackVisible === true)
  );
  const input = computed(() => {
    if (!staticVisible.value) return null;
    if (!props.simplified) return props.lighting;
    // normalizeLighting creates a fresh snapshot; quality changes never edit the source.
    const lighting = normalizeLighting(props.lighting);
    lighting.bloom.enabled = false;
    return lighting;
  });
  const compiled = computed(() => compileLighting(input.value, "character", props.options));
</script>

<template>
  <div data-lighting-frame :style="{ position: 'relative', isolation: 'isolate' }">
    <LightingAssetStack
      v-if="staticVisible && resolveAsset"
      :lighting="lighting"
      surface="character"
      placement="behind"
      :resolve-asset="resolveAsset"
      :options="options"
      :simplified="simplified"
    />
    <div
      data-lighting-visual
      :style="{
        filter: compiled.filter,
        position: 'relative',
        width: '100%',
        height: '100%',
        zIndex: 1,
      }"
    >
      <slot />
    </div>
    <div
      v-if="staticVisible"
      data-lighting-character-effects
      :style="{ position: 'absolute', inset: '0', zIndex: 1, pointerEvents: 'none' }"
    >
      <LightingOverlay
        :lighting="lighting"
        surface="character"
        :options="options"
        :simplified="simplified"
      />
    </div>
    <LightingAssetStack
      v-if="staticVisible && resolveAsset"
      :lighting="lighting"
      surface="character"
      placement="front"
      :resolve-asset="resolveAsset"
      :options="options"
      :simplified="simplified"
    />
    <slot name="accessories" />
  </div>
</template>
