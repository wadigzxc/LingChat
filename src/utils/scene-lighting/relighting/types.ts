import type { RelightingParams } from "@/types/scene-lighting";
import type { Container, Rectangle, WebGLRenderer } from "pixi.js";

export type SurfaceKind = "character" | "background";
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Mat2D = readonly [number, number, number, number, number, number];
export type Rect = readonly [number, number, number, number];
export type LightingRoute =
  | { kind: "identity"; legacyAllowed: false; reason: string }
  | { kind: "legacy"; legacyAllowed: true }
  | { kind: "relighting"; legacyAllowed: false; master: number; params: RelightingParams };
export interface SceneGeometry {
  sizeCss: Vec2;
}
export interface SurfaceGeometry {
  sizeCss: Vec2;
  localToScene: Mat2D;
  reason?: string;
}
export interface ShaderSpec {
  sourceSizeCss: Vec2;
  localToScene: Mat2D;
  lightSceneCss: Vec2;
  radiusSceneCss: number;
  softness: number;
  baseSignedLinear: Vec3;
  pointLinear: Vec3;
}
export type SurfaceRoute =
  | { kind: "identity"; legacyAllowed: false; reason: string }
  | { kind: "legacy"; legacyAllowed: true }
  | { kind: "webgl"; legacyAllowed: false; spec: ShaderSpec };
export interface PixiCharacterHost {
  renderer: WebGLRenderer;
  stage: Container;
  screen: Rectangle;
}
export type SourceDescriptor =
  | {
      kind: "image-straight";
      token: string;
      revision: number;
      resource: HTMLImageElement;
      ownership: "borrowed";
      colorEncoding: "srgb-numeric";
      alphaEncoding: "straight";
      naturalSizePx: Vec2;
    }
  | {
      kind: "pixi-stage-pma";
      token: string;
      revision: number;
      host: PixiCharacterHost;
      ownership: "borrowed";
      colorEncoding: "srgb-numeric";
      alphaEncoding: "pma";
      baseline: "unlit-composited-stage";
    };
/** Canvas is deliberately not a production source adapter. */
export interface ImageLayer {
  source: Extract<SourceDescriptor, { kind: "image-straight" }>;
  opacity: number;
  drawRectCss: Rect;
  clipRectCss: Rect;
  localToTexel: Mat2D;
}
export interface ImageVisualFrame {
  requestToken: number;
  revision: number;
  layers: readonly ImageLayer[];
  transitionActive: boolean;
}
export interface ImageVisualController {
  waitForLoad(): Promise<void>;
  getFrame(): ImageVisualFrame;
  subscribeFrame(listener: (frame: ImageVisualFrame) => void): () => void;
}
export interface RasterFrame {
  originLocalCss: Vec2;
  extentLocalCss: Vec2;
  actualResolution: number;
  inputFramePx: Rect;
  outputViewportPx: Rect;
  rootOutput: boolean;
}
export type AdapterState =
  | { kind: "identity"; reason: string }
  | { kind: "active"; sourceRevision: number }
  | { kind: "unavailable"; reason: string }
  | { kind: "disposed" };
export interface RelightingBinding {
  update(route: SurfaceRoute): void;
  getState(): AdapterState;
  dispose(): void;
}
export interface ImageBinding extends RelightingBinding {
  setFrame(frame: ImageVisualFrame): void;
}
