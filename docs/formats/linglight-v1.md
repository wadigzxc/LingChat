---
tags: [LingChat, 文件格式, linglight, 安全]
---

# .linglight V1 格式

## 合同与版本

`.linglight` 是含根 `manifest.json` 和可选透明 PNG 的 ZIP，不是场景包。公共导出规范由 `src-tauri/src/api/lighting_archive/model.rs` 的 `LingLightManifest` / `ManifestAsset` 和 `export.rs` 实际序列化决定。

**包 `version: 1` 与光影 `schema_version: 2` 是两个不同版本。** 前者标记包格式，后者标记当前光影参数模型。旧场景的顶层/嵌套参数迁移不能作为新包导出格式。

## 公共 manifest

最小参数包示例（省略的 V2 参数按 Rust 默认补齐；重建示例写出全部参数）：

```json
{
  "format": "linglight",
  "version": 1,
  "originId": "f30dbfb0-dc3e-4d8a-96a8-730ed9442267",
  "revision": 1,
  "metadata": {
    "name": "Portable Neutral",
    "description": "Rebuildable neutral user preset; no assets.",
    "aliases": ["portable neutral"],
    "tags": ["neutral"],
    "category": "custom"
  },
  "lighting": {
    "schema_version": 2,
    "enabled": false
  },
  "assets": [],
  "futureLayers": []
}
```

| 字段           | 类型与意义                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `format`       | 必须是字符串 `linglight`                                                                                   |
| `version`      | 必须是整数 `1`，未知版本拒绝                                                                               |
| `originId`     | 可空字符串来源身份；缺失也可导入。不是场景 ID，也不等于导入后的本地 ID。实际导出写出来源身份               |
| `revision`     | u32，缺省为 1；导入落库至少为 1；与运行时事件 revision 无关                                                |
| `metadata`     | `name` 必需；`description`、`aliases`、`tags`、`category` 缺省为空。这里只保存可移植预设元数据             |
| `lighting`     | 光影参数对象，snake_case 字段；新导出是 V2 完整参数                                                        |
| `assets`       | 素材声明数组，缺省为空；每项必须匹配一个 `lighting.asset_layers` 项                                        |
| `futureLayers` | 可选扩展数组，缺省为空。当前不支持任何 future layer；每项只有显式 `required: false` 才能警告后走仅参数导入 |

顶层、metadata、assets 及显式提供的 lighting 子字段不能夹带未知字段。归档反序列化还会比较原始值与归一化值，拒绝未知枚举、越界值、非规范颜色等，不像运行时 DTO 可以容错 clamp。导出先正规化参数。

不包含用户内部 favorite、last_used_at、创建/修改时间戳、绝对资源路径、scene/background/角色内容。`ImportInspection.assets[].byte_size` 是 IPC 摘要字段，不是 manifest 的 `bytes`，不能混用。

## 光影字段与枚举

| 参数块                                     | 字段                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 根                                         | `schema_version`、`enabled`、`master_intensity`、`link_character_background`                                   |
| `character` / `background`                 | `brightness`、`contrast`、`saturation`、`sepia`、`glow_radius`、`glow_color`                                   |
| `character_ambient` / `background_ambient` | `enabled`、`color`、`opacity`                                                                                  |
| `main_light`                               | `enabled`、`shape`、`target`、`x`、`y`、`angle`、`radius`、`color_start`、`color_end`、`opacity`、`blend_mode` |
| `rim_light`                                | `enabled`、`color`、`intensity`、`width`、`softness`、`angle`、`offset`                                        |
| `bloom`                                    | `enabled`、`target`、`color`、`radius`、`intensity`                                                            |
| `vignette`                                 | `enabled`、`color`、`intensity`、`radius`、`softness`                                                          |
| `asset_layers[]`                           | `id`、`asset_hash`、`media_type`、`target`、`placement`、`z_index`、`opacity`、`blend_mode`、`fit`、`required` |

枚举 wire 值：

- shape：`radial` / `linear`。
- target：`character` / `background` / `both`。`both` 是单个 overall 槽，不是三份通配。
- blend_mode：`normal` / `screen` / `add` / `overlay` / `soft_light` / `multiply`。CSS 映射和 add capability 降级由共享编译器负责，不修改 wire 值。
- placement：`behind` / `front`。
- fit：`cover` / `contain` / `stretch`。

