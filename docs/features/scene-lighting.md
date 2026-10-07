---
tags: [LingChat, 功能说明, 光影, 兼容回归]
---

# 场景及光影设置

## 使用入口

顶部导航仍叫“背景”，设置区块叫“场景及光影设置”，弹窗叫“编辑场景及光影”。

- 在设置页选择场景，或取消当前场景选择。取消通过 `select_scene(null)` 同步后端，清除背景并恢复中性光影；不会只清空 UI。
- 预设选择器按名称、别名、标签、描述搜索，支持分类、收藏和最近使用排序。内置预设名称按界面语言显示，用户名称原样保留。
- 内置预设为中性、冷色逆光、暖阳侧光、月夜、室内柔光。对应 ID 为 `builtin:neutral`、`builtin:cold-backlight`、`builtin:warm-side`、`builtin:moonlight`、`builtin:indoor-soft`。
- 编辑场景在独立草稿中调整总强度、角色/背景色彩、环境色、单主光、方向性轮廓光、泛光、暗角和 PNG 素材层。预览复用正式画面的样式编译器及共享层组件；按住“原图”只暂时旁路预览效果。
- 联动开关仅联动后续色彩输入，不把启用前的角色/背景差异回填。总强度不改写子参数。
- 草稿切场景、切预设、关闭时保护未保存修改。保存失败保留草稿，不继续待执行的切换。
- 管理器可另存、编辑用户预设、收藏、确认删除、桌面导入和单个/批量导出。内置预设不可更新、删除或直接导出；先另存为用户副本。

## 默认快照与临时状态

场景持久化 `lighting` 参数快照及 `lighting_preset_id`、`lighting_preset_revision`、`lighting_customized`。来源是说明信息，不是渲染时实时查询的引用。

- 更新或删除来源预设不改变已保存场景的像素参数。删除来源后仍能渲染快照，但“恢复来源预设”不可用。
- 选择预设应用到当前运行时，不自动保存场景默认。手调保留来源并标记自定义；“恢复当前场景默认”与“恢复系统中性值”不同。
- “保存为当前场景默认”捕获点击时的场景 ID、完整光影快照和来源；确认后发送显式默认保存意图。相同数值也必须更新来源，普通元数据修改不能覆盖临时光影。
- 无当前场景或插件只读场景不能保存默认。等待保存期间切到别的场景，不把旧场景结果施加到新当前场景。
- `active_lighting`、source、preset ID/revision、customized 与单调 `lighting_revision` 是 Rust 进程内权威状态；前端只镜像。完整事件原子替换，旧/相同 revision 被丢弃，同 ID 也允许新 revision。
- 临时状态不写普通存档或 Pinia localStorage。WebView reload 从仍存活的后端初始化快照取回临时光影；进程重启/普通读档重新从场景默认计算。剧本试玩使用单独的进程内备份，停止试玩还原临时状态并发布新 revision。

## 正式宿主与渲染边界

`MainChat.vue`、`CastWindow.vue`、`PreviewStage.vue` 都使用共享光影组件；不是仅验证一个演示容器。

- `character` 只进入静态立绘槽；`background` 只进入背景槽；`both` 是一次 overall 合成，不是同时复制到角色、背景和 overall。
- 背景、角色各有固定 behind/visual/effects/front 槽。`z_index` 只在同一素材槽内排序，不能越过固定槽改变层级。
- overall behind 在舞台下，overall front PNG 和暗角在舞台上、对话 UI 下。环境色和主光不能重复叠加。`normal` 仍是 normal，不映射为 overlay。
- PNG 使用后端已验证的 hash 地址解析，宿主共享缓存；缺失、失败或过期解析不猜 URL，不保留旧图。
- `add` 根据浏览器 CSS capability 探测，有不支持时的降级提示；自动化覆盖的是决策和 DOM/CSS 声明，不代表 GPU 像素已验收。

### Live2D 与质量矩阵

| 对象 / 模式                               | 完整光影                                         | 简化光影                                   |
| ----------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| 静态角色立绘                              | 色彩、环境、主光、轮廓、泛光、目标 PNG           | 保留色彩、环境、主光、轮廓；关闭泛光及 PNG |
| 正式 Live2D ready 本体                    | 不施加本体滤镜/角色局部光影                      | 同样不施加                                 |
| Live2D 未 ready 且实际可见的静态 fallback | 按静态立绘处理                                   | 按简化静态立绘处理                         |
| fallback 隐藏、URL 缺失，或 Live2D ready  | 不渲染旧 fallback 光影                           | 同左                                       |
| 编辑预览的 Live2D 角色                    | 使用静态 fallback，不挂载 Live2D canvas          | 同左，并使用简化语义                       |
| 背景及 overall                            | 目标槽中的完整效果；overall 仍可能视觉上覆盖模型 | 保留环境、主光和暗角，移除泛光及 PNG       |

