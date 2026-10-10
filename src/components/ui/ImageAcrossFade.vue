<template>
  <div ref="rootRef" class="relative h-full w-full">
    <!-- 底层图片（当前显示的图片） -->
    <slot></slot>
    <div
      class="absolute inset-0 z-10 h-full w-full bg-no-repeat will-change-[opacity,background-image]
        backface-hidden"
      :style="{
        backgroundImage: `url(${currentImageUrl})`,
        backgroundSize: objectFit,
        backgroundPosition: position,
        visibility: sourceHidden ? 'hidden' : 'visible',
      }"
    ></div>

    <!-- 顶层图片（准备淡入的新图片） -->
    <!-- 新增 ref="topDivRef" 用于强制重排 -->
    <div
      ref="topDivRef"
      class="absolute inset-0 z-20 h-full w-full bg-no-repeat transition-opacity ease-in-out
        will-change-[opacity,background-image] backface-hidden"
      :class="isFadingIn ? 'opacity-100' : 'opacity-0'"
      :style="{
        backgroundImage: `url(${nextImageUrl})`,
        backgroundSize: objectFit,
        backgroundPosition: position,
        visibility: sourceHidden ? 'hidden' : 'visible',
        transitionDuration: isFadingIn ? `${duration}ms` : '0ms',
      }"
      @transitionend="onTransitionEnd"
    ></div>
  </div>
</template>

