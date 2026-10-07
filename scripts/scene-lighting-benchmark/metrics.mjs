// Pure offline arithmetic. RAF intervals are not OS present cadence.
export function makeReport(capture, kind, source) {
  if (!["fresh-capture", "offline-analysis"].includes(kind)) throw new Error("Unknown report kind");
  return {
    schemaVersion: 1,
    kind,
    generatedAt: new Date().toISOString(),
    source,
    capturedAt: capture.capturedAt,
    metadata: capture.metadata,
    proof: capture.proof,
    environmentStart: capture.sample.environmentStart,
    environmentEnd: capture.sample.environmentEnd,
    warmupElapsedMs: capture.sample.warmupElapsedMs,
    events: capture.sample.events,
    ...analyzeCapture(capture),
  };
}

export function renderMarkdown(report) {
  const text = JSON.stringify(report, null, 2);
  return `# Scene lighting RAF report — ${report.kind}\n\nMeasurement: **${report.measurementStatus}**; numeric gate: **${report.performance.status}**.\n\nTask19 acceptance: **${report.acceptance}**. RAF is NOT present cadence. Unsupported Long Tasks are unknown, never zero.\n\n| Metric | Value |\n| --- | ---: |\n${Object.entries(
    report.metrics
  )
    .map(([key, value]) => `| ${key} | ${value ?? "unknown"} |`)
    .join(
      "\n"
    )}\n\nLong Tasks: ${report.performance.longTasks.status}; count ${report.performance.longTasks.count ?? "unknown"}; max ${report.performance.longTasks.maxMs ?? "unknown"} ms.\n\nRaw source and hash, machine / executable evidence, conditions and exclusions:\n\n\`\`\`json\n${text}\n\`\`\`\n`;
}

export function compareCaptures(full, simplified) {
  const keys = [
    "machineId",
    "gpu",
    "driver",
    "webview2",
    "dpi",
    "hdr",
    "power",
    "commit",
    "scene",
    "sceneEvidence",
  ];
  const differences = keys.filter(
    (key) => !known(full.metadata[key]) || full.metadata[key] !== simplified.metadata[key]
  );
  if (full.metadata.mode !== "full" || simplified.metadata.mode !== "simplified")
    differences.push("requires full then simplified");
  if (
    !full.proof?.executableSha256 ||
    full.proof.executableSha256 !== simplified.proof?.executableSha256
  )
    differences.push("executableSha256");
  for (const key of ["width", "height", "dpr"]) {
    if (full.sample.environmentStart[key] !== simplified.sample.environmentStart[key])
      differences.push(key);
  }
  return {
    kind: "offline-comparison",
    comparable: differences.length === 0,
    differences,
    full: differences.length ? null : analyzeCapture(full),
    simplified: differences.length ? null : analyzeCapture(simplified),
    acceptance: "pending-present-visual-and-paired-runs",
  };
}

export const REQUIRED_METADATA = [
  "mode",
  "scene",
  "machineId",
  "gpu",
  "driver",
  "webview2",
  "dpi",
  "hdr",
  "power",
  "commit",
  "buildEvidence",
  "sceneEvidence",
];
const known = (value) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  !/^(unknown|pending|tbd|n\/a)$/i.test(value.trim());

