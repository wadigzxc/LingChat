# 05 — 效果参数组折叠规则

**What to build:** 箭头+组名+启用开关；开自动展开、关收起保参；未启用能手动展开预调、已启用能手动折叠保持效果；重开按启用初始化；公共设置保留外部。

**Blocked by:** Task 4

**Status:** completed

**Baseline:** `3fb6de25b48f446bc8915362ea1bf492d80bbb79`；仅 #888 本轮 Task5，Task6–10未授权。

**Contract:** `C:/Users/INTRIGUED/lingchat-2p5d-v1/presets-ux-followup/task5/TASK5-CONTRACT.md`。完整覆盖9个组出现位置（8条enabled路径）；公共设置与无enabled字段不伪造开关；真实启停与UI展开状态独立。

- [x] 用户可见行为符合上述交付契约
- [x] 真实针对性测试与所需类型/构建检查通过
- [x] 父代理复验，范围外工作原样保留

## 已验证交付

- 产品/测试提交：`40c8fc9157d9168cf28986adaed2b8155c6105e7`。共享 LightingEffectGroup 接入9处（8条enabled路径）；标题箭头和开关为同级控件，body唯一id与aria-controls对应。
- 新挂载按自身启用初始化；真实启停自动展开/收起、参数保留；启用可手动收起保持效果，未启用可手动展开预调且不自动启用。普通参数输入、locale、刷新不复位手动状态，真实关闭重开重新按flag初始化。
- 公共master/link/intensity与角色/背景滤镜保留组外；不为无enabled的ambient/素材层伪造开关，不改schema/renderer/后端。两个bloom视图共享原flag，联动ambient同步，手动折叠独立。missing/null relighting不因挂载或折叠变脏。Task4默认折叠保持。
- 实际纵向RED→GREEN覆盖root、point、Overall、Character、Scene、四语组名和同级控件，FIRST-GREEN回归另记；新增64用例，两项旧结构断言窄迁移。父代理另修新测试fixture缺失BackgroundImageInfo.time，不改产品。
- 提交树focused20文件 **375/375**，前端全量49文件 **655/655**，vue-tsc及仓库外输出前端生产构建通过。原生素材路径fixture的2项测试实际编译运行原Rust解析函数；仅测试子进程使用已安装G盘MSVC和Windows SDK，未改全局环境。无后端改动，未将旧Rust全库结果当本轮复跑。
- 提交树真实Edge **1190/1190**，四语×宽窄×初始启停共16cells，每cell74项、每组5种动作；32截图，断言名唯一，0错误/跳过/未执行。相同最终harness基线149/310、161RED，明确848条下游动作未执行；候选/提交树全部执行，基线所有RED转绿。
- 首候选160个失败为harness把aria-hidden箭头纳入标题字典比较，修正可访问标题提取后，在同一产品源码上重新冻结基线和候选；原失败保留。MSYS同名link.exe、fixture类型缺项及临时缓存清理门问题均记录，没有刷白失败。
- 65份浏览器生产源码hash与提交树及当前文件一致；未提交/提交后快照一致。自有browser/server/端口/profile退出清理通过，测试TMP仅清理自有scratch子目录。受保护文件、初始.hermes/issues/、hook及配置hash保持；仅父代理白名单提交。
- 实际审阅日文窄屏editor与英文宽屏panels截图；preview/IPC/game等为明确fixture，不宣称原生画质、真实Live2D、跨WebView、GPU/性能验收。未重建/改动用户测试包、用户窗口或正式数据；既有警告保留。
- Task6–10未开始，旧#846/#874遗留验收不变；未push/PR/写远程Issue/reset/clean。证据根：`C:/Users/INTRIGUED/lingchat-2p5d-v1/presets-ux-followup/task5/VERIFIED.json`；人工摘要见同目录 `ISSUE-STAGE-SUMMARY.md`。
