<script setup lang="ts">
  import { computed, ref, onMounted, onScopeDispose, watch } from "vue";
  import type { LightingParams } from "@/types/scene-lighting";
  const props = defineProps<{
    lighting: LightingParams;
    stage?: HTMLElement;
    disabled?: boolean;
  }>();
  const emit = defineEmits<{ "update:lighting": [LightingParams] }>();
  const size = ref({ width: 0, height: 0 });
  function measure() {
    const r = props.stage?.getBoundingClientRect();
    size.value = { width: r?.width ?? 0, height: r?.height ?? 0 };
  }
  const radiusPx = computed(
    () =>
      (props.lighting.relighting?.point_light.radius ?? 0) *
      Math.min(size.value.width, size.value.height)
  );
  // The circle represents the true scene radius; only the controls are inset.
  const handles = computed(() => {
    const p = props.lighting.relighting?.point_light;
    const x = (p?.x ?? 0) * size.value.width,
      y = (p?.y ?? 0) * size.value.height;
    const inset = (v: number, length: number) =>
      Math.max(Math.min(26, length / 2), Math.min(length - 26, v));
    const style = (px: number) => ({
      left: `${inset(px, size.value.width) - x}px`,
      top: `${inset(y, size.value.height) - y}px`,
    });
    return {
      center: style(x),
      radius: style(x + (x <= size.value.width / 2 ? 1 : -1) * Math.max(52, radiusPx.value)),
    };
  });
  let observer: ResizeObserver | undefined;
  watch(
    () => props.stage,
    (stage) => {
      observer?.disconnect();
      measure();
      if (stage && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(stage);
      }
    },
    { immediate: true, flush: "post" }
  );
  let drag: {
    id: number;
    element: HTMLElement;
    radius: boolean;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    value: number;
  } | null = null;
  function stop() {
    const previous = drag;
    drag = null;
    if (previous?.element.hasPointerCapture?.(previous.id))
      previous.element.releasePointerCapture(previous.id);
  }
  function start(event: PointerEvent, radius = false) {
    if (props.disabled || !props.lighting.relighting?.point_light.enabled || event.button > 0)
      return;
    stop();
    const element = event.currentTarget as HTMLElement;
    const point = props.lighting.relighting.point_light;
    drag = {
      id: event.pointerId,
      element,
      radius,
      clientX: event.clientX,
      clientY: event.clientY,
      x: point.x,
      y: point.y,
      value: point.radius,
    };
    element.setPointerCapture?.(event.pointerId);
  }
  function update(x: number, y: number) {
    if (props.disabled || !props.lighting.relighting) return;
    const copy: LightingParams = JSON.parse(JSON.stringify(props.lighting));
    Object.assign(copy.relighting!.point_light, {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
    emit("update:lighting", copy);
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id || props.disabled || !props.stage) return;
    const r = props.stage.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (drag.radius) {
      // Relative horizontal motion keeps an inset/out-of-range handle from jumping.
      setRadius(drag.value + (event.clientX - drag.clientX) / Math.min(r.width, r.height));
    } else
      update(
        drag.x + (event.clientX - drag.clientX) / r.width,
        drag.y + (event.clientY - drag.clientY) / r.height
      );
  }
  function end(event: PointerEvent) {
    if (event.pointerId === drag?.id) stop();
  }
  function setRadius(radius: number) {
    if (props.disabled || !props.lighting.relighting) return;
    const copy: LightingParams = JSON.parse(JSON.stringify(props.lighting));
    copy.relighting!.point_light.radius = Math.max(0.01, Math.min(2, radius));
    emit("update:lighting", copy);
  }
  function key(event: KeyboardEvent, radius = false) {
    if (props.disabled || !props.lighting.relighting?.point_light.enabled) return;
    const point = props.lighting.relighting.point_light;
    const step = event.shiftKey ? 0.1 : 0.01;
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = direction[event.key];
    if (!delta) return;
    event.preventDefault();
    if (radius) setRadius(point.radius + (delta[0] || -delta[1]));
    else update(point.x + delta[0], point.y + delta[1]);
  }
  watch(
    () => props.disabled,
    (value) => {
      if (value) stop();
    }
  );
  onMounted(() => {
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", stop);
  });
  onScopeDispose(() => {
    stop();
    observer?.disconnect();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", stop);
  });
</script>
<template>
  <div
    v-if="lighting.relighting?.enabled && lighting.relighting.point_light.enabled"
    class="gizmo"
    :style="{
      left: `${lighting.relighting.point_light.x * 100}%`,
      top: `${lighting.relighting.point_light.y * 100}%`,
    }"
  >
    <div
      data-relighting-range
      class="range"
      :style="{ width: `${radiusPx * 2}px`, height: `${radiusPx * 2}px` }"
    ></div>
    <button
      data-relighting-radius
      aria-label="单灯范围，方向键微调"
      title="左右拖动调整范围；方向键微调"
      :disabled="disabled"
      @pointerdown.prevent.stop="start($event, true)"
      @lostpointercapture="stop"
      @keydown="key($event, true)"
      class="radius"
      :style="handles.radius"
    >
      ↔
    </button>
    <button
      data-relighting-center
      aria-label="单灯位置，方向键微调"
      :disabled="disabled"
      @pointerdown.prevent.stop="start"
      @lostpointercapture="stop"
      @keydown="key"
      class="center"
      :style="handles.center"
    >
      ＋
    </button>
  </div>
</template>
<style scoped>
  .gizmo {
    position: absolute;
    z-index: 5;
    pointer-events: none;
  }
  .range {
    position: absolute;
    transform: translate(-50%, -50%);
    border: 1px solid #fff1d280;
    border-radius: 50%;
  }
  .radius {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 2.75rem;
    height: 2.75rem;
    pointer-events: auto;
    touch-action: none;
    color: #fff1d2;
    background: #0f172a80;
    border: 1px solid #fff1d2;
    border-radius: 50%;
    cursor: ew-resize;
  }
  .center {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 2.75rem;
    height: 2.75rem;
    touch-action: none;
    pointer-events: auto;
    color: #fff1d2;
    border: 1px solid #fff1d2;
    border-radius: 50%;
    background: #0f172a80;
    cursor: move;
  }
  button:focus-visible {
    outline: 2px solid var(--accent-color, #818cf8);
    outline-offset: 4px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
