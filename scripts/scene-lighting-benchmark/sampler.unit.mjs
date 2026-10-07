// A synthetic RAF clock exercises the sampler contract; NOT real GPU evidence.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import * as sampler from "./sampler.mjs";

test("in-page sampler waits 5s then retains 60s of original timestamps and cleans observers", async () => {
  let time = 0;
  let raf;
  const listeners = new Map();
  const removed = [];
  const document = {
    visibilityState: "visible",
    hasFocus: () => true,
    querySelector: () => null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => removed.push(name),
  };
  const sandbox = {
    document,
    window: { __TAURI_INTERNALS__: {} },
    location: { href: "http://tauri.localhost/" },
    navigator: { userAgent: "synthetic-unit" },
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    performance: { now: () => time, timeOrigin: 123 },
    Date,
    requestAnimationFrame: (fn) => {
      raf = fn;
      return 1;
    },
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => removed.push(name),
  };
  const promise = vm.runInNewContext(`(${sampler.samplePage.toString()})()`, sandbox);
  for (time = 10; time <= 65000; time += 10) {
    sandbox.devicePixelRatio = time >= 10000 && time < 20000 ? 1.25 : 1;
    raf(time);
  }
  const sample = await promise;
  assert.equal(sample.warmupRequestedMs, 5000);
  assert.equal(sample.sampleRequestedMs, 60000);
  assert.equal(sample.warmupElapsedMs, 5000);
  assert.equal(sample.timestamps[0], 5000);
  assert.equal(sample.timestamps.at(-1), 65000);
  assert.equal(sample.longTasks.status, "unsupported");
  assert.ok(removed.includes("resize"));
  assert.equal(sample.environmentEnd.tauri, true);
  assert.ok(sample.events.some((event) => event.type === "observed-condition-change"));
});
