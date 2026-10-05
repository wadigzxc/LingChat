# Task13 逐行为 RED / GREEN 记录

所有命令在 `G:/Lingchat/LingChat` 执行。原始输出保存在 `C:/Users/INTRIGUED/AppData/Local/Temp/task13-*.log`；下方为实跑输出摘录，不是合成输出。

## 命令选择器

每轮的命令为 `pnpm exec vitest run <选择器>`。表中的缩写逐字对应：

```text
S = src/stores/modules/settings/__tests__/lighting-quality.spec.ts
Q = src/components/settings/lighting/__tests__/quality.spec.ts
C = src/composables/__tests__/scene-lighting.spec.ts
H = src/components/game/standard/__tests__/task13.spec.ts
```

执行包装将 stdout/stderr 重定向到 `task13-<轮次>-<阶段>.log`，保留原命令退出状态。每轮 GREEN 都跑对应模块已有测试，不是只跑新增用例。

## 行为与命令

| 轮次 | 选择器                | 行为                                              |
| ---- | --------------------- | ------------------------------------------------- |
| 01   | `S`                   | 旧设置默认 false、持久化及新 store 恢复           |
| 02   | `Q`                   | 原生 checkbox DOM 双向消费 settings               |
| 03   | `C`                   | 受控 hash IPC 路径、convertFileSrc 与响应式图片   |
| 04   | `C`                   | 场景/质量切换丢弃过期响应                         |
| 05   | `C`                   | 卸载丢弃在途响应                                  |
| 06   | `C`                   | 无效 hash / 不匹配响应安全拒绝                    |
| 07   | `C`                   | IPC 失败不产生未处理拒绝                          |
| 08   | `C`                   | 重复素材及质量切换复用缓存                        |
| 09   | `C`                   | 探测 plus-lighter、screen 降级与一次告警          |
| 10   | `H`                   | 背景独立低层 slot 消费 activeLighting             |
| 11   | `H`                   | 背景 PNG 固定 behind/front 层与简化               |
| 12   | `H`                   | 静态视觉滤镜、原有 transform、未滤镜 accessories  |
| 13   | `H`                   | Live2D ready 不施角色光                           |
| 14   | `H`                   | Live2D fallback 必须可见且有 URL                  |
| 16   | `H`                   | 删除角色舞台旧全屏 gradient                       |
| 17   | `RED: H / GREEN: H C` | 宿主 provider 子组件共享响应式资源缓存            |
| 18   | `H`                   | MainChat 整体槽、暗角与 Both 单次合成             |
| 19   | `H`                   | CastWindow 整体槽与投屏布局保留                   |
| 20   | `H`                   | PreviewStage 整体槽与 Teleport 宿主               |
| 21   | `H`                   | MainChat 可操作简化光影开关                       |
| 23   | `C`                   | 参数变化复用正在解析的 hash 请求                  |
| 24   | `C`                   | URL 转换失败安全降级                              |
| 28   | `H`                   | 真实 ImageAcrossFade 清空 URL 时不残留旧 fallback |

## 初始红灯与修正说明

- 02、03 首次 RED 因待创建组件/composable 不存在而失败，是缺失实现，不是最终通过结果；03 同时先核对了默认工厂导出名。03 第一轮实现后 DOM 仍无 img，响应式查询改正后才 GREEN。
- 01 首次 GREEN 仍 `expected undefined to be false`；补到真实 DEFAULT_SETTINGS.display 后重跑转绿。
- 12 首次 RED 附带测试图片 stub 缺失 `waitForLoad`，补齐 stub 后重新 RED，仍明确缺少 `data-lighting-frame`，之后才接入生产组件。
- 19 首次 RED 附带投屏 snapshot mock 缺失，补齐 IPC mock 后重新 RED，仍明确 Final 槽数量为 0，之后才修改投屏宿主。
- 07 与 24 的断言表面通过，但 Vitest 分别捕获一个未处理拒绝；这是失败执行，不能当 GREEN。补充 catch 后才得到无错误结果。
- 15、22、25、29 是已实现行为的附加回归，首次就绿，**不冒充新的 RED→GREEN 周期**；没有据此先实现缺失行为。

## 实际输出证据

### 01 · 旧设置默认 false、持久化及新 store 恢复

命令：`pnpm exec vitest run src/stores/modules/settings/__tests__/lighting-quality.spec.ts`。

`task13-01-red.log`

```text
 FAIL  src/stores/modules/settings/__tests__/lighting-quality.spec.ts > defaults old settings to full lighting and persists quality across webviews
AssertionError: expected undefined to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

`task13-01-green.log`

```text
 FAIL  src/stores/modules/settings/__tests__/lighting-quality.spec.ts > defaults old settings to full lighting and persists quality across webviews
