import {
  nativeSnapshot,
  validateNativeSnapshot,
  validateBuildRecord,
  monitorForeground,
} from "./native.mjs";
import { connectCdp } from "./cdp.mjs";
import { samplePage } from "./sampler.mjs";
import { REQUIRED_METADATA } from "./metrics.mjs";
const fetchJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`CDP discovery HTTP ${response.status}`);
  return response.json();
};
function socketUrl(value, endpoint) {
  const url = new URL(value);
  if (
    url.protocol !== "ws:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== endpoint.port ||
    url.username ||
    url.password
  )
    throw new Error("CDP WebSocket must share verified native loopback listener");
  return url.href;
}
const productionEnvironment = () => ({
  visible: document.visibilityState === "visible",
  focused: document.hasFocus(),
  tauri: !!window.__TAURI_INTERNALS__,
  hmr: !!document.querySelector('script[src*="/@vite/client"], vite-plugin-vue-devtools'),
  width: innerWidth,
  height: innerHeight,
  dpr: devicePixelRatio,
  href: location.href,
  userAgent: navigator.userAgent,
});

export async function captureProduction(
  options,
  adapters = { nativeSnapshot, connectCdp, fetchJson, monitorForeground }
) {
  const { endpoint, hostPid, targetId, metadata, buildRecord } = options;
  validateBuildRecord(buildRecord, options.head, options.executableSha256);
  if (
    metadata.commit !== options.head ||
    !["full", "simplified"].includes(metadata.mode) ||
    !["normal", "eight_png"].includes(metadata.scene) ||
    metadata.devtoolsClosed !== true ||
    REQUIRED_METADATA.some(
      (key) =>
        typeof metadata[key] !== "string" ||
        !metadata[key].trim() ||
        /^(unknown|pending|tbd|n\/a)$/i.test(metadata[key].trim())
    )
  )
    throw new Error(
      "Complete explicit machine/scene/mode metadata and matching commit are required"
    );
  const before = await adapters.nativeSnapshot(Number(endpoint.port));
  validateNativeSnapshot(before, hostPid, buildRecord.executablePath);
  if (before.power !== metadata.power) throw new Error("Recorded power differs from native scheme");
  if (before.webview2 !== metadata.webview2)
    throw new Error("Recorded WebView2 version differs from native runtime");
  const targets = await adapters.fetchJson(endpoint.origin + "/json/list");
  const target = targets.find((entry) => entry.id === targetId && entry.type === "page");
  if (!target || !/^https?:\/\/tauri\.localhost(?:[/:]|$)|^tauri:\/\//.test(target.url))
    throw new Error(
      "Explicit target must be the existing production Tauri page, not localhost demo/dev/browser"
    );
  const client = await adapters.connectCdp(socketUrl(target.webSocketDebuggerUrl, endpoint));
  const abort = new AbortController();
  let browser;
  try {
    await client.call("Runtime.enable");
    await client.call("Page.enable");
    const initial = await client.call("Runtime.evaluate", {
      expression: `(${productionEnvironment.toString()})()`,
      returnByValue: true,
    });
    const env = initial.result?.value;
    if (
      initial.exceptionDetails ||
      !env?.visible ||
      !env.focused ||
      !env.tauri ||
      env.hmr ||
      Math.round(env.width * env.dpr) !== 1920 ||
      Math.round(env.height * env.dpr) !== 1080
    )
      throw new Error(
        "Page must already be foreground 1920x1080 physical production Tauri with HMR/devtools panel closed; no automatic resize/focus"
      );
    if (
      !Number.isFinite(Number(metadata.dpi)) ||
      Math.abs(Number(metadata.dpi) - 96 * env.dpr) > 0.1
    )
      throw new Error("Recorded DPI differs from production devicePixelRatio");
    let gpuInfo = null;
    let gpuInfoError = null;
    try {
      const version = await adapters.fetchJson(endpoint.origin + "/json/version");
      browser = await adapters.connectCdp(socketUrl(version.webSocketDebuggerUrl, endpoint));
      gpuInfo = await browser.call("SystemInfo.getInfo");
    } catch (error) {
      gpuInfoError = error.message;
    }
    const gpuText = gpuInfo?.gpu?.auxAttributes?.glRenderer ?? "";
    const gpuHardwareVerified =
      !!gpuInfo?.gpu?.devices?.length &&
      /^enabled/.test(gpuInfo.gpu.featureStatus?.gpu_compositing ?? "") &&
      /ANGLE|D3D|NVIDIA|Intel|AMD/i.test(gpuText) &&
      !/swiftshader|llvmpipe|software|virtual|parsec|\bwarp\b|basic render driver/i.test(gpuText);
    const monitor = adapters.monitorForeground(hostPid, abort.signal);
    await monitor.ready;
    client.events.length = 0;
    const response = await client.call(
      "Runtime.evaluate",
      { expression: `(${samplePage.toString()})()`, awaitPromise: true, returnByValue: true },
      100000
    );
    if (response.exceptionDetails || !response.result?.value)
      throw new Error("In-page sampling failed or page navigated; no fabricated sample");
    const sample = response.result.value;
    const foreground = await monitor.result;
    const after = await adapters.nativeSnapshot(Number(endpoint.port));
    validateNativeSnapshot(after, hostPid, buildRecord.executablePath);
    const invalidations = client.events.filter((event) =>
      ["Page.frameNavigated", "Runtime.executionContextsCleared", "Inspector.detached"].includes(
        event.method
      )
    );
    sample.events.push(
      ...invalidations.map((event) => ({ type: "cdp-page-invalidated", evidence: event }))
    );
    return {
      schemaVersion: 1,
      kind: "fresh-capture",
      capturedAt: new Date().toISOString(),
      metadata,
      sample,
      proof: {
        nativeWebView: true,
        hostPid,
        listenerPid: before.chain[0].ProcessId,
        executablePath: buildRecord.executablePath,
        executableSha256: options.executableSha256,
        buildRecord,
        nativeBefore: before,
        nativeAfter: after,
        target: { id: target.id, url: target.url },
        gpuInfo,
        gpuInfoError,
        gpuHardwareVerified,
        foregroundEvents: foreground.events,
        foregroundMonitor: foreground,
        powerUnchanged: before.power === after.power,
      },
    };
  } finally {
    abort.abort();
    client.close();
    browser?.close();
  }
}
