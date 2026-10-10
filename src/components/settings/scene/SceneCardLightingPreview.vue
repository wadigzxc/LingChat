<script setup lang="ts">
  import { computed, ref, onMounted, onBeforeUnmount } from "vue";
  import SourceImagePresentation from "@/components/game/lighting/SourceImagePresentation.vue";
  import { resolveLightingRoute } from "@/utils/scene-lighting/relighting/route";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { Image } from "lucide-vue-next";
  import type { LightingParams } from "@/types/scene-lighting";
  import { compileLighting } from "@/utils/scene-lighting/style";
  import { normalizeLighting } from "@/utils/scene-lighting/normalize";
  // Card projection has no IO and never asks the asset resolver for layer URLs.
  const normalized = computed(() => normalizeLighting(props.lighting));
  const assetCount = computed(() => normalized.value.asset_layers.length);
  const thumbnail = computed(() => ({ ...normalized.value, asset_layers: [] }));
  const props = defineProps<{
    lighting: LightingParams | null;
    background: string | null;
    name: string;
    simplified?: boolean;
  }>();
  const options = {
    supportsPlusLighter:
      typeof CSS !== "undefined" && CSS.supports("mix-blend-mode", "plus-lighter"),
  };
  const backgroundStyle = computed(() => compileLighting(thumbnail.value, "background", options));
  const overallStyle = computed(() => compileLighting(thumbnail.value, "both", options));
  const root = ref<HTMLElement | null>(null);
  const sourceOnly = computed(() => resolveLightingRoute(thumbnail.value).kind === "relighting");
  const visible = ref(false);
  let visibilityObserver: IntersectionObserver | null = null;
  onMounted(() => {
    visibilityObserver = new IntersectionObserver((entries) => {
      visible.value = entries.some((entry) => entry.isIntersecting);
    });
    if (root.value) visibilityObserver.observe(root.value);
  });
  onBeforeUnmount(() => {
    visibilityObserver?.disconnect();
  });
</script>
<template>
  <div ref="root" class="relative aspect-video overflow-hidden">
    <SourceImagePresentation
      v-if="background && sourceOnly"
      data-card-background-source
      :key="background"
      :src="convertFileSrc(background)"
      :lighting="thumbnail"
      :scene-root="root"
      :visible="visible"
      surface="background"
      object-fit="cover"
      position="center center"
      :duration="0"
    />
    <img
      v-else-if="background"
      data-card-background
      :src="convertFileSrc(background)"
      :alt="name"
      :style="{ filter: backgroundStyle.filter }"
      class="h-full w-full object-cover"
    />
    <div
      v-else
      data-card-placeholder
      class="flex h-full items-center justify-center bg-black/40 text-white/20"
    >
      <Image :size="48" />
    </div>
    <div
      v-if="backgroundStyle.ambient"
      data-card-ambient
      class="effect"
      :style="backgroundStyle.ambient"
    />
    <template v-for="(surface, index) in [backgroundStyle, overallStyle]" :key="index">
      <div v-if="surface.mainLight" data-card-main class="effect" :style="surface.mainLight" />
      <div
        v-if="!simplified && surface.bloom"
        data-card-bloom
        class="effect"
        :style="surface.bloom"
      />
    </template>
    <span
      v-if="assetCount"
      data-card-assets
      class="absolute right-1 bottom-1 rounded bg-black/70 px-2 text-xs text-white"
      >PNG · {{ assetCount }}</span
    >
    <div
      v-if="overallStyle.vignette"
      data-card-vignette
      class="effect"
      :style="overallStyle.vignette"
    />
  </div>
</template>
<style scoped>
  .effect {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
