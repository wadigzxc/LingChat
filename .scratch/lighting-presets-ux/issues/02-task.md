# 02 — 收藏与持久化

**What to build:** 选择器独立星标支持内置和自建收藏；星标不触发应用；使用独立元数据持久化，不复制内置预设、不开放内置参数修改；收藏优先仍显示其他项。

**Blocked by:** Task 1

**Status:** completed

**Frozen baseline:** `55836d5954018f00784dafc286a1356928ff7e07`。本轮仅 Task 2；API、旧格式兼容与单原子文件持久化契约见仓库外 `presets-ux-followup/task2/TASK2-CONTRACT.md`。

- [x] 用户可见行为符合上述交付契约
- [x] 真实针对性测试与所需类型/构建检查通过
- [x] 父代理复验，范围外工作原样保留

## 已验证交付

- 产品/测试提交：`8d7d7ee9c172158f0e47332c0b4188ba60a64cbe`；Task 3–10 未开始。
- 内置及自建预设独立收藏/取消，星标不应用光影、不选择预设、不弄脏编辑草稿、不更改效果 revision 或最近使用；管理器旧草稿保存不覆写收藏。
- 选择器/管理器/场景编辑器收藏刷新一致，不 remount 或丢失未保存内容。失败保持原状态可重试，pending 防重复，卸载晚到成功/拒绝不弹提示。
- 元数据单独保存在版本 1 catalog：`{version:1, users:[...], favorites:{id:bool}}`；用户记录不保存 favorite，内置不复制效果。旧顶层数组只读兼容，成功写时原子迁移；旧客户端不承诺读新版 local catalog，`.linglight` 格式不变。
- 真实 Rust tmpdir 重建 Store：true/false、幂等、旧数据迁移、Windows 替换失败字节保留/重试、CRUD/import 并发互斥及归档回归通过。
- 父代理提交树：前端 44 文件 547/547；focused 8 文件 212/212；Rust 全库 295/295；vue-tsc、Vite build、cargo check --lib、范围内格式检查通过。
- 父代理提交树真实 Edge：1,285/1,285；四语、1280/520、实际鼠标/Tab/Enter/Space、失败重试及卸载保护；25 截图，0 browser/工具错误，冻结 source hash 一致，自有浏览器/服务/profile 清理通过。
- Browser IPC/DTO/store/宿主是明确 fixture；Rust 磁盘持久性单独验证；不宣称完整 native GUI、跨 WebView 同步、渲染画质或性能，不创建/操作用户当前测试包。
- 首次父代理 typecheck 捕获新测试 Array.at 超出既有 TS lib；仅改为等价 index，保留失败日志后复验通过，未提高 TS target。既有 7 Rust 警告及 Vite 分包/locale fixture 警告保留。
- 证据：`C:/Users/INTRIGUED/lingchat-2p5d-v1/presets-ux-followup/task2/`；跟踪 Issue #878。未 push/PR/reset/clean；原 `.hermes/issues/` 及原 Hook 字节不变。
