import { Container, Rectangle, Sprite, Texture, WebGLRenderer } from "pixi.js";
import { createRelightingFilter, type RelightingFilter } from "./filter";
import type {
  AdapterState,
  ImageBinding,
  ImageVisualFrame,
  PixiCharacterHost,
  RasterFrame,
  RelightingBinding,
  SurfaceRoute,
} from "./types";

class SourceImageRenderer extends WebGLRenderer {
  constructor() {
    super();
    // Exclude optional interaction only on this owned, source-only instance. The global
    // EventTicker singleton must not reset/keep alive a borrowed model renderer's ticker.
    this.config = {
      ...this.config,
      systems: this.config.systems.filter((system) => system.name !== "events"),
    };
  }
}

export function probeRelightingCapability(renderer: WebGLRenderer): string | null {
  const gl = renderer.gl;
  if (!gl || renderer.context.webGLVersion !== 2 || gl.isContextLost()) return "webgl-unavailable";
  const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  if (!precision || precision.precision < 23) return "precision-unavailable";
  if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 3) return "webgl-unavailable";
  return null;
}
export function imageFrameReason(
  frame: ImageVisualFrame,
  maxTextureSize = Infinity
): string | null {
  if (
    !Number.isSafeInteger(frame.requestToken) ||
    frame.requestToken < 0 ||
    !Number.isSafeInteger(frame.revision) ||
    frame.revision < 0 ||
    frame.layers.length > 2
  )
    return "source-unavailable";
  for (let i = 0; i < frame.layers.length; i++) {
    const layer = frame.layers[i],
      s = layer.source,
      [a, b, c, d] = layer.localToTexel;
    if (
      s.kind !== "image-straight" ||
      s.ownership !== "borrowed" ||
      s.alphaEncoding !== "straight" ||
      s.colorEncoding !== "srgb-numeric"
    )
      return "source-unavailable";
    if (!s.resource.complete || s.resource.naturalWidth <= 0 || s.resource.naturalHeight <= 0)
      return "loading";
    if (
      s.naturalSizePx[0] !== s.resource.naturalWidth ||
      s.naturalSizePx[1] !== s.resource.naturalHeight
    )
      return "source-unavailable";
    if (s.naturalSizePx.some((v) => v > maxTextureSize)) return "resource-limit";
    if (
      !Number.isSafeInteger(s.revision) ||
      s.revision < 0 ||
      typeof s.token !== "string" ||
      ![layer.opacity, ...layer.drawRectCss, ...layer.clipRectCss, ...layer.localToTexel].every(
        Number.isFinite
      ) ||
      layer.opacity < 0 ||
      layer.opacity > 1 ||
      (i === 0 && layer.opacity !== 1) ||
      layer.drawRectCss[2] <= 0 ||
      layer.drawRectCss[3] <= 0 ||
      layer.clipRectCss[2] < 0 ||
      layer.clipRectCss[3] < 0 ||
      a * d - b * c === 0 ||
      b !== 0 ||
      c !== 0
    )
      return "source-unavailable";
  }
  return null;
}
function rasterFor(width: number, height: number, resolution: number): RasterFrame {
  return {
    originLocalCss: [0, 0],
    extentLocalCss: [width, height],
    actualResolution: resolution,
    inputFramePx: [0, 0, width * resolution, height * resolution],
    outputViewportPx: [0, 0, width * resolution, height * resolution],
    rootOutput: true,
  };
}
function failureReason(error: unknown): string {
  return error instanceof DOMException && error.name === "SecurityError"
    ? "cors-tainted"
    : String(error).includes("source-unavailable")
      ? "source-unavailable"
      : "shader-failed";
}