MainChat 和设置页的“简化光影”开关共用持久化质量设置，切换不会改场景/预设参数或运行时 revision。移动端完全隐藏 `.linglight` 导入/导出（包括 parameter-only 包），只应用应用内已有的内置或本地参数预设；不是移动端文件导入功能。投屏质量来自窗口的 settings store，不在后端光影运行时 payload 中，不把质量开关冒充光影参数同步。

## AI 工具与权限

- `lighting_list` 仅返回 ID、名称、别名、分类、标签、kind，不暴露完整参数、描述、资源路径或内部时间戳。
- `lighting_switch` 只接受 `preset`：精确 ID 优先，再精确名称/别名，英文 ASCII 大小写不敏感；没有模糊猜测。歧义返回稳定排序候选，不任选一个。
- `lighting_reset` 恢复当前场景默认；无场景则恢复系统中性光影，保留无关背景等运行时信息。
- 沿用 `scene` 工具权限组，必须同时满足调用来源场景组和角色组。关闭场景工具权限后光影工具不可用。
- AI 不编辑参数、不另存或删除预设，不做情绪自动调光。

## 桌面包操作

导入必须遵循 **inspect → 用户明确确认 → commit**。检查只写临时 staging，显示元数据、素材、警告和冲突；取消清理 token，不创建正式预设。确认可选择保留两份、覆盖唯一同源用户预设、明确“仅导入参数”；未知必需能力不能通过该选项绕过校验。详细字段和限额见 [[linglight-v1]]。

示例是独立用户来源的 `Portable Neutral`，内容等价于中性参数，不直接导出内置预设。无场景、背景、角色、绝对路径或秘密。仓库内包含包和 stdlib 重建脚本，输出必须是新路径。

```bash
python examples/lighting-presets/rebuild-neutral.py --output neutral-rebuilt.linglight
cargo test --manifest-path src-tauri/Cargo.toml --lib task18_rebuildable_neutral_fixture_inspect_commit_export_roundtrip
```

## 可执行质量门

