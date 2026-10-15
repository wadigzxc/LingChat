# 03 — 最近成功使用与持久化

**What to build:** 成功应用或编辑器成功保存后记录，预览/取消/失败不记录；最近优先排序重启保留；验证同锁事务与事件边界。

**Blocked by:** Task 2

**Status:** completed

**Frozen baseline:** `9232545be9eeec2f3703248ca322527cd2f30eb5`。本轮仅 Task 3；冻结契约和证据在仓库外 `presets-ux-followup/task3/`。

- [x] 用户可见行为符合上述交付契约
- [x] 真实针对性测试与所需类型/构建检查通过
- [x] 父代理复验，范围外工作原样保留

## 已验证交付

- 产品/测试提交：`ff259e4bd2c213db5cfa088ca99f7d32d90cd603`；Task 4–10 未开始。
- 内置与自建预设的成功手动/AI 应用、场景 create/update 与保存当前默认记录最终来源；预览、选择草稿、取消、失败、收藏及管理器 CRUD/import 不抢记，也不擦除权威历史。
- 编辑器同值保存通过 `lighting_save_intent:true` 记一次成功，不把 temporary runtime 擅自变成默认；普通后台元数据更新不传该意图。缺失/删除/空来源不伪造 usage，不阻止合法场景保存。
- catalog 原子文件独立保存 recent 元数据，兼容旧数组及 version-1 favorites catalog；重复成功使用有严格持久顺序。最近排序兼容旧秒精度、offset、微秒/纳秒及稳定名称/ID 回退。
- 排序偏好沿真实 settings Pinia 持久化链保存，设置页/编辑器共享，app 重建及真实 Page.reload 恢复；成功后刷新不 remount 或抹掉草稿，卸载晚到成功/失败均有保护。
- 父代理提交树：前端 46 文件 **576/576**，focused 17 文件 **296/296**；vue-tsc 与 Vite production build 通过。Rust `cargo check --tests` 及全库 **318/318** 通过。
- 父代理提交树真实 Edge **312/312**，四语×宽窄×三个 production hosts，鼠标/键盘、同值保存失败/重试、共享排序和 reload；24 截图，0 browser/harness 错误。相同 harness 基线的 11 RED 全转 PASS；自有浏览器/服务器/profile 清理通过，冻结源码 hash 与被提交源码一致。
- Rust tmpdir 重建验证持久化、旧格式、同锁 interleavings、真实 Windows replacement failure/字节保留/清理/重试；浏览器 native authority 为明确 IPC fixture，不冒称完整原生 GUI、跨 WebView、画质或 FPS。
- 失败边界：发布失败不记 usage，但既有 runtime/scene 可已提交；usage 落盘失败报错、catalog 原字节保留，前置效果不宣称全局回滚。不存在跨 scenes/catalog/广播的全局原子事务。
- 两个集成代理因 HTTP429 中断，父代理恢复其已有 5 组真实 RED→GREEN 和完整浏览器证据，重新复跑当前及提交树；未把失败委派改称成功。既有 Rust 7 警告、locale fixture fallback、Vite 分包及 Node deprecation 警告保留。
- 证据：`C:/Users/INTRIGUED/lingchat-2p5d-v1/presets-ux-followup/task3/VERIFIED.json`。未 push/PR/写远程 Issue/reset/clean；原 `.hermes/issues/`、Hook、依赖及配置字节不变。未操作用户窗口、49193、正式数据或当前测试包。