/** Lazy owned renderer; no ticker, decode, loader, source mutation, or GPU easing clock. */
export async function createDomImageBinding(
  canvas: HTMLCanvasElement,
  onState: (state: AdapterState) => void
): Promise<ImageBinding> {
  let state: AdapterState = { kind: "identity", reason: "loading" },
    route: SurfaceRoute = { kind: "identity", legacyAllowed: false, reason: "loading" };
  let frame: ImageVisualFrame = {
    requestToken: 0,
    revision: 0,
    layers: [],
    transitionActive: false,
  };
  let generation = 0,
    disposed = false,
    initializing = false,
    lost = false;
  let renderer: WebGLRenderer | null = null,
    stage: Container | null = null,
    filter: RelightingFilter | null = null;
  let dormant: {
    gl: WebGLRenderingContext | WebGL2RenderingContext;
    extension: WEBGL_lose_context | null;
    loss: Promise<void>;
  } | null = null;
  const pendingWaits = new Set<() => void>();
  const retire = (owned: WebGLRenderer) => {
    const gl = owned.gl,
      extension = owned.context.extensions.loseContext ?? gl.getExtension("WEBGL_lose_context");
    if (disposed) {
      owned.destroy();
      return;
    }
    const loss = gl.isContextLost()
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const finish = (event?: Event) => {
            event?.preventDefault();
            clearTimeout(timer);
            canvas.removeEventListener("webglcontextlost", finish);
            pendingWaits.delete(finish);
            resolve();
          };
          const timer = setTimeout(finish, 1000);
          pendingWaits.add(finish);
          canvas.addEventListener("webglcontextlost", finish, { once: true });
        });
    dormant = { gl, extension, loss };
    owned.destroy();
  };
  const emit = (value: AdapterState) => {
    if (disposed) return;
    state = value;
    canvas.style.visibility = value.kind === "active" ? "visible" : "hidden";
    onState(value);
  };
  canvas.style.visibility = "hidden";
  const release = () => {
    filter?.destroy();
    filter = null;
    stage?.destroy({ children: true });
    stage = null;
    if (renderer) {
      retire(renderer);
      renderer = null;
    }
  };
  const draw = () => {
    if (disposed || lost || !renderer || route.kind !== "webgl") return;
    try {
      const reason =
        probeRelightingCapability(renderer) ??
        imageFrameReason(frame, renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE));
      if (reason) {
        release();
        emit({ kind: "unavailable", reason });
        return;
      }
      const [width, height] = route.spec.sourceSizeCss;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
        throw new Error("source-unavailable: zero geometry");
      renderer.resize(width, height);
      if (!stage) {
        stage = new Container();
        const carrier = new Sprite(Texture.WHITE);
        carrier.width = width;
        carrier.height = height;
        stage.addChild(carrier);
      } else {
        const carrier = stage.children[0] as Sprite;
        carrier.width = width;
        carrier.height = height;
      }
      stage.filterArea = new Rectangle(0, 0, width, height);
      if (!filter)
        filter = createRelightingFilter(
          route.spec,
          { kind: "image-stack", frame },
          rasterFor(width, height, renderer.resolution)
        );
      else {
        filter.setSpec(route.spec);
        filter.setFrame(frame);
      }
      stage.filters = [filter];
      renderer.render({ container: stage });
      if (renderer.gl.getError() !== renderer.gl.NO_ERROR) throw new Error("shader-failed");
      emit({ kind: "active", sourceRevision: frame.revision });
    } catch (error) {
      release();
      emit({ kind: "unavailable", reason: failureReason(error) });
    }
  };
  const restoreDormant = async (
    previous: NonNullable<typeof dormant>,
    epoch: number,
    token: number
  ) => {
    await previous.loss;
    // WEBGL_lose_context restore must run after the loss event's task finishes, not its Promise microtask.
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        pendingWaits.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, 0);
      pendingWaits.add(finish);
    });
    if (
      disposed ||
      epoch !== generation ||
      token !== frame.requestToken ||
      route.kind !== "webgl"
    ) {
      if (!disposed) dormant = previous;
      return;
    }
    if (!previous.gl.isContextLost()) return;
    await new Promise<void>((resolve, reject) => {
      const restored = () => {
        cleanup();
        resolve();
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("webgl-unavailable: restore timeout"));
      }, 3000);
      const cancel = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        canvas.removeEventListener("webglcontextrestored", restored);
        pendingWaits.delete(cancel);
      };
      pendingWaits.add(cancel);
      canvas.addEventListener("webglcontextrestored", restored, { once: true });
      if (!previous.extension) {
        cleanup();
        reject(new Error("webgl-unavailable"));
        return;
      }
      previous.extension.restoreContext();
    });
  };
  const start = async () => {
    if (disposed || initializing || route.kind !== "webgl" || lost) return;
    if (renderer) {
      draw();
      return;
    }
    const reason = imageFrameReason(frame);
    if (reason) {
      emit({ kind: "unavailable", reason });
      return;
    }
    initializing = true;
    const epoch = generation,
      token = frame.requestToken;
    let owned: WebGLRenderer | null = null;
    try {
      if (dormant) {
        const gl = dormant;
        dormant = null;
        await restoreDormant(gl, epoch, token);
        if (
          disposed ||
          epoch !== generation ||
          token !== frame.requestToken ||
          route.kind !== "webgl"
        )
          return;
      }
      owned = new SourceImageRenderer();
      const [width, height] = route.spec.sourceSizeCss;
      await owned.init({
        canvas,
        width,
        height,
        resolution: canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
        antialias: false,
        backgroundAlpha: 0,
        preserveDrawingBuffer: false,
        premultipliedAlpha: true,
        preferWebGLVersion: 2,
      });
      // This on-demand image renderer owns a bounded frame/texture set and disposes it explicitly.
      // Pixi SchedulerSystem otherwise keeps Ticker.system spinning even without any render calls.
      // Remove only this renderer's listener; never stop a borrowed model/shared ticker.
      owned.scheduler.destroy();
      if (
        disposed ||
        epoch !== generation ||
        token !== frame.requestToken ||
        route.kind !== "webgl"
      ) {
        retire(owned);
        owned = null;
        return;
      }
      renderer = owned;
      owned = null;
      draw();
    } catch (error) {
      if (owned) {
        try {
          retire(owned);
        } catch {
          /* Partial init has no complete renderer system graph. */
        }
      }
      if (!disposed && epoch === generation)
        emit({
          kind: "unavailable",
          reason: String(error).includes("webgl-unavailable")
            ? "webgl-unavailable"
            : failureReason(error),
        });
    } finally {
      initializing = false;
      if (!disposed && route.kind === "webgl" && !renderer && epoch !== generation) void start();
    }
  };
  const contextLost = (event: Event) => {
    if (disposed || !renderer || route.kind !== "webgl") return;
    event.preventDefault();
    lost = true;
    generation++;
    // Release stale owned handles while GL is lost (commands are ignored), never after restoration.
    release();
    emit({ kind: "unavailable", reason: "context-lost" });
  };
  const contextRestored = () => {
    if (disposed || !lost || !dormant) return;
    queueMicrotask(() => {
      if (disposed || !dormant || dormant.gl.isContextLost()) return;
      lost = false;
      if (route.kind === "webgl") void start();
    });
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  return {
    update(next) {
      if (disposed) return;
      route = next;
      if (next.kind !== "webgl") {
        generation++;
        lost = false;
        release();
        emit({ kind: "identity", reason: next.kind === "identity" ? next.reason : "legacy" });
      } else void start();
    },
    setFrame(next) {
      if (
        disposed ||
        next.requestToken < frame.requestToken ||
        (next.requestToken === frame.requestToken && next.revision < frame.revision)
      )
        return;
      if (next.requestToken !== frame.requestToken) generation++;
      frame = next;
      if (route.kind === "webgl") void start();
    },
    getState: () => state,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      for (const cancel of [...pendingWaits]) cancel();
      pendingWaits.clear();
      dormant = null;
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      release();
      state = { kind: "disposed" };
      canvas.style.visibility = "hidden";
    },
  };
}

