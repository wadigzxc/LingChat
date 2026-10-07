// Inject only on explicit CLI capture. No IPC, store, UI or runtime mutation.
// Self-contained so CDP can evaluate its source in the real production page.
export function samplePage() {
  return new Promise((resolve) => {
    const environment = () => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      visible: document.visibilityState === "visible",
      focused: document.hasFocus(),
      tauri: !!window.__TAURI_INTERNALS__,
      hmr: !!document.querySelector('script[src*="/@vite/client"], vite-plugin-vue-devtools'),
      href: location.href,
      userAgent: navigator.userAgent,
    });
    const origin = performance.now();
    const result = {
      warmupRequestedMs: 5000,
      sampleRequestedMs: 60000,
      warmupElapsedMs: null,
      timeOrigin: performance.timeOrigin,
      startedAt: new Date().toISOString(),
      timestamps: [],
      environmentStart: environment(),
      environmentEnd: null,
      events: [],
      longTasks: { status: "unsupported", entries: [] },
    };
    let observer;
    let raf;
    let ended = false;
    const handlers = [];
    for (const [target, names] of [
      [document, ["visibilitychange", "freeze"]],
      [globalThis, ["resize", "blur", "pagehide"]],
    ]) {
      for (const name of names) {
        const fn = () =>
          result.events.push({
            type: name,
            timestamp: performance.now(),
            environment: environment(),
          });
        target.addEventListener(name, fn);
        handlers.push([target, name, fn]);
      }
    }
    const keepTasks = (entries) => {
      for (const entry of entries)
        result.longTasks.entries.push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
        });
    };
    try {
      if (
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes?.includes("longtask")
      ) {
        observer = new PerformanceObserver((list) => keepTasks(list.getEntries()));
        observer.observe({ type: "longtask", buffered: false });
        result.longTasks.status = "supported";
      }
    } catch (error) {
      result.longTasks.reason = String(error);
      observer?.disconnect();
      observer = undefined;
    }
    const finish = (reason) => {
      if (ended) return;
      ended = true;
      if (reason) result.events.push({ type: reason, timestamp: performance.now() });
      cancelAnimationFrame(raf);
      clearTimeout(watchdog);
      if (observer) {
        keepTasks(observer.takeRecords());
        observer.disconnect();
      }
      for (const [target, name, fn] of handlers) target.removeEventListener(name, fn);
      result.environmentEnd = environment();
      const first = result.timestamps[0];
      const last = result.timestamps.at(-1);
      result.longTasks.entries = result.longTasks.entries.filter(
        (entry) => entry.startTime + entry.duration >= first && entry.startTime <= last
      );
      resolve(result);
    };
    const watchdog = setTimeout(() => finish("watchdog-timeout-incomplete"), 90000);
    let lastCondition = `${innerWidth}/${innerHeight}/${devicePixelRatio}/${document.visibilityState}/${document.hasFocus()}`;
    const frame = (timestamp) => {
      if (ended) return;
      const condition = `${innerWidth}/${innerHeight}/${devicePixelRatio}/${document.visibilityState}/${document.hasFocus()}`;
      if (condition !== lastCondition) {
        result.events.push({
          type: "observed-condition-change",
          timestamp,
          environment: environment(),
        });
        lastCondition = condition;
      }
      if (timestamp - origin >= 5000) {
        if (!result.timestamps.length) result.warmupElapsedMs = timestamp - origin;
        result.timestamps.push(timestamp);
        if (timestamp - result.timestamps[0] >= 60000) {
          finish();
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}
