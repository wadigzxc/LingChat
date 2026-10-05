# Task13 验证摘要

## 交付状态与范围

- 分支：`feat/846-scene-lighting-v1`；基准 HEAD：`104b55368326671e77b3ef444ee6b4cc7d91fe2f`，未提交、未暂存、未 push。
- 只接入 Task13。未改 Rust、package/lockfile、预设管理、场景编辑弹窗、背景设置页；未改 Task12 组件；`.hermes/issues/` 保留不动。
- 主窗口、投屏、试玩共享 compiler / LightingOverlay / LightingAssetStack / StaticCharacterLightingFrame / FinalLightingOverlay，删除正式组件旧本地 filter / gradient 拼接。

## 文件清单

修改：

- `src/components/game/standard/GameBackground.vue`
- `src/components/game/standard/GameRoleAvatar.vue`
- `src/components/game/standard/GameRolesStage.vue`
- `src/components/game/standard/index.ts`
- `src/components/views/MainChat.vue`
- `src/components/views/CastWindow.vue`
- `src/components/script-editor/preview/PreviewStage.vue`
- `src/stores/modules/settings/index.ts`（仅默认值及 DisplaySettings 类型新增 simplifiedLighting）

新增实现：

- `src/composables/useSceneLighting.ts`
- `src/components/settings/lighting/LightingQualityToggle.vue`

新增测试与验证记录：

- `src/components/game/standard/__tests__/task13.spec.ts`
- `src/composables/__tests__/scene-lighting.spec.ts`
- `src/components/settings/lighting/__tests__/quality.spec.ts`
- `src/stores/modules/settings/__tests__/lighting-quality.spec.ts`
- 本文件及 `Task13-TDD记录.md`

## 接口与消费链

`provideSceneLighting()`：正式宿主 setup 中调用一次，提供同宿主共享上下文。返回：

- `lighting: ComputedRef`：只读消费 `game.activeLighting`，不回写参数或 revision，不读取 currentScene 代替运行时权威镜像。
- `simplified: ComputedRef<boolean>`：消费 `settings.display.simplifiedLighting`。
- `options`：宿主侧 `CSS.supports("mix-blend-mode", "plus-lighter")` 探测并向 compiler / 所有共享层注入 `supportsPlusLighter`。
- `resolveAsset(layer)`：同步查询响应式已解析 URL；初始未解析返回 undefined，IPC 结束后共享组件自动重算 DOM。

`useSceneLighting()`：背景和角色 inject 宿主上下文；组件独立挂载时才建立自身 scope，方便已有独立调用和 DOM 测试。

资产链：严格 64 位小写 hex hash → 已有 `resolveLightingAsset(hash)` API / `resolve_lighting_asset` IPC → 返回 hash 对应、supported、无 warning、受控绝对本地路径且无 `..` → `convertFileSrc(path)` → 同宿主 hash URL 缓存。hash 不当 URL、不猜协议；在途请求去重、过期响应丢弃、卸载后的响应不转换；IPC 或转换失败只跳过素材，参数光效保留。缓存作用域为宿主生命周期，不新增全局资源框架。

兼容告警沿用 `ui.showNotification`，`add` 不支持时交给 compiler 降为 screen；同 WebView 模块生命周期只提示一次。质量变化仅裁剪渲染，不更改 activeLighting / lightingRevision。

开关在 MainChat 的现有 `#menu-panel` 中，通过带 label 的原生 checkbox 更新 `settings.update("display.simplifiedLighting", value)`；默认 false。沿用既有 Pinia persist 的 `lingchat-settings`，旧设置缺字段补默认、新 store 恢复持久化值。三宿主均消费同名设置，简化时关闭 bloom 和 PNG，保留环境色、主光、rim、暗角、色彩校正。未新增设置页或预设入口。

## 层级与 Live2D 边界

