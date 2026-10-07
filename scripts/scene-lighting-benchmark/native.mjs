import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const samePath = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();

export function validateNativeSnapshot(snapshot, hostPid, executablePath) {
  const listener = snapshot.chain?.[0];
  const host = snapshot.chain?.find((process) => process.ProcessId === hostPid);
  if (
    snapshot.listenerAddress !== "127.0.0.1" ||
    listener?.Name?.toLowerCase() !== "msedgewebview2.exe" ||
    !listener.CommandLine?.includes("--embedded-browser-webview=1") ||
    !host ||
    !samePath(host.ExecutablePath, executablePath)
  ) {
    throw new Error(
      "Endpoint must belong to native msedgewebview2.exe with the specified production host/executable ancestry"
    );
  }
  if (
    /--disable-gpu(?:\s|$)|swiftshader|llvmpipe|--use-gl=swiftshader|--use-angle=swiftshader/i.test(
      listener.CommandLine
    )
  )
    throw new Error("Software/disabled GPU is not a real-GPU acceptance environment");
}

export function validateProductionStatus(status) {
  if (typeof status !== "string" || status.trim()) {
    throw new Error(
      "Production source tree differs from build commit; commit/rebuild outside this tool first"
    );
  }
}

export function validateBuildRecord(record, commit, executableSha256) {
  if (
    record.exitCode !== 0 ||
    record.production !== true ||
    !/^[a-f0-9]{40}$/.test(record.commit ?? "") ||
    record.commit !== commit ||
    !/^[a-f0-9]{64}$/.test(record.executableSha256 ?? "") ||
    record.executableSha256 !== executableSha256 ||
    !record.executablePath?.endsWith(".exe") ||
    !record.builtAt ||
    !/tauri(?:\s+run)?\s+build/.test(record.command ?? "") ||
    /ignore-version-mismatches|--debug|cargo\s+build/.test(record.command)
  )
    throw new Error("Invalid or mismatched production Tauri build evidence");
}

const preamble = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();`;
export async function nativeSnapshot(port) {
  if (process.platform !== "win32") throw new Error("Fresh capture requires Windows WebView2");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid endpoint port");
  const script = `${preamble}
    $connections=@(Get-NetTCPConnection -State Listen -LocalPort ${port});
    if ($connections.Count -ne 1) { throw 'Expected exactly one native loopback listener' };
    $processes=@(Get-CimInstance Win32_Process); $current=$connections[0].OwningProcess; $chain=@();
    for ($i=0; $i -lt 12; $i++) {
      $p=$processes | Where-Object { $_.ProcessId -eq $current } | Select-Object -First 1;
      if (!$p) { break }; $chain+=($p | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,CommandLine); $current=$p.ParentProcessId;
    };
    $runtime=if ($chain[0].ExecutablePath) { (Get-Item $chain[0].ExecutablePath).VersionInfo.FileVersion } else { $null };
    $power=(powercfg /getactivescheme) -join ' ';
    @{ observedAt=(Get-Date -Format o); listenerAddress=$connections[0].LocalAddress; chain=$chain; webview2=$runtime; gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion); power=$power } | ConvertTo-Json -Depth 6 -Compress;`;
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024 }
  );
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

// Read-only native foreground monitor; no focus, clicks, window changes or ETW.
export function monitorForeground(hostPid, signal, durationMs = 92000) {
  if (!Number.isInteger(hostPid) || hostPid <= 0) throw new Error("Invalid host PID");
  if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > 92000)
    throw new Error("Invalid monitor duration");
  const script = `${preamble}
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class SceneBenchmarkForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint id); }';
    $events=@(); $clock=[Diagnostics.Stopwatch]::StartNew(); [Console]::WriteLine("READY");
    while ($clock.ElapsedMilliseconds -lt ${durationMs}) {
      $window=[SceneBenchmarkForeground]::GetForegroundWindow(); [uint32]$foreground=0;
      [void][SceneBenchmarkForeground]::GetWindowThreadProcessId($window,[ref]$foreground);
      if ($foreground -ne ${hostPid}) { $events+=@{ timestampMs=$clock.ElapsedMilliseconds; pid=$foreground } };
      Start-Sleep -Milliseconds 250;
    }; @{ intervalMs=250; elapsedMs=$clock.ElapsedMilliseconds; events=$events } | ConvertTo-Json -Depth 4 -Compress;`;
  const execution = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 100000,
    signal,
    maxBuffer: 4 * 1024 * 1024,
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Native foreground monitor readiness timeout")),
      20000
    );
    let output = "";
    execution.child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    execution.catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const result = execution.then(({ stdout }) =>
    JSON.parse(
      stdout
        .slice(stdout.indexOf("READY") + 5)
        .trim()
        .replace(/^\uFEFF/, "")
    )
  );
  result.catch(() => {});
  return { ready, result };
}
