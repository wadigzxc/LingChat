# Task 12 共享光效组件：接口与验证摘要

## 交付范围

基线：`feat/846-scene-lighting-v1`，`e87e1bc9`。只新增本目录四个 Vue 组件、`index.ts`、`__tests__/lighting.spec.ts` 和本摘要。未改 Task 11 编译器，无 compiler 缺陷修复；未接入 Task 13 宿主/UI/Store，也未改 Rust、package、deps。原有 `.hermes/issues/` 保留。未暂存、提交、push、reset 或 clean。

## 公共接口

从 `@/components/game/lighting` 导入四个组件与 `LightingAssetResolver`。

所有组件接收 `lighting: unknown`（中性/旧 DTO/V2 均走 Task 11），可选 `options: LightingCompileOptions`、`simplified: boolean`（缺省完整）。不依赖 Pinia 或 Tauri，不写 props，不读写持久化。`supportsPlusLighter` 由宿主探测并注入，fallback 告警去重由宿主处理，组件不创建全局日志或监听器。

- **LightingOverlay**：必需 `surface: character | background | both`；只渲染精确目标的 ambient/main/bloom。角色 bloom 已由编译器合入 filter，此组件不会再叠一次。`both` 是单独 overall 槽，不是 wildcard；整体主光/整体 bloom 要通过本组件以 `surface="both"` 单次挂载。此组件刻意为 fragment，不承载宿主槽定位；宿主在一个有尺寸的 relative/isolated 容器内挂载。每层 absolute/inset:0、pointer-events:none、aria-hidden。
- **LightingAssetStack**：必需 `surface`、`placement: behind | front`、`resolveAsset: LightingAssetResolver`。一次挂载只处理一个固定 placement，层内按 z_index 稳定排序，同值保持输入顺序。stack 自身 isolation:isolate；局部 behind=0、front=2，素材 z_index 只能在 stack 内排序。目标不符/非 PNG/零强度由 compiler 排除；resolver 返回 null/undefined/空字符串则省略，不猜 hash URL 或协议。resolver 为同步受信任 URL 缓存读取，由宿主异步解析后更新 props/响应式缓存。
- **StaticCharacterLightingFrame**：可选 `live2d`、`live2dReady`、`fallbackVisible`、`resolveAsset`。默认按静态角色处理；Live2D ready 永不施角色 filter/overlay/PNG，即使 stale fallbackVisible=true；只有未 ready 且 fallbackVisible===true 才按静态图处理。隐藏 fallback 不施光。宿主必须传实际可见状态，不以 fallback URL 是否存在代替。默认 slot 仅放立绘/模型视觉；`accessories` slot 放 bubble/effects/touch 等，不在 filter 节点下。宿主通过 class/style 决定 frame 尺寸、定位、transform；视觉子层 width/height:100%，支持绝对立绘。固定顺序 behind→visual(filter/color/rim/bloom)→角色 ambient/main→front；frame isolation:isolate，visual/effects 局部 z=1，不把 PNG 或气泡一起滤镜。
- **FinalLightingOverlay**：可选 `placement`（缺省 front）、`showVignette`（缺省 true）、`resolveAsset`。只负责该 placement 的 overall/both PNG；暗角仅在 front 且 showVignette=true 出现。不包含 main/ambient/bloom，避免重复合成。behind 单独挂在角色舞台下，front 挂在舞台上、对话框下；整体主光用上面的通用 Overlay 单次挂载。宿主决定屏幕固定槽和与 dialogue/UI 的相对层级，本组件绝不把 z_index 当作全局舞台层级。

简化模式仅 props：关闭所有 PNG 和 bloom，保留色彩、环境色、主光、轮廓光、暗角。开关与持久化留给 Task 13。

## 严格逐行为 RED → GREEN 证据

每轮只新增一个行为测试（barrel 轮仅把已存在 DOM 测试改为公共入口），实际执行 RED 后才写最小组件实现，并执行 GREEN + Task 11 回归。测试是 Vue Test Utils 的真实 DOM mount，不是源码字符串检查。原始日志在：

`C:/Users/INTRIGUED/AppData/Local/Temp/task12-NN-red.log`

`C:/Users/INTRIGUED/AppData/Local/Temp/task12-NN-green.log`

RED 命令（所有轮次相同；均 exit 1）：

```bash
pnpm exec vitest run src/components/game/lighting/__tests__/lighting.spec.ts
```

GREEN 命令（所有轮次相同；均 exit 0）：

```bash
pnpm exec vitest run src/components/game/lighting/__tests__/lighting.spec.ts src/utils/scene-lighting/__tests__
```

01/03/05/09/15 是新增文件缺失导致的 suite/import RED（没有伪称为 assertion RED）；其余轮次均为对应 DOM 行为断言失败。