规范范围来自 `lighting/normalize.rs`：

| 字段                                                                                                             | 范围                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| master_intensity、rim intensity                                                                                  | 0–2                                                           |
| brightness / contrast / saturation                                                                               | 0.3–2.2 / 0.5–2 / 0–2.5                                       |
| sepia、环境 opacity、main x/y/radius/opacity、bloom intensity、vignette intensity/radius/softness、asset opacity | 0–1                                                           |
| glow_radius（整数）                                                                                              | 0–50                                                          |
| rim width/softness/offset、bloom radius                                                                          | 0–64                                                          |
| main/rim angle                                                                                                   | 0–360 度，clamp，不按模数环绕                                 |
| asset z_index（整数）                                                                                            | 0–7，仅槽内排序                                               |
| 颜色                                                                                                             | 小写 `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`，不带两端空格 |

中性默认 `enabled: false`、总强度 1、联动 true；两套 brightness/contrast/saturation 为 1；main radial、both、中心 0.5/0.5、radius 0.8、opacity 0；全部效果 disabled，素材空。完整默认对象可执行重建脚本查看，并由 Rust `LightingParams::default()` 往返断言验证。

## PNG、路径与 digest

推荐且实际导出使用：

```text
manifest.json
assets/<lowercase-sha256>.png
```

素材公共声明是 `id`、`path`、`sha256`、`mediaType`、`bytes`、`width`、`height`、`required`。不是旧 wire 的 `byte_size`，布局信息只在 lighting.asset_layers，不重复进入公共 assets。

- `mediaType` 为 `image/png`；文件扩展名 `.png`、PNG magic、解码、alpha 通道都检查。alpha 通道存在不等于强制每张图必须有非不透明像素。
- `sha256` 是 PNG 原始文件字节的 64 位小写十六进制 digest，不是像素摘要。`bytes` 与实际长度相等，宽高与实际解码相等。
- layer 的 id、asset_hash、media_type、required 与声明相符，层数与声明数相同，asset ID 不重复。
- 导入只接受 `assets/` 下正规化相对路径；同一 hash 首次导出保留 `assets/<sha256>.png`，后续共享该 PNG 的层使用 `assets/<层的一基序号>-<sha256>.png`，每层各有独立声明及 ZIP 条目，层数据不合并。导入校验目前不强制原始文件名必须等于 digest。落库一律变成 `<data>/game_data/lighting_assets/<sha256>.png`，同 hash 仍只保存一份，内容寻址、可复用，不接受包里的绝对地址。
- 拒绝 `..`、`.`、空路径段、NUL、反斜杠、绝对路径、盘符/UNC，拒绝符号链接及特殊条目、原始重复、大小写/尾空格或点归一化冲突。公共素材声明的路径必须本来就是正规化形式。
- 根 manifest 必须唯一；不接受额外未声明文件。ZIP central directory 和实际解压流都校验，不能靠伪造 header 绕过总大小限制。
- 可选未知素材格式也必须验证长度和 digest。必需未知格式拒绝；可选未知格式只允许明确仅参数导入。未知 future layer 同样需要显式 required false，不是因为存在 warning 就自动忽略。

## 默认安全限额

来自 `lighting_archive/limits.rs`，MiB/KiB 使用二进制单位：

| 限额                      | 默认值            |
| ------------------------- | ----------------- |
| 压缩包文件 / 实际解压总量 | 各 100 MiB        |
| 单项压缩比                | 100               |
| manifest                  | 1 MiB             |
| 每张 PNG                  | 20 MiB            |
| PNG 每边                  | 4096 像素         |
| assets / futureLayers     | 各最多 8 项       |
| ZIP entries               | 最多 10           |
| 单个受检查文本            | 16 KiB UTF-8 字节 |
| metadata aliases / tags   | 各最多 64 项      |

压缩比是逐项检查；拒绝损坏 ZIP/PNG、非 alpha PNG、hash/长度/尺寸不一致。源指纹计算和导出 CAS PNG 读取先检查已打开文件的 metadata 大小，再按实际流字节计数限制读取；读取期间增长也拒绝，最多读取上限加 1 字节探测超限，超限字节不交给 hash/素材缓冲。源指纹仍比较 canonical path、size、mtime 和完整 SHA-256。测试覆盖真实文件增长和默认限额加 1 的扩展文件拒绝；不声称执行过满容量性能压测。

