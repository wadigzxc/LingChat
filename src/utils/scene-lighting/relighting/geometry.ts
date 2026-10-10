import type { Mat2D, SceneGeometry, SurfaceGeometry, Vec2 } from "./types";
export const identityMatrix: Mat2D = [1, 0, 0, 1, 0, 0];
export function transformPoint(m: Mat2D, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}
export function geometryReason(
  source: SurfaceGeometry | null,
  scene: SceneGeometry
): string | null {
  if (!source) return "source-unavailable";
  if (source.reason) return source.reason;
  if (![...source.sizeCss, ...scene.sizeCss, ...source.localToScene].every(Number.isFinite))
    return "zero-geometry";
  if ([...source.sizeCss, ...scene.sizeCss].some((v) => v <= 0)) return "zero-geometry";
  const [a, b, c, d] = source.localToScene;
  if (a * d - b * c === 0) return "singular-transform";
  if (b !== 0 || c !== 0) return "unsupported-transform";
  return null;
}
function axisChain(element: HTMLElement): { x: number; y: number; reason?: string } {
  let x = 1,
    y = 1;
  for (let el: HTMLElement | null = element; el; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (s.translate && s.translate !== "none" && s.translate.trim().split(/\s+/).length > 2)
      return { x, y, reason: "unsupported-transform" };
    if (
      (s.perspective && s.perspective !== "none") ||
      (s.rotate && s.rotate !== "none" && s.rotate !== "0deg")
    )
      return { x, y, reason: "unsupported-transform" };
    if (s.transform !== "none" && s.transform) {
      const m = new DOMMatrixReadOnly(s.transform);
      if (!m.is2D || m.b !== 0 || m.c !== 0) return { x, y, reason: "unsupported-transform" };
      x *= m.a;
      y *= m.d;
    }
    if (s.scale && s.scale !== "none") {
      const values = s.scale.split(/\s+/).map(Number);
      if (values.length > 2 || !values.every(Number.isFinite))
        return { x, y, reason: "unsupported-transform" };
      x *= values[0];
      y *= values[1] ?? values[0];
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0)
    return { x, y, reason: "singular-transform" };
  return { x, y };
}
function localSize(el: HTMLElement, scale: { x: number; y: number }): Vec2 {
  const r = el.getBoundingClientRect();
  return [r.width / Math.abs(scale.x), r.height / Math.abs(scale.y)];
}
/** Inspect every transform before using axis-aligned DOMRect; never inverse an arbitrary AABB. */
export function sceneProvider(root: HTMLElement): SceneGeometry & { reason?: string } {
  const scale = axisChain(root);
  return {
    sizeCss: scale.reason ? [0, 0] : localSize(root, scale),
    ...(scale.reason ? { reason: scale.reason } : {}),
  };
}
export function sourceMeasure(source: HTMLElement, root: HTMLElement): SurfaceGeometry {
  const s = axisChain(source),
    r = axisChain(root),
    reason = s.reason ?? r.reason;
  if (reason) return { sizeCss: [0, 0], localToScene: identityMatrix, reason };
  const sr = source.getBoundingClientRect(),
    rr = root.getBoundingClientRect();
  const sx = s.x < 0 ? sr.right : sr.left,
    sy = s.y < 0 ? sr.bottom : sr.top;
  const rx = r.x < 0 ? rr.right : rr.left,
    ry = r.y < 0 ? rr.bottom : rr.top;
  return {
    sizeCss: localSize(source, s),
    localToScene: [s.x / r.x, 0, 0, s.y / r.y, (sx - rx) / r.x, (sy - ry) / r.y],
  };
}
/** Hosts choose when to measure; observations are finite and never own an idle animation clock. */
export function observeGeometry(
  source: HTMLElement,
  root: HTMLElement,
  listener: () => void
): () => void {
  const observer = new ResizeObserver(listener);
  observer.observe(source);
  if (source !== root) observer.observe(root);
  window.addEventListener("scroll", listener, true);
  window.addEventListener("resize", listener);
  return () => {
    observer.disconnect();
    window.removeEventListener("scroll", listener, true);
    window.removeEventListener("resize", listener);
  };
}