在仓库根目录、已有依赖和桌面编译工具链的环境中执行：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
mkdir -p data/.official/game_data data/third_party
node scripts/prepare-desktop-resources.mjs --staging-only
CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=1 cargo check --manifest-path src-tauri/Cargo.toml --tests
CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=1 cargo test --manifest-path src-tauri/Cargo.toml --lib
CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=1 node scripts/ci/check-clippy.mjs
```

`--staging-only` 只准备 Tauri staging，不覆盖用户 `data/data_manifest.json`。原脚本默认模式保留原行为。

两个开发 workflow 的 quality 矩阵覆盖 Windows/Linux，每个 runner 执行冻结安装、前端测试/typecheck/build、资源准备和 Rust `--lib` 全测（含 archive 路径安全）。桌面 `build` 依赖整个 `quality`，保持默认 success 条件；任一平台失败、取消或跳过不能生成发布构建，没有 `continue-on-error` 或 `always()` 绕门。

> [!WARNING] Clippy 不是零告警
> Task 1 的 Clippy 基线未绿，因此不把 `-D warnings` 冒充可通过硬门。当前 Windows 诊断冻结于 `5a1fa0d9e4aadbe69acdfb54c3706d6cd3ee8c35`：246 条 warning 事件、136 种定位签名。`check-clippy.mjs` 显示已知债务并按文件/行/代码/消息/次数比对；编译错误、新签名或超过基线次数硬失败。Linux 未本机执行，其未知诊断同样失败关闭，必须调查后才能调整平台基线，不能通配忽略。

## 兼容回归证据映射

以下路径相对仓库根目录；“已有”不代表 Task18 制造了新 RED。“前端”使用 native IPC/event mock，不能替代 Rust 文件往返或真机测试。

| 合同                                 | 实际测试位置与行为                                                                                                                                                                                                                                                                                              | 证明层                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 无 lighting                          | `src-tauri/src/ai_service/game_system/scene_store.rs::old_scene_defaults_lighting_source_metadata`；`src/components/settings/scene/__tests__/SceneEditModal.spec.ts` 的无 lighting 保存 null                                                                                                                    | Rust serde + 前端草稿                                     |
| 旧顶层 / 当前嵌套 / V2               | `src-tauri/src/ai_service/game_system/lighting/tests.rs` 的 `migrates_legacy_top_level_filters`、`migrates_legacy_top_level_overlay`、`migrates_v1_overlay_to_v2_main_light`、`round_trips_v2_without_loss`                                                                                                     | Rust 迁移/序列化                                          |
| 插件只读                             | `src/components/settings/lighting/__tests__/SettingsBackgroundTask16.spec.ts` 的 plugin default-save 禁止；`src-tauri/src/api/scene.rs::deleting_plugin_scene_never_removes_plugin_background`                                                                                                                  | 前端限制 + Rust 背景保护                                  |
| 当前 None                            | `src-tauri/src/ai_service/game_system/scene_transition.rs::selecting_none_clears_scene_and_applies_neutral_lighting`；`scene_lighting/tests.rs::restoring_without_scene_keeps_background_and_uses_neutral_lighting`；`src/stores/modules/game/__tests__/lighting-state.spec.ts`                                 | Rust transition + 前端 store                              |
| 来源删除/改值                        | `src-tauri/src/api/scene_lighting/tests.rs::deleting_active_source_preset_keeps_runtime_snapshot_metadata`；`SettingsBackgroundTask16.spec.ts`、`SceneEditModal.spec.ts` 的保留 saved pixels / 禁用已删除来源 restore                                                                                           | Rust runtime + 前端快照                                   |
| 参数包/透明 PNG                      | `src-tauri/src/api/lighting_archive/tests.rs`、`tests_export.rs`、`tests_import.rs` 的 validate/inspect/commit/export；新增 `task18_rebuildable_neutral_fixture_inspect_commit_export_roundtrip`                                                                                                                | 真实 ZIP/PNG/tempdir/JSON 文件往返                        |
| 损坏/恶意/超限                       | `src-tauri/src/api/lighting_archive/tests.rs` 的 traversal、normalized collision、symlink、截断/损坏 PNG、hash/size/dimensions、streamed total、ratio、manifest/text/list/layer 限额                                                                                                                            | Rust 安全校验；部分上限注入更小值，非 100 MiB 压测        |
| MainChat / CastWindow / PreviewStage | `src/components/game/standard/__tests__/task13.spec.ts` mount 正式宿主、Final 槽和 teleported PreviewStage                                                                                                                                                                                                      | 真实 Vue 宿主 DOM，native/Live2D 子系统按边界 mock        |
| 乱序/同 ID 三次/晚开投屏             | `src/utils/scene-lighting/__tests__/task18-compat.spec.ts`；`src/components/views/__tests__/cast-lighting.spec.ts`；websocket `script-handler-scene.spec.ts`                                                                                                                                                    | 真前端 reducer/store 组合，投屏镜像函数，不是真跨窗口传输 |
| WebView reload / 重启边界            | `task18-compat.spec.ts` 重载模块后 WebInitData hydrate；`src-tauri/src/api/scene_lighting/tests.rs::web_init_only_restores_scene_on_first_process_initialization`；`game_status.rs::save_snapshot_excludes_runtime_lighting_state`；`scene_transition.rs::save_restore_recomputes_lighting_from_scene_snapshot` | 前端模块模拟 reload + Rust 生命周期逻辑，不是真重启       |
| 试玩临时还原                         | `src/stores/modules/script-editor/__tests__/preview-lighting.spec.ts`；`scene_lighting/tests.rs::preview_backup_restores_temporary_lighting_with_new_revision`                                                                                                                                                  | 前端 stop/generation + Rust backup                        |
| AI 权限开/关                         | `src-tauri/src/ai_service/tools/permissions.rs::lighting_tools_require_enabled_scene_source_and_role_intersection`、`settings.rs::scene_group_controls_all_scene_and_lighting_tools`                                                                                                                            | Rust 权限逻辑                                             |
| AI 精确/别名/歧义                    | `src-tauri/src/ai_service/tools/scene.rs` 的 `lighting_switch_matches_exact_id_before_name_or_alias`、`lighting_switch_matches_exact_name_alias_and_ascii_case_insensitively`、`lighting_switch_reports_stably_sorted_ambiguity_without_selection`                                                              | Rust 匹配，不是真模型聊天                                 |
| CI 失败/取消/矩阵依赖                | `src/utils/scene-lighting/__tests__/ci-quality.spec.ts`，已有 YAML AST 解析器 + 本地依赖 truth table                                                                                                                                                                                                            | 配置结构合同，不是 GitHub 调度器执行                      |
| 移动门 / Live2D                      | `src/composables/__tests__/Task17Mobile.spec.ts`、导入/管理器组件测试、`task13.spec.ts`、`lighting/__tests__/lighting.spec.ts`                                                                                                                                                                                  | mock 平台门及 DOM 状态矩阵，不是真机                      |

> [!NOTE] 验证范围
> 本 Task 的实际本机环境是 Windows。Linux 矩阵已配置但本机 WSL 探测超时，未安装或启动新环境；远程 CI 未 push/dispatch；没有真机视觉、GPU 像素、帧率或移动设备结论。这些不以单测替代，Task19 未实施。

## 相关文档

- [[linglight-v1]]

#LingChat #功能说明 #渲染/光影 #兼容回归