AssertionError: expected undefined to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

`task13-01-green-retry.log`

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

### 02 · 原生 checkbox DOM 双向消费 settings

命令：`pnpm exec vitest run src/components/settings/lighting/__tests__/quality.spec.ts`。

`task13-02-red.log`

```text
 FAIL  src/components/settings/lighting/__tests__/quality.spec.ts [ src/components/settings/lighting/__tests__/quality.spec.ts ]
Error: Failed to resolve import "../LightingQualityToggle.vue" from "src/components/settings/lighting/__tests__/quality.spec.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

`task13-02-green.log`

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

### 03 · 受控 hash IPC 路径、convertFileSrc 与响应式图片

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-03-red.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts [ src/composables/__tests__/scene-lighting.spec.ts ]
Error: Failed to resolve import "../useSceneLighting" from "src/composables/__tests__/scene-lighting.spec.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

`task13-03-red-corrected.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts [ src/composables/__tests__/scene-lighting.spec.ts ]
Error: Failed to resolve import "../useSceneLighting" from "src/composables/__tests__/scene-lighting.spec.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

`task13-03-green.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts > resolves verified backend paths reactively without treating a hash as a URL
Error: Unable to get img within: <!--v-if-->
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

`task13-03-green-retry.log`

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

### 04 · 场景/质量切换丢弃过期响应

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-04-red.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts > ignores stale asset responses after a scene or quality switch
AssertionError: expected "vi.fn()" to not be called with arguments: [ 'G:/stale.png' ]
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

`task13-04-green.log`

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### 05 · 卸载丢弃在途响应

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-05-red.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts > discards in-flight responses on unmount
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

`task13-05-green.log`

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### 06 · 无效 hash / 不匹配响应安全拒绝

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-06-red.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts > rejects invalid hashes and unsafe/mismatched backend resolutions
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```

`task13-06-green.log`

```text
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### 07 · IPC 失败不产生未处理拒绝

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-07-red.log`

```text
Vitest caught 1 unhandled error during the test run.
Error: missing asset
 Test Files  1 passed (1)
      Tests  5 passed (5)
     Errors  1 error
```

`task13-07-green.log`

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### 08 · 重复素材及质量切换复用缓存

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-08-red.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts > caches resolved hashes across repeated layers and quality changes
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

`task13-08-green.log`

```text
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### 09 · 探测 plus-lighter、screen 降级与一次告警

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-09-red.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts > probes blend capability and warns once across remounted hosts
AssertionError: expected 'plus-lighter' to be 'screen' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

`task13-09-green.log`

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### 10 · 背景独立低层 slot 消费 activeLighting

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-10-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > background uses active lighting inside a bounded slot below the stage
Error: Unable to get [data-lighting-background] within: <!-- 背景图 + 背景光照滤镜 -->
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

`task13-10-green.log`

```text
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

### 11 · 背景 PNG 固定 behind/front 层与简化

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-11-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > background PNG slots stay image → behind → directional → front even with z-index 7
Error: Unable to get [data-lighting-assets="behind"] within: <div data-v-ef803796="" data-lighting-background="" class="absolute inset-0" style="isolation: isolate; z-index: 0;">
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

`task13-11-green.log`

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### 12 · 静态视觉滤镜、原有 transform、未滤镜 accessories

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-12-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > lights only the static visual while preserving role transforms and unfiltered accessories
Error: Unable to get [data-lighting-frame] within: <transition-stub data-v-1edcfed5="" data-v-fe8ffd84="" name="character-fade" appear="false" persisted="false" css="true">
Vitest caught 1 unhandled error during the test run.
TypeError: imageFadeRef.value?.waitForLoad is not a function
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
     Errors  1 error
```

`task13-12-red-corrected.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > lights only the static visual while preserving role transforms and unfiltered accessories
Error: Unable to get [data-lighting-frame] within: <transition-stub data-v-1edcfed5="" data-v-fe8ffd84="" name="character-fade" appear="false" persisted="false" css="true">
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

`task13-12-green.log`

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### 13 · Live2D ready 不施角色光

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-13-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > Live2D ready never lights the hidden static fallback
AssertionError: expected 'brightness(1.4)' to be 'none' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```

`task13-13-green.log`

```text
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### 14 · Live2D fallback 必须可见且有 URL

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-14-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > lights only a visible Live2D static fallback, not a hidden or missing fallback
AssertionError: expected 'brightness(1.4)' to be 'none' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