<script setup lang="ts">
  import { ref, watch, nextTick, onBeforeUnmount } from "vue";
  import { sourceMeasure } from "@/utils/scene-lighting/relighting/geometry";
  import type { ImageLayer, ImageVisualFrame } from "@/utils/scene-lighting/relighting/types";

  const props = withDefaults(
    defineProps<{
      src: string;
      duration?: number;
      objectFit?: string;
      position?: string;
      /** Hide only image layers; slot siblings are never GPU source. */
      sourceHidden?: boolean;
    }>(),
    {
      duration: 300,
      objectFit: "contain",
      position: "center bottom",
    }
  );

  const rootRef = ref<HTMLElement | null>(null);
  let currentSource: HTMLImageElement | null = null;
  let nextSource: HTMLImageElement | null = null;
  let requestToken = 0,
    revision = 0;
  let disposed = false,
    scheduled = 0,
    deadline = 0;
  onBeforeUnmount(() => {
    disposed = true;
    requestToken++;
    cancelAnimationFrame(scheduled);
    isFadingIn.value = false;
    listeners.clear();
  });
  const listeners = new Set<(frame: ImageVisualFrame) => void>();
  const emit = defineEmits<{ frame: [frame: ImageVisualFrame]; sourceError: [src: string] }>();
  const topDivRef = ref<HTMLElement | null>(null); // 获取顶层 DOM 的引用
  const currentImageUrl = ref("");
  const nextImageUrl = ref("");
  const isFadingIn = ref(false);

  let currentImageLoadPromise: Promise<void> | null = null;

  function getFrame(): ImageVisualFrame {
    const rect = rootRef.value?.getBoundingClientRect();
    const localSize =
      rootRef.value && typeof DOMMatrixReadOnly !== "undefined"
        ? sourceMeasure(rootRef.value, rootRef.value).sizeCss
        : [rect?.width || 0, rect?.height || 0];
    const [w, h] = localSize;
    const layer = (image: HTMLImageElement, opacity: number): ImageLayer => {
      const nw = image.naturalWidth,
        nh = image.naturalHeight;
      const scale =
        props.objectFit === "cover" ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh);
      const dw = nw * scale,
        dh = nh * scale;
      const x = (w - dw) / 2,
        y = props.position === "center bottom" ? h - dh : (h - dh) / 2;
      return {
        source: {
          kind: "image-straight",
          token: image.src,
          revision: 0,
          resource: image,
          ownership: "borrowed",
          colorEncoding: "srgb-numeric",
          alphaEncoding: "straight",
          naturalSizePx: [nw, nh],
        },
        opacity,
        drawRectCss: [x, y, dw, dh],
        clipRectCss: [0, 0, w, h],
        localToTexel: [
          dw ? nw / dw : 0,
          0,
          0,
          dh ? nh / dh : 0,
          dw ? (-x * nw) / dw : 0,
          dh ? (-y * nh) / dh : 0,
        ],
      };
    };
    const layers: ImageLayer[] = [];
    if (currentSource) layers.push(layer(currentSource, 1));
    if (nextSource)
      layers.push(
        layer(
          nextSource,
          Number(topDivRef.value ? getComputedStyle(topDivRef.value).opacity : 0) || 0
        )
      );
    return { requestToken, revision, layers, transitionActive: isFadingIn.value };
  }
  function publish() {
    if (disposed) return;
    revision++;
    const frame = getFrame();
    emit("frame", frame);
    listeners.forEach((fn) => fn(frame));
  }
  function subscribeFrame(listener: (frame: ImageVisualFrame) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  const updateImage = async (newUrl: string) => {
    if (!newUrl || newUrl === "none") return;
    const token = ++requestToken;

    let resolveLoad!: () => void;
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    currentImageLoadPromise = loadPromise;

    // 1. 完善的图片预加载机制
    const img = new Image();
    const imgReadyPromise = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (err) => reject(err);
    });
    img.src = newUrl;

    try {
      // 必须先等网络请求完全结束
      await imgReadyPromise;
      // 然后再等 CPU 解码完成 (忽略 decode 本身不支持时的报错)
      await img.decode().catch(() => {});
    } catch (err) {
      console.error(`加载图片失败: ${newUrl}`, err);
      if (!disposed && token === requestToken) emit("sourceError", newUrl);
    }

    // 确保只有最后一次触发的加载才会执行 DOM 更新
    if (!disposed && token === requestToken && currentImageLoadPromise === loadPromise) {
      // 如果上一个动画还没完就被打断，先整理状态
      if (isFadingIn.value) {
        currentImageUrl.value = nextImageUrl.value || currentImageUrl.value;
        currentSource = nextSource || currentSource;
        isFadingIn.value = false;
      }

      // 2. 赋值新的背景图
      nextImageUrl.value = newUrl;
      nextSource = img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null;

      // 3. 关键：等待 Vue 将 URL 更新到真实 DOM (style属性中)
      await nextTick();
      if (disposed || token !== requestToken) {
        resolveLoad();
        return;
      }

      // 4. 关键：强制浏览器重排 (Reflow)
      if (topDivRef.value) {
        void topDivRef.value.offsetHeight;
      }

      // 5. 在下一帧安全地开启淡入动画
      scheduled = requestAnimationFrame(() => {
        if (disposed || token !== requestToken) return;
        isFadingIn.value = true;
        if (props.duration <= 0) {
          onTransitionEnd();
          return;
        }
        deadline = performance.now() + Math.max(0, props.duration) + 80;
        sampleFade(token);
      });
    }

    publish();
    resolveLoad();
  };

  function sampleFade(token: number) {
    if (disposed || token !== requestToken || !isFadingIn.value) return;
    publish();
    if (performance.now() >= deadline) {
      onTransitionEnd();
      return;
    }
    scheduled = requestAnimationFrame(() => sampleFade(token));
  }

  const onTransitionEnd = () => {
    if (isFadingIn.value) {
      currentImageUrl.value = nextImageUrl.value;
      cancelAnimationFrame(scheduled);
      currentSource = nextSource;
      nextSource = null;
      isFadingIn.value = false;
      publish();
    }
  };

  const waitForLoad = () => currentImageLoadPromise || Promise.resolve();

  defineExpose({
    waitForLoad,
    getFrame,
    subscribeFrame,
  });

  watch(
    () => props.src,
    (newUrl) => {
      updateImage(newUrl);
    },
    { immediate: true }
  );
</script>
