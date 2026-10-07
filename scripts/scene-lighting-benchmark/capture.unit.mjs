// Fake adapters test capture orchestration only. No real performance evidence is produced.
import test from "node:test";
import assert from "node:assert/strict";
import * as capture from "./capture.mjs";

test("production capture verifies native ownership/build then observes the existing page without switching modes", async () => {
  const calls = [];
  let gpuRenderer = "UNIT ANGLE D3D11 NVIDIA";
  const env = {
    visible: true,
    focused: true,
    tauri: true,
    hmr: false,
    width: 1920,
    height: 1080,
    dpr: 1,
    href: "http://tauri.localhost/",
  };
  const client = {
    events: [],
    close() {
      calls.push("close");
    },
    async call(method, params) {
      calls.push(method);
      if (method === "SystemInfo.getInfo")
        return {
          gpu: {
            featureStatus: { gpu_compositing: "enabled" },
            auxAttributes: { glRenderer: gpuRenderer },
            devices: [
              { deviceString: "UNIT NVIDIA" },
              { deviceString: "Parsec Virtual Display Adapter" },
            ],
          },
        };
      if (method === "Runtime.evaluate")
        return {
          result: {
            value: params.expression.includes("samplePage")
              ? { timestamps: [5000, 5010], events: [], environmentStart: env, environmentEnd: env }
              : env,
          },
        };
      return {};
    },
  };
  const record = {
    exitCode: 0,
    production: true,
    commit: "a".repeat(40),
    executableSha256: "b".repeat(64),
    executablePath: "G:/release/ling_chat.exe",
    command: "pnpm run tauri build --no-bundle",
    builtAt: "2026-01-01T00:00:00Z",
  };
  const options = {
    endpoint: new URL("http://127.0.0.1:9223"),
    hostPid: 42,
    targetId: "unit",
    metadata: {
      mode: "full",
      scene: "normal",
      machineId: "unit",
      gpu: "unit",
      driver: "unit",
      webview2: "unit",
      dpi: "96",
      hdr: "off",
      power: "unit",
      commit: record.commit,
      buildEvidence: "unit-only",
      sceneEvidence: "unit-only",
      devtoolsClosed: true,
    },
    buildRecord: record,
    executableSha256: record.executableSha256,
    head: record.commit,
  };
  const adapters = {
    nativeSnapshot: async () => ({
      listenerAddress: "127.0.0.1",
      webview2: "unit",
      power: "unit",
      chain: [
        {
          Name: "msedgewebview2.exe",
          ProcessId: 43,
          ParentProcessId: 42,
          CommandLine: "--embedded-browser-webview=1",
        },
        { Name: "ling_chat.exe", ProcessId: 42, ExecutablePath: record.executablePath },
      ],
    }),
    connectCdp: async () => client,
    fetchJson: async (url) =>
      url.endsWith("/json/list")
        ? [
            {
              id: "unit",
              type: "page",
              url: env.href,
              webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/unit",
            },
          ]
        : { webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/browser/unit" },
    monitorForeground: () => ({
      ready: Promise.resolve(),
      result: Promise.resolve({ events: [], elapsedMs: 92000, intervalMs: 250 }),
    }),
  };
  const result = await capture.captureProduction(options, adapters);
  assert.equal(result.metadata.mode, "full");
  assert.equal(result.proof.nativeWebView, true);
  assert.equal(result.proof.gpuHardwareVerified, true);
  gpuRenderer = "ANGLE (Microsoft Basic Render Driver, D3D11 WARP)";
  const software = await capture.captureProduction(options, adapters);
  assert.equal(software.proof.gpuHardwareVerified, false);
  gpuRenderer = "UNIT ANGLE D3D11 NVIDIA";
  await assert.rejects(
    capture.captureProduction(
      { ...options, metadata: { ...options.metadata, power: "different" } },
      adapters
    ),
    /power/
  );
  await assert.rejects(
    capture.captureProduction(
      { ...options, metadata: { ...options.metadata, dpi: "144" } },
      adapters
    ),
    /DPI/
  );
  assert.equal(result.sample.timestamps[0], 5000);
  assert.ok(calls.includes("Runtime.evaluate"));
  assert.ok(
    calls.every((method) =>
      ["Runtime.enable", "Page.enable", "SystemInfo.getInfo", "Runtime.evaluate", "close"].includes(
        method
      )
    )
  );
  const bad = { ...options, buildRecord: { ...record, exitCode: 1 } };
  await assert.rejects(capture.captureProduction(bad, adapters), /build/);
});
