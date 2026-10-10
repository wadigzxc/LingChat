import { expect, it } from "vitest";
import { createRelightingFilter } from "../filter";
import type { ImageVisualFrame, ShaderSpec, RasterFrame } from "../types";
const spec: ShaderSpec = {
  sourceSizeCss: [8, 8],
  localToScene: [1, 0, 0, 1, 0, 0],
  lightSceneCss: [4, 4],
  radiusSceneCss: 4,
  softness: 0,
  baseSignedLinear: [1, 1, 1],
  pointLinear: [0, 0, 0],
};
const raster: RasterFrame = {
  originLocalCss: [0, 0],
  extentLocalCss: [8, 8],
  actualResolution: 1,
  inputFramePx: [0, 0, 8, 8],
  outputViewportPx: [0, 0, 8, 8],
  rootOutput: true,
};
function frame(token: number, revision = 1): ImageVisualFrame {
  return {
    requestToken: token,
    revision,
    transitionActive: false,
    layers: [
      {
        source: {
          kind: "image-straight",
          resource: new Image(8, 8),
          token: String(token),
          revision: 1,
          ownership: "borrowed",
          colorEncoding: "srgb-numeric",
          alphaEncoding: "straight",
          naturalSizePx: [8, 8],
        },
        opacity: 1,
        drawRectCss: [0, 0, 8, 8],
        clipRectCss: [0, 0, 8, 8],
        localToTexel: [1, 0, 0, 1, 0, 0],
      },
    ],
  };
}
it("rejects late old request frames instead of resurrecting borrowed textures", () => {
  const a = frame(1),
    b = frame(2),
    f = createRelightingFilter(spec, { kind: "image-stack", frame: a }, raster);
  f.setFrame(b);
  const current = f.resources.uImage0;
  f.setFrame(a);
  expect(f.resources.uImage0).toBe(current);
  f.destroy();
});
it("never destroys a GlProgram shared by another live surface", () => {
  const a = createRelightingFilter(spec, { kind: "image-stack", frame: frame(1) }, raster),
    b = createRelightingFilter(spec, { kind: "image-stack", frame: frame(2) }, raster);
  expect(a.glProgram).toBe(b.glProgram);
  a.destroy(true);
  expect(b.glProgram?.fragment).toBeTypeOf("string");
  expect(b.glProgram?.vertex).toBeTypeOf("string");
  b.destroy();
});
it("lamp updates retain source identity and borrowed image properties", () => {
  const a = frame(1),
    image = a.layers[0].source.resource,
    f = createRelightingFilter(spec, { kind: "image-stack", frame: a }, raster);
  const current = f.resources.uImage0;
  f.setSpec({ ...spec, pointLinear: [1, 2, 3] });
  f.setFrame(a);
  expect(f.resources.uImage0).toBe(current);
  f.destroy();
  f.destroy();
  expect(image.width).toBe(8);
  expect(image.src).toBe("");
  expect(image.crossOrigin).toBeNull();
});
