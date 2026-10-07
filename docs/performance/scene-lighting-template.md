# Scene lighting — Windows production acceptance record

**Status: NOT ACCEPTED / pending.** This is a procedure and record template, not a measured result. A successful build or unit suite is not Task19 acceptance. Do not check Task18 or Task19 from this template. Fill actual evidence below; retain failed/invalid runs rather than deleting them.

## Safety and prerequisites

- Use the real Windows production Tauri executable, physical GPU and native WebView2; never Vite/localhost demo, Chrome, jsdom, synthetic unit clocks, CI/virtual GPUs or a debug executable.
- The capture script never launches, focuses, resizes, clicks, calls application IPC, switches modes or writes app data/settings. Separately from the script, the user has authorized automatic scene/mode/size preparation and foreground sampling **only in a proven isolated test instance**. That authorization never extends to the original instance, data, saves, settings, ports or other user programs. If isolation cannot be proved, stop before launch.
- Do not close other user programs, change power/HDR/DPI, enable an admin ETW session or reboot without permission. Record the existing conditions; obtain permission before any needed change.
- Release data lives beside the executable (`data/`, `src-tauri/src/init/static_copy.rs`); settings are under the application identifier in AppData. Startup may seed resources, clean orphan voice files, load plugins, write permissions, start cast services and autosave (`src-tauri/src/lib.rs`). A separate executable directory alone does **not** prove settings isolation. Do not launch against existing user data casually; agree a safe operator-controlled launch first.
- Native listener ancestry must be `msedgewebview2.exe` → the exact recorded production host PID/executable. A listener named Chrome, Electron, AfterFX or another app is not eligible.
- Close HMR and visible DevTools panels. Read-only CDP is not opening a DevTools panel. GPU acceleration must be proved from the active WebView GPU renderer/compositing evidence; listing an installed GPU is insufficient. If CDP `SystemInfo.getInfo` is unavailable, record unknown and arrange separate evidence; do not call it verified.

## Build provenance (before opening the app)

Check the real CLI help, preserve the log and use a scoped configuration override to avoid the normal pre-build command overwriting `data/data_manifest.json`:

```bash
export CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=1
pnpm run tauri build --help
pnpm run tauri build --no-bundle --config C:/path/tauri-benchmark-build.json
```

`tauri-benchmark-build.json` (outside the repository):

```json
{
  "build": {
    "beforeBuildCommand": "node scripts/prepare-desktop-resources.mjs --staging-only && pnpm run build"
  }
}
```

Do not use `--ignore-version-mismatches` or direct `cargo build` to bypass the Tauri compatibility gate. A failed build has no valid executable provenance. Resolve dependency scope separately with approval, rerun gates and use a new log name. No model download or icon regeneration is required by the override above.

After an actual successful build, record the actual executable path, SHA-256, commit, command, timestamp and log. Do **not** manufacture a successful `build.json`. The script checks its hash against the file, the native host path and current repository HEAD, and refuses dirty production source files. Tooling-only dirty files do not turn unbuilt production code into the measured commit.

Required `build.json` schema (every placeholder below must be replaced from real output):

```json
{
  "exitCode": 0,
  "production": true,
  "commit": "TBD",
  "executablePath": "TBD",
  "executableSha256": "TBD",
  "command": "TBD",
  "builtAt": "TBD",
  "logPath": "TBD"
}
```

### CDP enablement blocker check

An already-enabled eligible production WebView endpoint can be inspected without UI actions. If none exists, ask the operator/maintainer to approve a way to expose **only loopback** CDP in the production app. Do not silently edit the production host, app configuration, registry or HDR switch.

