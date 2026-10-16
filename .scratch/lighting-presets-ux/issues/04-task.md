# 04 — 选择光影预设默认折叠

**What to build:** 设置页及编辑器共享默认折叠规则；刷新/收藏/排序/语言切换保留用户展开状态；折叠不取消光影；键盘可操作。

**Blocked by:** Task 1

**Status:** completed

**Baseline:** `a12709a91edea99be40f23fee18506b44932df03`；仅 #888 本轮 Task 4 获授权，不涉及旧 #846/#874 同号任务。

**Contract:** `C:/Users/INTRIGUED/lingchat-2p5d-v1/presets-ux-followup/task4/TASK4-CONTRACT.md`。默认折叠是新挂载规则；同一实例保留用户展开状态，不新增跨重启展开偏好。

- [x] 用户可见行为符合上述交付契约
- [x] 真实针对性测试与所需类型/构建检查通过
- [x] 父代理复验，范围外工作原样保留

## 已验证交付

- 代码提交：`922299a11f276e53a126d11b5f2f9e5730379ef5`。产品仅移除共享选择器原生 details 的静态 open，不增加状态存储、键盘代理、后端或渲染逻辑。
- 新挂载的设置页和编辑器预设选择区默认折叠；用户在同一实例选择的开/关状态跨列表迟到、刷新、收藏成功/失败/重试、应用成功/失败/重试、搜索、共享排序和四语切换保持。关闭再打开保留查询、排序、已编辑草稿与预设来源。
- 折叠只改变 UI，不应用/重置/保存光影，不记最近使用，不清空草稿；折叠期间仍加载列表并提供来源信息。两个实例独立展开；新挂载或页面 reload 重新折叠，不承诺展开偏好跨重启持久化。编辑器外层折叠规则未变。
- 新增 15 个单测用例。一项默认折叠真实 RED→GREEN，其余已有状态保留首次绿色如实记 FIRST-GREEN；两项旧 open-first 测试改为显式用户展开，保留原断言。原失败和夹具修复证据未覆盖。
- 父代理提交树 focused 18 个文件 **311/311**，全量 47 个文件 **591/591**，vue-tsc、仓库外输出的前端生产构建均通过。Task4 无 Rust 改动，未把旧 Task3 的 Rust 结果当本轮复跑。
- 相同最终 harness 基线 **1373/1430**（57 个真实默认展开 RED），提交树 **1430/1430**；断言名全部唯一，24 cells（三真实生产宿主×四语×1280/520），48 截图，0 browser/setup error。真实鼠标、Tab/Enter/Space、焦点轮廓、折叠后后代 Tab 排除、草稿独立/保留和新页面默认均覆盖。
- 浏览器加载的 64 个生产源码 hash 与提交树逐文件一致，未提交/提交后两轮源码快照一致；自有 Edge/服务器/端口/profile 清理验证通过，未连接受保护端口。审阅日文窄屏折叠编辑器及英文宽屏展开设置页截图。
- 浏览器 IPC、非 settings stores 和 preview 明确为夹具，不宣称 native GUI、跨 WebView、GPU/Live2D 画质、性能或原生持久化验收。未重建/改动用户当前测试包。既有 locale fixture、Vite 分包和 Node deprecation 警告保留。
- `.hermes/issues/`、依赖、hooks 和配置 hash 不变；仅父代理显式白名单本地提交，等价格式化 hook 未改源码字节。无 push/PR/远程 Issue/reset/clean/用户窗口操作；Task 5–10 未开始，旧 #846/#874 剩余验收不变。
- 证据：`C:/Users/INTRIGUED/lingchat-2p5d-v1/presets-ux-followup/task4/VERIFIED.json`；公开人工阶段摘要为同目录 `ISSUE-STAGE-SUMMARY.md`。