/** Filters only the borrowed model stage; no canvas upload, Assets, SDK or ticker ownership. */
export function bindPixiCharacterSurface(
  host: PixiCharacterHost,
  onState: (state: AdapterState) => void
): RelightingBinding {
  let state: AdapterState = { kind: "identity", reason: "loading" },
    disposed = false,
    generation = 0;
  let route: SurfaceRoute = { kind: "identity", legacyAllowed: false, reason: "loading" };
  let filter: RelightingFilter | null = null,
    ownedArea: Rectangle | null = null;
  const priorArea = host.stage.filterArea;
  const canvas = host.renderer.canvas;
  const detach = () => {
    if (filter) {
      host.stage.filters = (host.stage.filters ?? []).filter((f) => f !== filter);
      filter.destroy();
      filter = null;
    }
    if (ownedArea && host.stage.filterArea === ownedArea) host.stage.filterArea = priorArea;
    ownedArea = null;
  };
  const emit = (value: AdapterState) => {
    if (disposed) return;
    state = value;
    onState(value);
  };
  const draw = () => {
    if (disposed || route.kind !== "webgl") return;
    try {
      const reason = probeRelightingCapability(host.renderer);
      if (reason) {
        detach();
        emit({ kind: "unavailable", reason });
        return;
      }
      const { a, b, c, d, tx, ty } = host.stage.worldTransform;
      if (b !== 0 || c !== 0 || ![a, d, tx, ty].every(Number.isFinite) || a === 0 || d === 0) {
        detach();
        emit({ kind: "unavailable", reason: "unsupported-transform" });
        return;
      }
      const { x, y, width, height } = host.screen;
      ownedArea = new Rectangle(
        Math.min((x - tx) / a, (x + width - tx) / a),
        Math.min((y - ty) / d, (y + height - ty) / d),
        width / Math.abs(a),
        height / Math.abs(d)
      );
      host.stage.filterArea = ownedArea;
      if (!filter)
        filter = createRelightingFilter(
          route.spec,
          { kind: "pixi-stage-pma" },
          rasterFor(width, height, host.renderer.resolution)
        );
      else filter.setSpec(route.spec);
      if (!(host.stage.filters ?? []).includes(filter))
        host.stage.filters = [...(host.stage.filters ?? []), filter];
      host.renderer.render({ container: host.stage });
      if (host.renderer.gl.getError() !== host.renderer.gl.NO_ERROR)
        throw new Error("shader-failed");
      emit({ kind: "active", sourceRevision: generation });
    } catch (error) {
      detach();
      emit({ kind: "unavailable", reason: failureReason(error) });
    }
  };
  const lost = () => {
    generation++;
    detach();
    emit({ kind: "unavailable", reason: "context-lost" });
  };
  const restored = () => {
    const epoch = generation;
    queueMicrotask(() => {
      if (!disposed && epoch === generation) draw();
    });
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  return {
    update(next) {
      if (disposed) return;
      generation++;
      route = next;
      if (next.kind !== "webgl") {
        detach();
        emit({ kind: "identity", reason: next.kind === "identity" ? next.reason : "legacy" });
      } else draw();
    },
    getState: () => state,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      detach();
      state = { kind: "disposed" };
    },
  };
}
