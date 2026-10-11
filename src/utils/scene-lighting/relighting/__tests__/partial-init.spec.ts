import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DOMAdapter, Ticker, WebGLRenderer } from "pixi.js";
import { createDomImageBinding } from "../bindings";
import type { ImageBinding, ImageVisualFrame, SurfaceRoute } from "../types";

const route: SurfaceRoute = {
  kind: "webgl",
  legacyAllowed: false,
  spec: {
    sourceSizeCss: [8, 8],
    localToScene: [1, 0, 0, 1, 0, 0],
    lightSceneCss: [4, 4],
    radiusSceneCss: 4,
    softness: 0,
    baseSignedLinear: [1, 1, 1],
    pointLinear: [0, 0, 0],
  },
};
const frame: ImageVisualFrame = {
  requestToken: 1,
  revision: 1,
  transitionActive: false,
  layers: [
    {
      source: {
        kind: "image-straight",
        ownership: "borrowed",
        alphaEncoding: "straight",
        colorEncoding: "srgb-numeric",
        token: "partial-init",
        revision: 0,
        naturalSizePx: [8, 8],
        resource: { complete: true, naturalWidth: 8, naturalHeight: 8 } as HTMLImageElement,
      },
      opacity: 1,
      drawRectCss: [0, 0, 8, 8],
      clipRectCss: [0, 0, 8, 8],
      localToTexel: [1, 0, 0, 1, 0, 0],
    },
  ],
};
let owned: WebGLRenderer[];
let bindings: ImageBinding[];
let failures: unknown[];
const realInit = WebGLRenderer.prototype.init;
const adapter = DOMAdapter.get();
const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
async function start() {
  const canvas = document.createElement("canvas");
  const binding = await createDomImageBinding(canvas, () => {});
  bindings.push(binding);
  binding.setFrame(frame);
  binding.update(route);
  return { binding, canvas };
}
beforeEach(() => {
  owned = [];
  bindings = [];
  failures = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(WebGLRenderer.prototype, "init").mockImplementation(async function (
    this: WebGLRenderer,
    options
  ) {
    owned.push(this);
    try {
      return await realInit.call(this, options);
    } catch (error) {
      failures.push(error);
      throw error;
    }
  });
});
afterEach(() => {
  for (const binding of bindings) binding.dispose();
  // Test-owned emergency cleanup also runs on RED; never stop/destroy shared tickers.
  for (const renderer of owned) renderer.scheduler?.destroy();
  DOMAdapter.set(adapter);
});

it("releases a context acquired by real Pixi before contextChange init fails", async () => {
  const loseContext = vi.fn();
  const useProgram = vi.fn();
  const gl = {
    getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null),
    getContextAttributes: () => ({ stencil: true }),
    getParameter: () => {
      throw new Error("GL parameter unavailable during init");
    },
    useProgram,
  };
  DOMAdapter.set({
    ...adapter,
    getWebGLRenderingContext: () => class {} as unknown as typeof WebGLRenderingContext,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    gl as unknown as ReturnType<HTMLCanvasElement["getContext"]>
  );
  const baseline = Ticker.system.count;
  const { binding } = await start();
  await settle();
  expect(failures.map(String)).toEqual(["Error: GL parameter unavailable during init"]);
  expect(owned[0].gl).toBe(gl);

  expect(useProgram).toHaveBeenCalledWith(null);
  expect(loseContext).toHaveBeenCalledOnce();
  expect(binding.getState().kind).toBe("unavailable");
  expect(Ticker.system.count).toBe(baseline);
  binding.dispose();
  expect(loseContext).toHaveBeenCalledOnce();
});

it("cleans a late real null-context rejection after disposal without late state events", async () => {
  let rejectLate!: () => void;
  const gate = new Promise<void>((resolve) => {
    rejectLate = resolve;
  });
  let reachedFailure = false;
  vi.spyOn(WebGLRenderer.prototype, "init").mockImplementation(async function (
    this: WebGLRenderer,
    options
  ) {
    owned.push(this);
    try {
      return await realInit.call(this, options);
    } catch (error) {
      failures.push(error);
      reachedFailure = true;
      await gate;
      throw error;
    }
  });
  const baseline = Ticker.system.count;
  const canvas = document.createElement("canvas"),
    onState = vi.fn();
  const binding = await createDomImageBinding(canvas, onState);
  bindings.push(binding);
  binding.setFrame(frame);
  binding.update(route);
  await settle();
  expect(reachedFailure).toBe(true);
  expect(Ticker.system.count).toBe(baseline + 1);
  binding.dispose();
  const emitted = onState.mock.calls.length;
  rejectLate();
  await settle();
  expect(Ticker.system.count).toBe(baseline);
  expect(binding.getState()).toEqual({ kind: "disposed" });
  expect(onState).toHaveBeenCalledTimes(emitted);
  expect(canvas.style.visibility).toBe("hidden");
});

it("preserves borrowed system and model ticker listeners on failure", async () => {
  const borrowed = vi.fn(),
    model = new Ticker();
  model.add(borrowed);
  Ticker.system.add(borrowed);
  const baseline = Ticker.system.count;
  try {
    const { binding } = await start();
    await settle();
    binding.dispose();
    expect(Ticker.system.count).toBe(baseline);
    expect(model.count).toBe(1);
    model.update(performance.now() + 20);
    expect(borrowed).toHaveBeenCalled();
  } finally {
    Ticker.system.remove(borrowed);
    model.destroy();
  }
});

it("continues partial-system cleanup after a destroy throws and clears the real Pixi runners", async () => {
  const tailCleanup = vi.fn();
  const throwingCleanup = vi.fn(() => {
    throw new Error("partial destroy failed");
  });
  vi.spyOn(WebGLRenderer.prototype, "init").mockImplementation(async function (
    this: WebGLRenderer,
    options
  ) {
    owned.push(this);
    try {
      return await realInit.call(this, options);
    } catch (error) {
      failures.push(error);
      // In reverse destruction order a throwing partially initialized system precedes
      // this tail resource. The actual Pixi system graph is still created/init'd normally.
      this.runners.destroy.items.unshift({ destroy: tailCleanup }, { destroy: throwingCleanup });
      throw error;
    }
  });
  const baseline = Ticker.system.count;
  await start();
  await settle();
  expect(failures.map(String)[0]).toContain("This browser does not support WebGL");
  expect(throwingCleanup).toHaveBeenCalledOnce();
  expect(tailCleanup).toHaveBeenCalledOnce();
  expect(Object.values(owned[0].runners).every((runner) => runner.items === null)).toBe(true);
  expect(Ticker.system.count).toBe(baseline);
});

it("returns real Pixi null-context init failures and repeated retries to the listener baseline", async () => {
  const baseline = Ticker.system.count;
  const { binding } = await start();
  await settle();
  expect(failures.map(String)).toEqual([
    "Error: This browser does not support WebGL. Try using the canvas renderer",
  ]);
  expect(owned[0].scheduler).toBeDefined();
  expect(owned[0].gl).toBeUndefined();
  expect(binding.getState().kind).toBe("unavailable");
  expect(Ticker.system.count).toBe(baseline);
  binding.update(route);
  await settle();
  expect(failures).toHaveLength(2);
  expect(Ticker.system.count).toBe(baseline);
  binding.dispose();
  binding.dispose();
  expect(Ticker.system.count).toBe(baseline);
});