In the current host, `lib.rs` sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` to `--force-color-profile=scrgb-linear` when the stored HDR switch is off. Consequently, merely setting that environment variable to a remote-debugging flag before launch may be overwritten. Do not present that launch command as a proven working solution. Never enable HDR just to obtain CDP.

Prefer a build-only, external Tauri configuration override over production Rust instrumentation: `app.windows[].additionalBrowserArgs` reaches Wry's environment options, while WebView2 [appends the environment variable's arguments to those options](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl?view=webview2-1.0.622.22#CreateCoreWebView2EnvironmentWithOptions). Preserve Wry's existing default switches, add only `--remote-debugging-address=127.0.0.1 --remote-debugging-port=<verified-free-port>`, and leave the host's HDR/color handling unchanged. This is a candidate until the actual native browser command line and single loopback listener prove it on the installed runtime; documentation is not live verification. Do not expose CDP in the ordinary app configuration.

### Authorized isolated-instance preparation

- Build override identifier must differ from the original `com.noiq.ling-chat`, e.g. `com.noiq.ling-chat.benchmark`; use a visibly distinct window title. Store/AppData and WebView2 profile isolation must be verified with the real Tauri path APIs and native `--user-data-dir` evidence, not merely an `APPDATA` environment override. Do not copy original settings or credentials.
- Copy the validation/acceptance executable and only tracked, credential-free bundled fixtures into a fresh dedicated directory; release `data/` is beside that executable. Use that directory as CWD and retain an asset manifest. Never launch the executable in the repository's release directory against any pre-existing data.
- Before launch, preserve the original application process/listener inventory, prove the CDP port is free, and inspect startup settings/defaults. Ensure cast/LAN/proactive/AI auto-start is disabled in the isolated settings and that no credentials exist. Verify post-launch paths/process ancestry/listeners before any scene preparation. A port conflict is a blocker, never permission to stop the original listener.
- The sampling executable must be rebuilt from the parent-committed production tree. Dependency changes are production changes; an uncommitted validation build is not accepted provenance. The capture command rejects tracked, staged **and untracked** production files. Never fabricate HEAD/build records or relax that guard.
- User-authorized automation may prepare fixtures, select full/simplified, focus and size only the proven isolated window. It must read back each changed state and retain screenshots/parameter snapshots. Capture remains read-only and invalidates any mid-run condition change.

## Machine and measurement conditions

1920×1080 here means **physical WebView content pixels**, not the outer window including decorations. Record CSS `innerWidth × innerHeight`, `devicePixelRatio` and their product. For example, a non-100% DPI setting needs an appropriate CSS viewport; the tool checks the product at both boundaries and observes changes on RAF. The background image itself must be 1920×1080. Pair runs at identical CSS and physical dimensions/DPI.

| Condition                                        | Actual value | Evidence/source/time                                 |
| ------------------------------------------------ | ------------ | ---------------------------------------------------- |
| Machine identifier / Windows version             | pending      | pending                                              |
| Active GPU / hardware acceleration               | pending      | native CDP renderer + compositor / operator evidence |
| GPU driver                                       | pending      | Win32_VideoController / GPU control panel            |
| WebView2 runtime version                         | pending      | native process executable FileVersion                |
| Monitor / refresh rate / physical viewport       | pending      | screen evidence + raw environment                    |
| CSS viewport / DPR / DPI                         | pending      | raw environments + OS display settings screenshot    |
| OS HDR / app HDR / color profile                 | pending      | operator screenshots; do not change                  |
| Power scheme / performance mode / AC or battery  | pending      | powercfg + operator screen / timestamp               |
| Local physical display vs remote/virtual adapter | pending      | operator evidence; virtual GPU cannot qualify        |
| Build commit / exe path / SHA-256 / log          | pending      | actual successful production build                   |
| Host PID / listener PID / target ID              | pending      | `inspect`, native chain and CDP target               |
| HMR absent / DevTools panels closed              | pending      | raw + operator attestation                           |
| Other workload / measurement observer overhead   | pending      | operator notes; foreground monitor polls every 250ms |

Create `machine.json` per run. These placeholders are deliberately refused by the tool; they are **not defaults or facts**:

```json
{
  "mode": "full",
  "scene": "normal",
  "machineId": "TBD",
  "gpu": "TBD",
  "driver": "TBD",
  "webview2": "TBD",
  "dpi": "TBD",
  "hdr": "TBD",
  "power": "TBD",
  "commit": "TBD",
  "buildEvidence": "TBD",
  "sceneEvidence": "TBD",
  "devtoolsClosed": false
}
```

`mode` is exactly `full` or `simplified`; `scene` is exactly `normal` or `eight_png`. Use the same machine/scene evidence identifier across each paired mode run. `sceneEvidence` should identify a retained scene/lighting parameter snapshot and asset manifest (names, hashes, dimensions, transparent character images, target/blend/effect settings), plus a mode/settings screenshot. Full vs simplified must use the same scene even when simplified suppresses PNG effects. `power` records the exact native `inspect` power string; `dpi` is numeric display DPI (`96 × DPR`). `hdr` documents both OS and app settings. Hardware names must describe the **active** adapter, not a guess from the installed list.

## Representative scenes and visual review

| Scene       | Assets / parameters / hashes                                                                                                                             | Screenshots | Operator reviewer/result |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| `normal`    | 1920×1080 background; ≥1 high-resolution transparent static character; character/background ambient; linear main light; directional rim; bloom; vignette | pending     | pending                  |
| `eight_png` | Same representative features with exactly 8 enabled PNG layers, dimensions/hashes/placement/targets documented                                           | pending     | pending                  |

Review actual frames/screenshots at the same window size. DOM style assertions do not establish visual acceptance.

| Visual criterion          | Comparison/evidence to retain                                                                 | Result/reviewer |
| ------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| Cold backlight            | Upper-right and adjustable main direction; cold ambient; bright transparent edges; soft bloom | pending         |
| Blend mode                | Same scene/settings, `normal` versus `overlay` visually distinguishable                       | pending         |
| Target hierarchy          | character / background / both; front/behind ordering and overlapping layers                   | pending         |
| Original-image hold       | Before hold, during hold (no residual effects), after release                                 | pending         |
| Shared editor/runtime     | Editor preview and formal stage at identical viewport/CSS size; no parameter divergence       | pending         |
| Live2D exemption          | Actual Live2D body without static-character filters while background effects remain correct   | pending         |
| Full/simplified operation | Operator setting screenshots for each measured run, no mid-run changes                        | pending         |

## Run commands

From the repository root, Node ≥22; no dependency installation is needed:

```bash
node --test scripts/scene-lighting-benchmark/*.unit.mjs
node scripts/benchmark-scene-lighting.mjs --help
node scripts/benchmark-scene-lighting.mjs inspect --endpoint http://127.0.0.1:9223 --host-pid 12345 --executable C:/path/ling_chat.exe
```

Replace the PID/path/port from **live native discovery**. With operator approval, list the eligible endpoint targets using the read-only URL `http://127.0.0.1:9223/json/list`; choose the production Tauri page ID. No target auto-selection or navigation is performed.

The operator prepares the scene/mode and foreground size, then capture the existing page:

```bash
node scripts/benchmark-scene-lighting.mjs capture --endpoint http://127.0.0.1:9223 --target ACTUAL_ID --host-pid ACTUAL_PID --metadata C:/evidence/normal-full-machine.json --build-record C:/evidence/build.json --out C:/evidence/normal-full-01
```

Leave the app foreground until completion (~93 seconds): the ready-synchronized native monitor covers the complete 5s+60s RAF interval and continues until its fixed 92s observation finishes. It does not focus the app. Repeat after the **operator** selects simplified mode, then repeat both modes for `eight_png`. The tool does not switch modes, edit the scene, warm up a separate demo or reset runtime state.

Outputs: `<prefix>.raw.json` with original performance timestamps/time origin, Long Task entries, native/CDP proof and condition events; `<prefix>.json` analysis; `<prefix>.md` readable analysis. Files are exclusive-create; use a fresh prefix for retries. Aborted/disconnected attempts are failures, not valid samples; preserve the console log and any raw evidence. A watchdog result retains incomplete timestamps with unknown metrics rather than invented zero FPS. Hidden/blurred/resized/navigated/DPI-changed or native-background samples are invalid/excluded; retain them and repeat. **Slow frames remain in the sample and gate**, never discard them to improve the result. A RAF gap is not proof of a dropped OS present; actual presents/drops require ETW.

Offline reanalysis and same-condition comparison (neither is a fresh capture):

```bash
node scripts/benchmark-scene-lighting.mjs report --input C:/evidence/normal-full-01.raw.json --out C:/evidence/normal-full-reanalysis-01
node scripts/benchmark-scene-lighting.mjs compare --full C:/evidence/normal-full-01.raw.json --simplified C:/evidence/normal-simplified-01.raw.json --out C:/evidence/normal-pair-01
```

Elapsed duration is `last RAF timestamp − first RAF timestamp`, not an assumed 60000; average FPS is interval count ×1000 / elapsed ms. Quantiles use nearest-rank p95/p99 over unrounded consecutive intervals. `missedFramePercent` uses **0–100 percent units**, not a 0–1 ratio, for intervals strictly `>16.67ms`. Unsupported/unobserved Long Tasks are `unknown` (`null` count/max), never 0. A numeric `pass` is not measurement validity and not Task19 acceptance.

## Windows present-cadence cross-check (mandatory)

RAF only measures main-thread callback intervals. It does not prove compositor/DWM/display presents.

1. Discover existing PresentMon/ETW tools without installing anything. `wpr.exe` presence alone is not a captured trace. If PresentMon is unavailable, record the blocker and obtain approval for a signed official portable release from [Intel PresentMon](https://github.com/GameTechDev/PresentMon/releases), or an approved WPR GPU/DWM provider capture.
2. Before running a downloaded executable, verify its Authenticode signature and hash/source; retain those facts. Obtain explicit permission for any administrator ETW/elevation; no driver installation, restart or system-setting changes by this benchmark script.
3. Read **that installed version's** `--help`; supported flag names vary. Scope the trace to the actual WebView GPU/present PID (not blindly to the Tauri host), map it through the recorded native process tree and retain swap-chain/process/provider identity. Use a trace interval covering the exact RAF sample, not an unrelated FPS counter.
4. Retain the raw CSV/ETL, tool version, command, start/end timestamps, PID mapping, present/display interval quantiles, dropped/discarded presents and excluded intervals. Explain any disagreement with RAF. Capture overhead and unsupported metrics remain visible. No trace means **pending**, not zero drops or a cadence pass.

| Run                  | Trace/CSV/ETL + hash | Provider/tool/version/command | PID/swapchain + sample alignment | Present cadence/drops + reconciliation |
| -------------------- | -------------------- | ----------------------------- | -------------------------------- | -------------------------------------- |
| normal full          | pending              | pending                       | pending                          | pending                                |
| normal simplified    | pending              | pending                       | pending                          | pending                                |
| eight_png full       | pending              | pending                       | pending                          | pending                                |
| eight_png simplified | pending              | pending                       | pending                          | pending                                |

## Results and decision

| Scene / mode         | Raw + hash / elapsed ms | avgFPS  | p95 / p99 / max ms | >16.67ms % | Long Tasks count/max/support | Validity / numeric gate / trace / visual |
| -------------------- | ----------------------- | ------- | ------------------ | ---------- | ---------------------------- | ---------------------------------------- |
| normal full          | pending                 | unknown | unknown            | unknown    | unknown                      | pending                                  |
| normal simplified    | pending                 | unknown | unknown            | unknown    | unknown                      | pending                                  |
| eight_png full       | pending                 | unknown | unknown            | unknown    | unknown                      | pending                                  |
| eight_png simplified | pending                 | unknown | unknown            | unknown    | unknown                      | pending                                  |

- Normal: avgFPS ≥59, p95 ≤20ms, missed-frame **percent** ≤5%, every Long Task <100ms (exactly 100ms fails).
- Eight PNG: avgFPS ≥55, p95 ≤25ms, missed-frame percent ≤10%; still record Long Tasks/support. p99/max are reported, not silently substituted for the p95 gate.
- Compare full/simplified on the same machine, scene/assets, commit/executable hash, viewport, DPI, driver/WebView2, HDR and power. If full fails, simplified must at least meet the normal-scene gate; retain full failure and the paired evidence.
- Task19 remains pending until valid real samples, required Windows present traces and actual visual review all exist. Unit/contract tests, frontend tests and builds are preparation only.

Final reviewer: pending. Decision/evidence links/excluded runs/remaining blockers: pending.
