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
  let stopActivity: (() => void) | undefined;
  let disposed = false;
  // Layout transitions emit no per-frame mutations. Own a clock only while CSS is active.
  function observeActivity(elements: Set<HTMLElement>) {
    const activities = new Map<HTMLElement, Map<string, number>>();
    let raf: number | undefined;
    let stopped = false;
    const stopFrame = () => {
      if (raf !== undefined) cancelAnimationFrame(raf);
      raf = undefined;
    };
    const tick = () => {
      raf = undefined;
      if (stopped) return;
      const now = performance.now();
      for (const [element, entries] of activities) {
        for (const [key, deadline] of entries) if (now >= deadline) entries.delete(key);
        if (!entries.size) activities.delete(element);
      }
      measure();
      if (activities.size) raf = requestAnimationFrame(tick);
    };
    const handle = (event: Event) => {
      const element = event.currentTarget as HTMLElement;
      if (event.target !== element || stopped) return;
      const animation = event.type.startsWith("animation");
      const detail = event as TransitionEvent & AnimationEvent;
      const key = `${animation ? "a" : "t"}:${animation ? detail.animationName : detail.propertyName}:${detail.pseudoElement || ""}`;
      const ending = event.type.endsWith("end") || event.type.endsWith("cancel");
      if (ending) {
        const entries = activities.get(element);
        entries?.delete(key);
        if (!entries?.size) activities.delete(element);
        measure(); // End/cancel must include the final compositor position.
        if (!activities.size) stopFrame();
        return;
      }
      let entries = activities.get(element);
      if (!entries) activities.set(element, (entries = new Map()));
      if (!entries.has(key)) {
        const css = getComputedStyle(element);
        const times = (value: string) =>
          value.split(",").map((v) => parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000) || 0);
        const durations = times(animation ? css.animationDuration : css.transitionDuration);
        const delays = times(animation ? css.animationDelay : css.transitionDelay);
        const names = (animation ? css.animationName : css.transitionProperty)
          .split(",")
          .map((v) => v.trim());
        const iterations = css.animationIterationCount.split(",").map(Number);
        const name = animation ? detail.animationName : detail.propertyName;
        let budget = 0;
        names.forEach((n, i) => {
          if (n !== name && n !== "all") return;
          const count = animation ? iterations[i % iterations.length] : 1;
          budget = Math.max(
            budget,
            durations[i % durations.length] * count + delays[i % delays.length]
          );
        });
        // Missing events/infinite animations must never leave an unbounded poller.
        entries.set(
          key,
          performance.now() +
            Math.min(60000, Number.isFinite(budget) ? Math.max(0, budget) + 250 : 60000)
        );
      }
      measure();
      if (raf === undefined) raf = requestAnimationFrame(tick);
    };
    const events = [
      "transitionrun",
      "transitionstart",
      "transitionend",
      "transitioncancel",
      "animationstart",
      "animationend",
      "animationcancel",
    ];
    for (const element of elements)
      for (const event of events) element.addEventListener(event, handle);
    return () => {
      stopped = true;
      stopFrame();
      activities.clear();
      for (const element of elements)
        for (const event of events) element.removeEventListener(event, handle);
    };
  }
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
    stopActivity?.();
    if (disposed) return;
    if (host.value) {
      mutations = new MutationObserver(() => {
        if (controller.value) receive(controller.value.getFrame());
      });
      const elements = new Set<HTMLElement>();
      for (const start of [host.value, props.sceneRoot]) {
        for (let ancestor = start; ancestor; ancestor = ancestor.parentElement)
          elements.add(ancestor);
      }
      for (const ancestor of elements)
        mutations.observe(ancestor, { attributes: true, attributeFilter: ["class", "style"] });
      stopActivity = observeActivity(elements);
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
      stopActivity?.();
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
    disposed = true;
    stopActivity?.();
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
    :data-source-loading="!!src && frame.layers.length === 0 ? 'true' : undefined"
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