export function analyzeCapture(capture) {
  if (capture.schemaVersion !== 1 || capture.kind !== "fresh-capture")
    throw new Error("Expected a schemaVersion 1 fresh-capture raw JSON");
  const { sample, metadata, proof } = capture;
  const reasons = [];
  let values;
  try {
    values = summarizeFrames(sample.timestamps);
  } catch (error) {
    reasons.push(`Timing evidence invalid/excluded: ${error.message}`);
    values = {
      intervalCount: null,
      elapsedMs: null,
      avgFPS: null,
      p95FrameMs: null,
      p99FrameMs: null,
      maxFrameMs: null,
      missedFramePercent: null,
    };
  }
  const missing = REQUIRED_METADATA.filter((key) => !known(metadata[key]));
  if (missing.length) reasons.push(`Missing metadata: ${missing.join(", ")}`);
  if (!["full", "simplified"].includes(metadata.mode)) reasons.push("Invalid mode");
  if (!/^[a-f0-9]{40}$/.test(metadata.commit ?? "")) reasons.push("Invalid build commit");
  if (metadata.devtoolsClosed !== true) reasons.push("Devtools closure not attested");
  if (
    !proof?.nativeWebView ||
    !proof.hostPid ||
    !proof.listenerPid ||
    !known(proof.executablePath) ||
    !/^[a-f0-9]{64}$/.test(proof.executableSha256 ?? "")
  )
    reasons.push("Native process/executable proof missing");
  if (!proof?.gpuHardwareVerified)
    reasons.push("Hardware GPU not verified (no virtual/software GPU acceptance)");
  if (proof?.powerUnchanged !== true) reasons.push("Power conditions changed or unknown");
  if (!Array.isArray(proof?.foregroundEvents) || proof.foregroundEvents.length)
    reasons.push("Native foreground interrupted or unknown");
  if (
    !Number.isFinite(sample.warmupElapsedMs) ||
    !Number.isFinite(proof?.foregroundMonitor?.elapsedMs) ||
    proof.foregroundMonitor.elapsedMs < sample.warmupElapsedMs + values.elapsedMs ||
    proof.foregroundMonitor.intervalMs !== 250
  )
    reasons.push("Native monitor/timing coverage missing or incomplete");
  if (
    sample.warmupRequestedMs !== 5000 ||
    sample.sampleRequestedMs !== 60000 ||
    sample.warmupElapsedMs < 5000 ||
    values.elapsedMs < 60000 ||
    !Number.isFinite(sample.timeOrigin) ||
    !known(sample.startedAt)
  )
    reasons.push("Incomplete fixed 5s warmup / 60s sample evidence");
  for (const name of ["environmentStart", "environmentEnd"]) {
    const env = sample[name];
    if (
      !env?.visible ||
      !env.focused ||
      !env.tauri ||
      env.hmr ||
      !/^https?:\/\/tauri\.localhost(?:[/:]|$)|^tauri:\/\//.test(env.href ?? "") ||
      Math.round(env.width * env.dpr) !== 1920 ||
      Math.round(env.height * env.dpr) !== 1080
    )
      reasons.push(`${name}: not foreground 1920x1080 physical production Tauri`);
  }
  if (sample.environmentStart.dpr !== sample.environmentEnd.dpr) reasons.push("DPI changed");
  if (!Array.isArray(sample.events) || sample.events.length)
    reasons.push("Sample invalid/excluded: visibility, blur, resize, lifecycle or watchdog events");
  if (
    sample.longTasks?.status !== "supported" ||
    !Array.isArray(sample.longTasks.entries) ||
    sample.longTasks.entries.some(
      (entry) =>
        !Number.isFinite(entry.duration) || entry.duration < 0 || !Number.isFinite(entry.startTime)
    )
  )
    reasons.push("Long Tasks unsupported/malformed: unknown, not zero");
  const gate = performanceGate(values, metadata.scene, sample.longTasks);
  return {
    measurementStatus: reasons.length ? "invalid-or-incomplete" : "valid",
    reasons,
    metrics: values,
    performance: gate,
    acceptance: "pending-present-visual-and-paired-runs",
  };
}
export function performanceGate(values, scene, longTasks) {
  const limits = { normal: [59, 20, 5], eight_png: [55, 25, 10] }[scene];
  if (!limits) throw new Error("scene must be normal or eight_png");
  const supported =
    longTasks?.status === "supported" &&
    Array.isArray(longTasks.entries) &&
    longTasks.entries.every((entry) => Number.isFinite(entry.duration) && entry.duration >= 0);
  const entries = supported ? longTasks.entries : null;
  const maxLongTaskMs = supported ? Math.max(0, ...entries.map((entry) => entry.duration)) : null;
  const checks = {
    avgFPS: Number.isFinite(values.avgFPS) ? values.avgFPS >= limits[0] : null,
    p95FrameMs: Number.isFinite(values.p95FrameMs) ? values.p95FrameMs <= limits[1] : null,
    missedFramePercent: Number.isFinite(values.missedFramePercent)
      ? values.missedFramePercent <= limits[2]
      : null,
    longTaskUnder100Ms: supported ? maxLongTaskMs < 100 : null,
  };
  const required = scene === "normal" ? Object.values(checks) : Object.values(checks).slice(0, 3);
  return {
    status: required.includes(false) ? "fail" : required.includes(null) ? "unknown" : "pass",
    checks,
    limits: { minFPS: limits[0], maxP95Ms: limits[1], maxMissedPercent: limits[2] },
    longTasks: {
      status: supported ? "supported" : "unknown",
      count: supported ? entries.length : null,
      maxMs: maxLongTaskMs,
    },
  };
}
export function summarizeFrames(timestamps) {
  if (
    !Array.isArray(timestamps) ||
    timestamps.length < 2 ||
    timestamps.some((time, i) => !Number.isFinite(time) || (i > 0 && time <= timestamps[i - 1]))
  ) {
    throw new Error(
      "RAF timestamps must be finite and strictly increasing with at least two entries"
    );
  }
  const intervals = timestamps.slice(1).map((time, i) => time - timestamps[i]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const elapsedMs = timestamps.at(-1) - timestamps[0];
  const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return {
    intervalCount: intervals.length,
    elapsedMs,
    avgFPS: (intervals.length * 1000) / elapsedMs,
    p95FrameMs: percentile(0.95),
    p99FrameMs: percentile(0.99),
    maxFrameMs: sorted.at(-1),
    missedFramePercent: (intervals.filter((ms) => ms > 16.67).length / intervals.length) * 100,
  };
}
