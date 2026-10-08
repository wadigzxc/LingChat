<script setup lang="ts">
  import { computed, ref, watch, onMounted, onScopeDispose } from "vue";
  import { useSceneEditorText } from "./useSceneEditorText";
  import { useI18n } from "vue-i18n";
  import defaultBackground from "@/assets/images/default_bg.jpg";

  import type { LightingParams } from "@/types/scene-lighting";
  import { compileLighting } from "@/utils/scene-lighting/style";
  import { useDraftLightingAssets } from "./useDraftLightingAssets";
  import {
    LightingAssetStack,
    LightingOverlay,
    StaticCharacterLightingFrame,
    FinalLightingOverlay,
  } from "@/components/game/lighting";
  const { text } = useSceneEditorText();
  const { t } = useI18n();
  const props = defineProps<{
    lighting: LightingParams;
    backgroundUrl?: string | null;
    avatarUrl?: string | null;
    avatarPlacement?: { offsetX?: number; offsetY?: number; scale?: number };
    live2d?: boolean;
    disabled?: boolean;
  }>();
  const emit = defineEmits<{
    "update:lighting": [value: LightingParams];
    warning: [message: string];
  }>();
  const options = {
    supportsPlusLighter:
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("mix-blend-mode", "plus-lighter"),
  };
  const stage = ref<HTMLElement>();
  const drag = ref<{ id: number; angle: boolean } | null>(null);
  function startDrag(event: PointerEvent, angle = false) {
    if (props.disabled) return;
    drag.value = { id: event.pointerId, angle };
  }
  function move(event: PointerEvent) {
    if (props.disabled || drag.value === null || event.pointerId !== drag.value.id || !stage.value)
      return;
    const rect = stage.value.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const copy: LightingParams = JSON.parse(JSON.stringify(props.lighting));
    if (drag.value.angle) {
      const dx = event.clientX - rect.left - props.lighting.main_light.x * rect.width;
      const dy = event.clientY - rect.top - props.lighting.main_light.y * rect.height;
      if (!dx && !dy) return;
      copy.main_light.angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    } else {
      copy.main_light.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      copy.main_light.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    }
    emit("update:lighting", copy);
  }
  const avatarStyle = computed(() => ({
    position: "absolute",
    zIndex: 2,
    left: `calc(50% + ${props.avatarPlacement?.offsetX ?? 0}px)`,
    top: `${props.avatarPlacement?.offsetY ?? 0}px`,
    width: "50%",
    height: "100%",
    transform: `translateX(-50%) scale(${props.avatarPlacement?.scale ?? 1})`,
    transformOrigin: "center 0%",
  }));
  function detectCachedAvatar() {
    avatarLoaded.value =
      !!avatarImage.value?.complete && (avatarImage.value?.naturalWidth ?? 0) > 0;
  }
  onMounted(detectCachedAvatar);
  const backgroundFailed = ref(false);
  const avatarFailed = ref(false);
  const avatarLoaded = ref(false);
  const avatarImage = ref<HTMLImageElement>();
  function onAvatarLoad(event: Event) {
    if (event.target === avatarImage.value) avatarLoaded.value = true;
  }
  watch(
    () => props.backgroundUrl,
    () => {
      backgroundFailed.value = false;
    }
  );
  watch(
    () => props.avatarUrl,
    () => {
      avatarFailed.value = false;
    }
  );
  const backgroundSrc = computed(() =>
    !props.backgroundUrl || backgroundFailed.value ? defaultBackground : props.backgroundUrl
  );
  // 缺少真实立绘时只预览场景，不能把测试插画误当成当前角色。
  const avatarSrc = computed(() =>
    !props.avatarUrl || avatarFailed.value ? null : props.avatarUrl
  );
  watch(
    avatarSrc,
    () => {
      avatarLoaded.value = false;
    },
    { flush: "sync" }
  );
  watch(avatarSrc, detectCachedAvatar, { flush: "post" });
  const original = ref(false);
  function release() {
    original.value = false;
    drag.value = null;
  }
  const releaseEvents = ["pointerup", "pointercancel", "blur"];
  onMounted(() => {
    releaseEvents.forEach((event) => window.addEventListener(event, release));
    window.addEventListener("pointermove", move);
  });
  onScopeDispose(() => {
    releaseEvents.forEach((event) => window.removeEventListener(event, release));
    window.removeEventListener("pointermove", move);
  });
  const previewLighting = computed(() =>
    original.value ? { ...props.lighting, enabled: false } : props.lighting
  );
  const {
    lighting: renderedLighting,
    resolveAsset,
    warnings,
  } = useDraftLightingAssets(previewLighting);
  const warned = new Set<string>();
  function warn(message: string) {
    if (!warned.has(message)) {
      warned.add(message);
      emit("warning", message);
    }
  }
  watch(warnings, (messages) => messages.forEach(warn), { deep: true });
  watch(
    renderedLighting,
    (input) => {
      if (
        ["character", "background", "both"].some(
          (surface) =>
            compileLighting(input, surface as "character" | "background" | "both", options).warnings
              .length
        )
      )
        warn(t("ui.lighting.compatMessage"));
    },
    { immediate: true, deep: true }
  );
  const background = computed(() => compileLighting(renderedLighting.value, "background", options));