`task13-14-green.log`

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### 16 · 删除角色舞台旧全屏 gradient

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-16-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > role stage has no screen-wide character overlay or legacy gradient
AssertionError: expected [ <div …(2)></div> ] to have a length of +0 but got 1
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

`task13-16-green.log`

```text
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### 17 · 宿主 provider 子组件共享响应式资源缓存

RED 命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

GREEN 命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts src/composables/__tests__/scene-lighting.spec.ts`。

`task13-17-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > a host shares one reactive asset cache with background and character consumers
AssertionError: expected [ …(3) ] to have a length of 1 but got 3
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

`task13-17-green.log`

```text
 Test Files  2 passed (2)
      Tests  15 passed (15)
```

### 18 · MainChat 整体槽、暗角与 Both 单次合成

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-18-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > MainChat mounts single overall effects and Final PNG/vignette between stage and dialog
AssertionError: expected [] to have a length of 2 but got +0
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

`task13-18-green.log`

```text
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### 19 · CastWindow 整体槽与投屏布局保留

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-19-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > CastWindow mounts Final slots with overall effects below dialogue and preserves cast layout
AssertionError: expected [] to have a length of 2 but got +0
Vitest caught 1 unhandled error during the test run.
TypeError: Cannot read properties of undefined (reading 'backgroundEffect')
 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
     Errors  1 error
```

`task13-19-red-corrected.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > CastWindow mounts Final slots with overall effects below dialogue and preserves cast layout
AssertionError: expected [] to have a length of 2 but got +0
 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
```

`task13-19-green.log`

```text
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### 20 · PreviewStage 整体槽与 Teleport 宿主

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-20-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > PreviewStage uses the same Final and single overall slots inside its teleported stage
AssertionError: expected [] to have a length of 2 but got +0
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

`task13-20-green.log`

```text
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

### 21 · MainChat 可操作简化光影开关

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-21-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > MainChat exposes a usable quality switch above lighting without changing runtime revision
Error: Unable to get input[type="checkbox"] within: <div class="main-box" style="isolation: isolate;">
 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

`task13-21-green.log`

```text
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### 23 · 参数变化复用正在解析的 hash 请求

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-23-red.log`

```text
 FAIL  src/composables/__tests__/scene-lighting.spec.ts > reuses in-flight hash resolution after a parameter-only lighting update
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

`task13-23-green.log`

```text
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

### 24 · URL 转换失败安全降级

命令：`pnpm exec vitest run src/composables/__tests__/scene-lighting.spec.ts`。

`task13-24-red.log`

```text
Vitest caught 1 unhandled error during the test run.
Error: unavailable protocol
 Test Files  1 passed (1)
      Tests  9 passed (9)
     Errors  1 error
```

`task13-24-green.log`

```text
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

### 28 · 真实 ImageAcrossFade 清空 URL 时不残留旧 fallback

命令：`pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts`。

`task13-28-red.log`

```text
 FAIL  src/components/game/standard/__tests__/task13.spec.ts > real fallback artwork does not remain visible after its URL disappears
AssertionError: expected true to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 14 passed (15)
```

`task13-28-green.log`

```text
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

## 非行为新增的回归与最终门

- `task13-baseline.log`：12 文件 / 88 测试。
- `task13-15-regression.log`：静态 PNG slot / 简化 rim 回归，1 文件 / 6 测试。
- `task13-22-regression.log`：投屏、试玩消费简化设置回归，1 文件 / 14 测试。
- `task13-25-regression.log`：不可用 / 警告 / URL 越界参数化资产回归，1 文件 / 14 测试。
- `task13-26-refactor.log`：格式重构与模块回归，11 文件 / 73 测试；旧 stdout 日志未携带完整命令选择器，不反向编造。以末尾明确选择器的最终专项重新验证。
- `task13-27-regression.log`：2 文件 / 28 测试；`task13-27-typecheck.log` 无诊断。
- `task13-28-regression.log`：共享组件/composable/设置回归，4 文件 / 36 测试。
- `task13-29-regression.log`：新增真实图片的 ready、show、缺图断言及 settings 测试命名澄清，4 文件 / 31 测试。

最终执行命令（全部退出 0）：

```bash
pnpm test
pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts src/components/game/lighting src/composables/__tests__/scene-lighting.spec.ts src/components/settings/lighting/__tests__/quality.spec.ts src/stores/modules/settings/__tests__/lighting-quality.spec.ts
pnpm typecheck
pnpm build
```

对应原始日志：`task13-final-test.log`（16 / 119）、`task13-final-focused.log`（5 / 51）、`task13-final-typecheck.log`、`task13-final-build.log`。