## inspect、确认与 commit

前端 API 见 `src/api/services/scene-lighting.ts`，Rust 权威实现见 `lighting_archive/import.rs`、`import_state.rs`。

1. `inspect_linglight({ path })` 验证源 ZIP 到 TempDir，返回 opaque `token`、preset/assets 摘要、warnings、conflicts、`expires_at`。不写正式预设或正式素材目录。默认同时最多 4 个待确认会话，TTL 10 分钟。
2. 用户在对话框明确确认 `keep_both` 或 `overwrite_same_origin`，以及 `parameterOnly`（不是 silent fallback）。检查阶段不允许自动 commit。
3. `commit_linglight_import({ token, strategy, parameterOnly })` 先一次性消费 token，检查 canonical path / size / mtime / 整包 SHA-256 源指纹未变，再在存储事务里重查冲突。错误或重复提交后必须重新 inspect。

`keep_both` 生成新的本地 `user:<UUID>`；冲突时生成唯一名字并 fork 新来源身份，避免后续出现多个同源副本。无冲突保留可移植 originId。`overwrite_same_origin` 要求恰好一个同源用户预设，保留其本地 ID；没有或多个候选、与内置冲突均拒绝。

仅参数导入清除所有素材层和资源引用，并返回警告；它不能绕过 ZIP 安全或必需未知能力。正式素材采用内容寻址及原子写入，预设保存失败不能破坏旧 JSON/共享素材。取消 `cancel_linglight_import({ token })`、过期清理和进程退出释放临时 staging；token 不持久化、不跨重启。

导出只接受用户预设，在目标同目录临时写入再原子替换；失败保留旧目标。单个导出 `export_linglight({ presetId, targetPath })`；批量 `export_linglights({ presetIds, targetDir })` 每个预设一个包、逐项报告错误并清理非法/保留文件名。移动端不开放这组归档操作。

## 只读导入兼容

导入接受早期 V1 的 `preset` / `origin` / `required_capabilities` / `optional_capabilities` 和旧 assets `byte_size` + 重复布局字段，并正规化成公共 V1。重复布局必须与 lighting 层一致，必需/可选能力语义保持；旧 `created_by` 不导出。**这是兼容读入，不是新包编写规范。** 新导出永远使用 metadata、originId、bytes、mediaType、futureLayers。

运行时场景迁移接受无 lighting（保持 null）、旧顶层滤镜、旧 character/background 嵌套格式、当前 V2。归档对显式字段更严格，不保证任何任意旧场景 JSON 都能直接作为公共 manifest 的 lighting 输入。覆盖位置见 [[scene-lighting]] 的兼容表。

## 可重建示例与实际证明

`examples/lighting-presets/neutral.linglight` 仅含根 manifest，来源为独立 UUID，内容为中性用户参数，不绕过 builtin 导出保护。stdlib 脚本不读取应用 data，固定 ZIP timestamp/mode/顺序、使用 ZIP_STORED，输出必须不存在，防止误覆盖。

```bash
python examples/lighting-presets/rebuild-neutral.py --output neutral-rebuilt.linglight
CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=1 cargo test --manifest-path src-tauri/Cargo.toml --lib task18_rebuildable_neutral_fixture_inspect_commit_export_roundtrip
CARGO_BUILD_JOBS=1 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=1 cargo test --manifest-path src-tauri/Cargo.toml --lib api::lighting_archive
```

重建包可按 SHA-256 与仓库包比对；Rust 测试读取仓库真实包，inspect → commit 到独立 tempfile 用户库 → export 到独立 tempfile → validate，并断言中性参数、来源和公共字段，没有运行应用或访问用户库。

> [!NOTE] 证据边界
> Rust 是真实文件/ZIP/PNG/JSON 往返；前端对话框测试用 native picker/IPC mock。Windows 已本机执行；Linux 安全测试已纳入 quality 矩阵但尚未实际执行，GitHub runner 未触发。GPU、真机 Live2D、移动端视觉/性能留给单独验收，不由包往返推出。

## 相关文档

- [[scene-lighting]]

#LingChat #文件格式 #安全 #光影
