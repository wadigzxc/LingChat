<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
  import ImageAcrossFade from "@/components/ui/ImageAcrossFade.vue";
  import WebGLImageSurface from "./WebGLImageSurface.vue";
  import {
    sceneProvider,
    sourceMeasure,
    observeGeometry,
  } from "@/utils/scene-lighting/relighting/geometry";
  import { resolveLightingRoute } from "@/utils/scene-lighting/relighting/route";
  import { compileRelightingShaderSpec } from "@/utils/scene-lighting/relighting/math";
  import type {
    AdapterState,
    ImageVisualFrame,
    SurfaceKind,
    SurfaceRoute,
  } from "@/utils/scene-lighting/relighting/types";
  const props = withDefaults(
    defineProps<{
      src: string;
      lighting: unknown;
      surface: SurfaceKind;
      duration?: number;
      objectFit?: string;
      position?: string;
      visible?: boolean;
      sceneRoot?: HTMLElement | null;
    }>(),
    { duration: 300, objectFit: "contain", position: "center bottom", visible: true }
  );
  const emit = defineEmits<{ sourceError: [src: string] }>();
  const host = ref<HTMLElement | null>(null);
  const controller = ref<InstanceType<typeof ImageAcrossFade> | null>(null);
  const frame = shallowRef<ImageVisualFrame>({
    requestToken: 0,
    revision: 0,
    layers: [],
    transitionActive: false,
  });
  const route = shallowRef<SurfaceRoute>({
    kind: "identity",
    legacyAllowed: false,
    reason: "loading",
  });
  const state = shallowRef<AdapterState>({ kind: "identity", reason: "loading" });
  let stopObserve: (() => void) | undefined;
  let mutations: MutationObserver | null = null;
  function measure() {
    if (!host.value) return;
    const lightingRoute = resolveLightingRoute(props.lighting);
    if (lightingRoute.kind !== "relighting") {
      route.value = lightingRoute;
      return;
    }
    if (
      !["cover", "contain"].includes(props.objectFit) ||
      !["center bottom", "center center"].includes(props.position)
    ) {
      route.value = { kind: "identity", legacyAllowed: false, reason: "unsupported-image-layout" };
      return;
    }
    const root = props.sceneRoot || host.value;
    route.value = compileRelightingShaderSpec(
      lightingRoute,
      props.surface,
      sceneProvider(root),
      sourceMeasure(host.value, root),
      "supported"
    );
  }
  function receive(value: ImageVisualFrame) {
    frame.value = value;
    measure();
  }
  const active = computed(
    () =>
      props.visible &&
      route.value.kind === "webgl" &&
      state.value.kind === "active" &&
      state.value.sourceRevision === frame.value.revision
  );
  function observe() {
    stopObserve?.();
    mutations?.disconnect();
    if (host.value) {
      mutations = new MutationObserver(() => {
        if (controller.value) receive(controller.value.getFrame());
      });
      for (
        let ancestor: HTMLElement | null = host.value;
        ancestor;
        ancestor = ancestor.parentElement
      )
        mutations.observe(ancestor, { attributes: true, attributeFilter: ["class", "style"] });
    }
    if (host.value)
      stopObserve = observeGeometry(host.value, props.sceneRoot || host.value, () => {
        receive(controller.value!.getFrame());
      });
    measure();
  }
  onMounted(observe);
  watch(
    () => props.sceneRoot,
    async () => {
      await nextTick();
      observe();
    }
  );
  watch(
    [() => props.lighting, () => props.objectFit, () => props.position],
    () => {
      if (controller.value) receive(controller.value.getFrame());
      else measure();
    },
    { deep: true, flush: "post" }
  );
  onBeforeUnmount(() => {
    stopObserve?.();
    mutations?.disconnect();
  });
  async function waitForLoad() {
    await controller.value?.waitForLoad();
  }
  defineExpose({
    waitForLoad,
    getFrame: () => frame.value,
    getRoute: () => route.value,
    getState: () => state.value,
  });
</script>
<template>
  <div
    ref="host"
    data-relighting-image
    :data-relighting-state="state.kind"
    :data-relighting-reason="
      state.kind === 'identity' || state.kind === 'unavailable' ? state.reason : undefined
    "
    class="relative h-full w-full"
  >
    <ImageAcrossFade
      ref="controller"
      :src="src"
      :duration="duration"
      :object-fit="objectFit"
      :position="position"
      :source-hidden="active"
      @frame="receive"
      @source-error="emit('sourceError', $event)"
      ><slot
    /></ImageAcrossFade>
    <WebGLImageSurface :route="route" :frame="frame" :visible="visible" @state="state = $event" />
  </div>
</template>
