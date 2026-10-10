<script setup lang="ts">
  import { nextTick, onBeforeUnmount, ref, watch } from "vue";
  import { createDomImageBinding } from "@/utils/scene-lighting/relighting/bindings";
  import type {
    AdapterState,
    ImageBinding,
    ImageVisualFrame,
    SurfaceRoute,
  } from "@/utils/scene-lighting/relighting/types";

  /** Props-only producer. The host owns the authoritative frame and DOM fallback visibility. */
  const props = withDefaults(
    defineProps<{ route: SurfaceRoute; frame: ImageVisualFrame; visible?: boolean }>(),
    { visible: true }
  );
  const emit = defineEmits<{ state: [state: AdapterState] }>();
  const canvas = ref<HTMLCanvasElement | null>(null);
  let binding: ImageBinding | null = null,
    generation = 0,
    bindingGeneration = 0,
    disposed = false;
  let pending: Promise<ImageBinding | null> | null = null;
  function release() {
    bindingGeneration++;
    binding?.dispose();
    binding = null;
    pending = null;
  }
  watch(
    [() => props.visible, () => props.route, () => props.frame, canvas],
    async () => {
      const epoch = ++generation;
      if (disposed) return;
      if (!props.visible || props.route.kind !== "webgl") {
        release();
        emit("state", {
          kind: "identity",
          reason: !props.visible
            ? "hidden"
            : props.route.kind === "identity"
              ? props.route.reason
              : "legacy",
        });
        return;
      }
      await nextTick();
      if (disposed || epoch !== generation || !canvas.value) return;
      if (!binding) {
        if (!pending) {
          const lifetime = bindingGeneration;
          pending = createDomImageBinding(canvas.value, (state) => {
            if (
              !disposed &&
              lifetime === bindingGeneration &&
              props.visible &&
              props.route.kind === "webgl"
            )
              emit("state", state);
          }).then((candidate) => {
            if (disposed || lifetime !== bindingGeneration) {
              candidate.dispose();
              return null;
            }
            binding = candidate;
            pending = null;
            return candidate;
          });
        }
        await pending;
      }
      if (disposed || epoch !== generation || !binding) return;
      binding.setFrame(props.frame);
      binding.update(props.route);
    },
    { immediate: true, deep: true, flush: "post" }
  );
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    release();
  });
</script>

<template>
  <canvas
    v-if="visible && route.kind === 'webgl'"
    ref="canvas"
    class="webgl-image-surface"
    aria-hidden="true"
  />
</template>

<style scoped>
  .webgl-image-surface {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    visibility: hidden;
  }
</style>