- 背景根 slot z=0；内部固定 image/filter → Background/Behind → ambient/main/bloom → Background/Front。
- Overall/Behind z=1；角色舞台 z=2；Overall/Front（含 Both 的单次 main/bloom）z=3；Final 内 PNG 后为 vignette；dialog z=4，原有菜单/其他 UI 保留更高层。
- PNG 的 z_index=0..7 只在隔离 placement slot 内排序，不能逃到 dialog/UI 之上。Both 是整体单槽，不是背景/角色 wildcard。
- 静态角色 frame 内固定 Character/Behind → visual（滤镜）→ directional → Character/Front；原有位置、scale、transition、动画类和互动布局保留。bubble/effects/TouchAreas 不进入滤镜 visual。
- Live2D 本体仍在独立共享 canvas，不做角色调色。ready 的静态 fallback display:none 时无角色滤镜/角色层；not-ready 仅在 role.show 且存在 fallback URL 时施光。
- 真实 `ImageAcrossFade` DOM 测试发现空 URL 会保留旧帧。先 RED（仍检测到 fallback.png），后仅在 GameRoleAvatar 对“有图 ↔ 缺图”边界切换 presentation key，清掉残帧，避免旧图可见但关闭光影；未重写图片或 Task12 组件。普通非空 URL 切换仍沿用现有交叉淡入。

## 实跑结果与 TDD 证据

- 全量基线：12 文件 / 88 测试。
- 最终 `pnpm test`：16 文件 / 119 测试通过，新增 31 测试。
- 最终专项（Task13 + Task12 共享层）：5 文件 / 51 测试通过。
- Task13 自身四个测试文件：31 测试；其中宿主 DOM 测试 15、composable DOM 测试 14、开关 1、持久化 1。
- `pnpm typecheck`、`pnpm build` 均退出 0。
- 变更/新增源码、测试、文档共 16 文件的 `prettier --check` 通过；`git diff --check` 通过，8 个新增未跟踪文件逐个 `git diff --no-index --check` 无空白错误。检查中文文件名时改用 `git ls-files -z`，避免 core.quotepath 的引号转义被误当真实路径。

逐行为 23 个 RED→GREEN 周期及命令、失败信息、通过计数见 [Task13-TDD记录.md](./Task13-TDD记录.md)。不把首次就绿的附加回归冒充 RED。第 07 / 24 轮虽然断言显示通过，但 Vitest 有 unhandled rejection，明确作为失败并修复。第 12 / 19 轮测试 mock 问题先修正并重跑有效 RED，再改生产实现。

可复跑命令：

```bash
pnpm exec vitest run src/components/game/standard/__tests__/task13.spec.ts src/components/game/lighting src/composables/__tests__/scene-lighting.spec.ts src/components/settings/lighting/__tests__/quality.spec.ts src/stores/modules/settings/__tests__/lighting-quality.spec.ts
pnpm test
pnpm typecheck
pnpm build
```

## 告警与未验证边界

- 最终 Vitest 无 Vue watcher 错误、未处理拒绝或失败；输出有 Vitest transform 缓存性能提示。
- 构建仍有 settings 静态/动态 import 混用、chunk 超过 500 kB 告警；未扩范围更改拆包或依赖。
- 真实 mount 的是宿主、共享光效层、正式角色 presentation；外部 Live2D/Pixi、IPC、对话业务和不相关 UI 做 mock。多数图片测试使用受控 stub，但额外测试挂真实 ImageAcrossFade，mock 浏览器 Image 加载，验证实际 background-image / v-show / frame opacity。
- jsdom 证明的是 DOM、CSS 声明、slot 顺序与边界，不是最终像素效果；未在真机 WebView 验收混合模式视觉、GPU bloom/rim 外观、Live2D 实体模型、真实 PNG 加载或触摸点击效果。
- 多 WebView 的 localStorage 持久化恢复沿用原机制；没有新增实时 storage-event 同步框架，也未真机验证已打开的独立投屏 WebView 会随主窗口开关立即更新。该项不冒充已验证。
- 父代理仍需在最终提交/提交钩子之后复跑门、提交并更新 Issue846 Task13 checkbox；本代理没有执行上述 Git/GitHub 写操作。