| 日志轮次 | 行为                                      | 实际 RED 原因                                         | GREEN（含 Task 11 回归） |
| -------- | ----------------------------------------- | ----------------------------------------------------- | ------------------------ |
| 01       | 精确目标主光与单次 both                   | LightingOverlay.vue 不存在，导入解析失败              | 0；24 tests PASS         |
| 02       | 环境色/背景 bloom 与不可交互绝对层        | 找不到 ambient DOM 层                                 | 0；25 tests PASS         |
| 03       | PNG placement 隔离与稳定 z 排序           | LightingAssetStack.vue 不存在，导入解析失败           | 0；26 tests PASS         |
| 04       | 缺失资源省略                              | 无 URL 的 img 仍渲染，true != false                   | 0；27 tests PASS         |
| 05       | 仅视觉 slot 的滤镜/rim/边缘 bloom         | StaticCharacterLightingFrame.vue 不存在，导入解析失败 | 0；28 tests PASS         |
| 06       | 角色固定 behind→visual→effect→front       | 只渲染 visual，缺少固定光层                           | 0；29 tests PASS         |
| 07       | Live2D ready 排除角色光效                 | brightness(1.4) 未被排除，期望 none                   | 0；30 tests PASS         |
| 08       | 可见 fallback 与 ready/隐藏切换           | 可见 fallback 为 none，期望 brightness(1.4)           | 0；31 tests PASS         |
| 09       | Final 仅整体 front PNG 与暗角             | FinalLightingOverlay.vue 不存在，导入解析失败         | 0；32 tests PASS         |
| 10       | Final behind 与暗角只出现一次             | behind 槽得到 overall-front.png                       | 0；33 tests PASS         |
| 11       | 简化 Overlay 保留 ambient/main 关闭 bloom | bloom 仍存在，true != false                           | 0；34 tests PASS         |
| 12       | 简化 PNG 不解析资源                       | img 仍存在，true != false                             | 0；35 tests PASS         |
| 13       | 简化角色保留 rim 去掉边缘 bloom           | 滤镜链多出 drop-shadow(0 0 8px #ffffff)               | 0；36 tests PASS         |
| 14       | 简化 Final 保留暗角关闭 PNG               | img 仍存在，true != false                             | 0；37 tests PASS         |
| 15       | 公共 barrel 接口                          | index 不存在，导入解析失败                            | 0；37 tests PASS         |
| 17       | 绝对立绘 slot 填充宿主边界                | visual width 为空，期望 100%                          | 0；43 tests PASS         |

16 为复用编译器已有行为的纯回归补充，不声称新增行为 RED：精确三个 PNG 目标、disabled/zero-master、add 能力透传及无 IO/持久化副作用，共五个实例；`task12-16-regression.log` exit 0，19 个组件测试通过。17 加入宿主边界后共 20 个组件测试。

## 实跑质量门

- 专项 + 编译器：7 文件 / 43 测试 PASS；组件 20 + 既存编译器 23。
- `pnpm test`：12 文件 / 88 测试 PASS。
- `pnpm typecheck`：exit 0。
- `pnpm build`：exit 0；Vite 既存大 chunk 告警仍在，没有扩大修改范围。
- `pnpm exec prettier --check src/components/game/lighting`：exit 0（含本摘要）。
- `git diff --check` 与全部七个新增文件的 `git diff --no-index --check /dev/null <file>`：没有空白错误；no-index 对新增内容返回 1 属普通 diff 状态，检查输出为空才计为通过。
- 全仓 `pnpm exec prettier --check .`：exit 1，14 个既存文件被提示格式差异；13 个 tracked 文件均未修改（lockfile、6 个 scripts、4 个 src-tauri schema、2 个 screenshots plugin 文档/schema），另一个是任务开始就存在且要求保留的 `.hermes/issues/scene-lighting-v1.md`。本次新增文件没有格式问题，未修复范围外文件。

完整日志：`.../Temp/task12-final-{special,test,typecheck,build,prettier,prettier-global}.log`。最终 `git status --short` 只有原有 `.hermes/issues/` 和本次 `src/components/game/lighting/`，branch/HEAD 保持基线。

## 遇到的问题与边界

- jsdom 中 Vue 自动将 `filter` 前缀化为 `-webkit-filter`，第一次 GREEN 用 `.style.filter` 读到空值；诊断 DOM 确认正确 filter 链已施加。测试改为读取标准或前缀的实际 DOM CSS 声明，而不是改 compiler。诊断日志 `task12-05-green-debug.log` 保留。
- 一次 refactor 把模板注释放在单根元素前，Vue 开发编译会变 fragment、VTU `.element` 指向包装节点，使根 DOM/边界断言失败。已立即撤销这两条顶层模板注释，未削弱断言；回归 `task12-18-green.log` 43 PASS。
- 最初 typecheck/build 检出测试 `get(...).exists()` 的类型约束，以及 `.element.children` 的 unknown 类型。仅修复测试为 `find(...).exists()` 和显式 HTMLElement；初始失败日志 `task12-final-{typecheck,build}-initial-failed.log` 保留，重跑全部门通过。
- 本任务只验证 DOM 结构、样式与响应式切换，不伪称验证 GPU 实际像素合成。主窗口/编辑器/投屏/试玩正式接线、屏幕全局槽定位、资源异步获取与质量开关持久化由 Task 13/15 负责。