</script>
<template>
  <section class="flex min-w-0 flex-1 flex-col gap-2 p-4">
    <p v-if="warnings.length" data-preview-warnings role="status" class="text-xs text-amber-300">
      {{ warnings.join("；") }}
    </p>
    <button
      data-view-original
      @keydown.space.prevent="original = true"
      @keydown.enter.prevent="original = true"
      @keyup.space="release"
      @keyup.enter="release"
      @blur="release"
      :aria-pressed="original"
      @pointerdown.prevent="original = true"
      @pointerup="original = false"
    >
      {{ text("holdOriginal", "按住查看原图") }}
    </button>
    <div
      ref="stage"
      data-preview-stage
      class="relative min-h-96 flex-1 overflow-hidden rounded-xl bg-slate-800"
      style="isolation: isolate"
    >
      <div class="absolute inset-0" style="z-index: 0; isolation: isolate">
        <img
          data-preview-background
          :key="backgroundSrc"
          :src="backgroundSrc"
          @error="backgroundFailed = true"
          :alt="text('previewBackground', '场景背景')"
          class="absolute inset-0 h-full w-full object-cover"
          :style="{ filter: background.filter }"
        />
        <LightingAssetStack
          :options="options"
          :lighting="renderedLighting"
          surface="background"
          placement="behind"
          :resolve-asset="resolveAsset"
        />
        <LightingOverlay :options="options" :lighting="renderedLighting" surface="background" />
        <LightingAssetStack
          :options="options"
          :lighting="renderedLighting"
          surface="background"
          placement="front"
          :resolve-asset="resolveAsset"
        />
      </div>
      <FinalLightingOverlay
        :resolve-asset="resolveAsset"
        :options="options"
        :lighting="renderedLighting"
        placement="behind"
        :show-vignette="false"
        style="z-index: 1"
      />
      <StaticCharacterLightingFrame
        v-if="avatarSrc"
        :live2d="live2d"
        :live2d-ready="false"
        :fallback-visible="avatarLoaded"
        :resolve-asset="resolveAsset"
        :options="options"
        :lighting="renderedLighting"
        :style="avatarStyle"
      >
        <img
          ref="avatarImage"
          data-preview-avatar
          @load="onAvatarLoad"
          :key="avatarSrc"
          :src="avatarSrc"
          @error="
            avatarFailed = true;
            avatarLoaded = false;
          "
          :alt="text('previewAvatar', '静态角色')"
          class="h-full w-full object-contain"
        />
      </StaticCharacterLightingFrame>
      <div class="pointer-events-none absolute inset-0" style="z-index: 3">
        <LightingOverlay :options="options" :lighting="renderedLighting" surface="both" />
      </div>
      <FinalLightingOverlay
        :resolve-asset="resolveAsset"
        :options="options"
        :lighting="renderedLighting"
        style="z-index: 4"
      />
      <button
        data-drag-light-position
        :disabled="disabled"
        :aria-label="text('dragPosition', '拖动主光位置')"
        @pointerdown.prevent="startDrag($event)"
        class="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2
          border-amber-300 text-amber-300"
        :style="{
          left: `${lighting.main_light.x * 100}%`,
          top: `${lighting.main_light.y * 100}%`,
          zIndex: 5,
          touchAction: 'none',
        }"
      >
        ＋
      </button>
      <button
        v-if="lighting.main_light.shape === 'linear'"
        data-drag-light-angle
        :disabled="disabled"
        :aria-label="text('dragAngle', '拖动主光角度')"
        @pointerdown.prevent="startDrag($event, true)"
        class="absolute h-7 w-7 rounded-full border-2 border-sky-300 text-sky-300"
        :style="{
          left: `${lighting.main_light.x * 100}%`,
          top: `${lighting.main_light.y * 100}%`,
          transform: `translate(-50%, -50%) rotate(${lighting.main_light.angle}deg) translateY(-48px)`,
          zIndex: 5,
          touchAction: 'none',
        }"
      >
        ↗
      </button>
    </div>
  </section>
</template>
