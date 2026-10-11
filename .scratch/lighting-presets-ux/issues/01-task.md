# 01 — 列表去重与四语显示

**What to build:** 共享选择器显示一个当前语言名称、一句说明及去重分类；别名仅供搜索；内置元数据简中/繁中/英/日响应切换，自建名称说明不翻译；现有选择/草稿隔离保持。

**Blocked by:** 无

**Status:** completed

- [x] 用户可见行为符合上述交付契约
- [x] 真实针对性测试与所需类型/构建检查通过
- [x] 父代理复验，范围外工作原样保留

## 验证闭环

- 产品/测试提交：`c1e7a41e2d1259feb56fa8d44eb42650d5700b58`。
- 提交树父代理全量：43 文件、526/526 测试通过；TypeScript 检查及 Vite production build 通过。
- 独立真实 Edge 共享选择器：453/453 检查通过；四语、1280/520 布局/命中、鼠标/Tab/Enter、隐藏别名搜索、本地化搜索、安全高亮与草稿数据隔离。
- 真浏览器宿主/DTO/IPC/store 为明确夹具，不代表 native、Rust 持久化、画质或性能验收。
- 证据：`C:/Users/INTRIGUED/lingchat-2p5d-v1/presets-ux-followup/task1/`；跟踪：GitHub #878。
- 3 个旧测试的非真实翻译键已对齐真实后端 `lighting.presets.moonlight`，未放宽行为断言。
- Task 2–10 未开始；当前用户窗口/测试包未改，未 push/PR；无 reset/clean；原未跟踪 `.hermes/issues/` 原样保留。
- 子代理首轮 pnpm 自动依赖检查触发一次复用包及 prepare，已记录；后续使用本地 Node CLI，无 tracked 依赖/Hook 配置改动。
