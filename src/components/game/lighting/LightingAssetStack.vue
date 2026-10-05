<script setup lang="ts">
  import { computed } from "vue";
  import type { AssetPlacement, LightingTarget } from "@/types/scene-lighting";
  import { compileLighting, type LightingCompileOptions } from "@/utils/scene-lighting/style";
  import type { LightingAssetResolver } from "./index";

  const props = defineProps<{
    lighting: unknown;
    surface: LightingTarget;
    /** One fixed placement per mount; host mounts behind/front in separate stage slots. */
    placement: AssetPlacement;
    resolveAsset: LightingAssetResolver;
    options?: LightingCompileOptions;
    simplified?: boolean;
  }>();
  const assets = computed(() =>
    props.simplified
      ? []
      : compileLighting(props.lighting, props.surface, props.options)
          .assets.filter(({ layer }) => layer.placement === props.placement)
          // ECMAScript stable sort preserves input order for equal slot-local z-indices.
          .sort((a, b) => a.layer.z_index - b.layer.z_index)
          .map((asset) => ({ ...asset, src: props.resolveAsset(asset.layer) }))
          .filter((asset) => !!asset.src)
  );
</script>

<template>
  <div
    v-if="assets.length"
    :data-lighting-assets="placement"
    aria-hidden="true"
    :style="{
      position: 'absolute',
      inset: '0',
      isolation: 'isolate',
      zIndex: placement === 'behind' ? 0 : 2,
      pointerEvents: 'none',
    }"
  >
    <img
      v-for="(asset, index) in assets"
      :key="index"
      :src="asset.src ?? undefined"
      alt=""
      draggable="false"
      :style="{
        ...asset.style,
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }"
    />
  </div>
</template>
