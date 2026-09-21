//! Photoshop「导出颜色查找表」产出的 `.cube`：解析、入库，以及把它烘进静态图片。
//!
//! 为什么在后端算而不是在前端 canvas 里算：背景与立绘是以 CSS 背景图渲染的，
//! 而 asset 协议送出的图与页面不同源，画进 canvas 会污染画布、读不回像素。调色表
//! 和图都是静态的，那就一次烘成一张缓存图，渲染层只需要换个文件路径——真 3D LUT，
//! 不用改任何渲染架构。
//!
//! 生效范围是「逐像素的颜色替换」，所以它作用在底图上、混合光层之下：先染底图，
//! 再打光，跟 PS 里所见的那张合成图对得上。

use std::path::{Path, PathBuf};
use std::sync::{LazyLock, OnceLock, RwLock};

use image::GenericImageView as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

/// 网格点上限。PS 允许导到 256，但 256³ 的表要占 200MB 内存，画质上早已看不出差别。
/// 使用说明里让她按 64 导出，这里给一点余量。
const MAX_LUT_GRID: usize = 65;
/// 单边像素上限：超过这个尺寸的图多半是误传，烘一次要几十秒还吃掉几百 MB。
const MAX_IMAGE_EDGE: u32 = 8192;
/// 解码前的防御性上限，与 `utils::image` 同一档，避免病态大图把内存吃爆。
const DECODE_GUARD_EDGE: u32 = 16_384;

static LUT_LIBRARY: LazyLock<RwLock<Vec<LutInfo>>> = LazyLock::new(Default::default);
static LUT_INDEX_FILE: OnceLock<PathBuf> = OnceLock::new();
static LUT_STORE_DIR: OnceLock<PathBuf> = OnceLock::new();
static LUT_CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

// ===== 调色表本体 =====

/// 已解析的查找表。`data` 按 Adobe 规范的红变化最快顺序存放（索引 = (z·size+y)·size+x）。
#[derive(Debug, Clone)]
pub struct Lut {
    pub size: usize,
    one_dimensional: bool,
    data: Vec<[f32; 3]>,
    domain_min: [f32; 3],
    domain_span: [f32; 3],
}

impl Lut {
    /// 查一个颜色的调色结果。越出 `DOMAIN_MIN/MAX` 的输入按域边界截断。
    pub fn sample(&self, r: u8, g: u8, b: u8) -> [u8; 3] {
        let top = self.size as f32 - 1.0;
        let norm = |c: u8, axis: usize| {
            let v = f32::from(c) / 255.0;
            let x = (v - self.domain_min[axis]) / self.domain_span[axis];
            (x.clamp(0.0, 1.0) * top).min(top - f32::EPSILON)
        };
        let (rx, gx, bx) = (norm(r, 0), norm(g, 1), norm(b, 2));
        if self.one_dimensional {
            // 一维表按通道各自查，互不影响（PS 的曲线类调色导出来就是这种）。
            let at = |channel: usize, x: f32| {
                let lo = x as usize;
                let hi = (lo + 1).min(self.size - 1);
                let t = x - lo as f32;
                self.data[lo][channel] * (1.0 - t) + self.data[hi][channel] * t
            };
            return [to_u8(at(0, rx)), to_u8(at(1, gx)), to_u8(at(2, bx))];
        }
        let (x0, y0, z0) = (rx as usize, gx as usize, bx as usize);
        let (x1, y1, z1) = (
            (x0 + 1).min(self.size - 1),
            (y0 + 1).min(self.size - 1),
            (z0 + 1).min(self.size - 1),
        );
        let (tx, ty, tz) = (rx - x0 as f32, gx - y0 as f32, bx - z0 as f32);
        let at = |x: usize, y: usize, z: usize| self.data[(z * self.size + y) * self.size + x];
        let mut out = [0u8; 3];
        for channel in 0..3 {
            let edge = |y: usize, z: usize| {
                at(x0, y, z)[channel] * (1.0 - tx) + at(x1, y, z)[channel] * tx
            };
            let plane0 = edge(y0, z0) * (1.0 - ty) + edge(y1, z0) * ty;
            let plane1 = edge(y0, z1) * (1.0 - ty) + edge(y1, z1) * ty;
            out[channel] = to_u8(plane0 * (1.0 - tz) + plane1 * tz);
        }
        out
    }
}

fn to_u8(v: f32) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

/// 解析 Adobe `.cube`（IRIDAS / SpeedGrade 规范）。只认逐像素颜色映射需要的部分：
/// `LUT_1D_SIZE` / `LUT_3D_SIZE` / `DOMAIN_MIN` / `DOMAIN_MAX` 与其后的数据行。
pub fn parse_cube(text: &str) -> Result<Lut, String> {
    let mut size_1d: Option<usize> = None;
    let mut size_3d: Option<usize> = None;
    let mut domain_min = [0.0f32; 3];
    let mut domain_max = [1.0f32; 3];
    let mut values: Vec<f32> = Vec::new();

    for (no, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let row = no + 1;
        let mut it = line.split_whitespace();
        let head = it.next().unwrap_or("").to_ascii_uppercase();
        match head.as_str() {
            "TITLE" => {},
            "LUT_1D_SIZE" => size_1d = Some(parse_grid("LUT_1D_SIZE", it.next())?),
            "LUT_3D_SIZE" => size_3d = Some(parse_grid("LUT_3D_SIZE", it.next())?),
            "DOMAIN_MIN" | "DOMAIN_MAX" => {
                let dst = if head == "DOMAIN_MIN" {
                    &mut domain_min
                } else {
                    &mut domain_max
                };
                for slot in dst.iter_mut() {
                    let token = it
                        .next()
                        .ok_or_else(|| format!("第 {row} 行：{head} 缺少分量"))?;
                    *slot = parse_float(token, row, line)?;
                }
            },
            _ => {
                // 数据行：三个 0–1 的浮点数。第一个数已经落在 head 里。
                let second = it.next().ok_or_else(|| bad_row(row, line))?;
                let third = it.next().ok_or_else(|| bad_row(row, line))?;
                values.push(parse_float(&head, row, line)?);
                values.push(parse_float(second, row, line)?);
                values.push(parse_float(third, row, line)?);
            },
        }
    }

    let (size, one_dimensional) = match (size_3d, size_1d) {
        (Some(n), _) => (n, false),
        (None, Some(n)) => (n, true),
        (None, None) => {
            return Err(
                "调色表里没有 LUT_3D_SIZE 或 LUT_1D_SIZE，不是有效的 .cube 文件".to_string(),
            );
        },
    };
    if size < 2 {
        return Err(format!("调色表网格点只有 {size}，至少需要 2"));
    }
    if size > MAX_LUT_GRID {
        return Err(format!(
            "调色表网格点是 {size}，太大了（上限 {MAX_LUT_GRID}）；请在 Photoshop 导出时把品质降到 64 或更低"
        ));
    }
    let expected = if one_dimensional {
        size
    } else {
        size * size * size
    };
    if values.len() != expected * 3 {
        return Err(format!(
            "调色表声明了 {expected} 个色块，实际读到 {} 个；文件可能被截断",
            values.len() / 3
        ));
    }
    let span = [
        (domain_max[0] - domain_min[0]).max(f32::EPSILON),
        (domain_max[1] - domain_min[1]).max(f32::EPSILON),
        (domain_max[2] - domain_min[2]).max(f32::EPSILON),
    ];
    Ok(Lut {
        size,
        one_dimensional,
        data: values.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect(),
        domain_min,
        domain_span: span,
    })
}

fn parse_grid(field: &str, token: Option<&str>) -> Result<usize, String> {
    token
        .and_then(|t| t.parse::<usize>().ok())
        .ok_or_else(|| format!("{field} 后面不是一个整数"))
}

fn parse_float(token: &str, row: usize, line: &str) -> Result<f32, String> {
    token
        .parse::<f32>()
        .map_err(|_| format!("第 {row} 行不是数字：{line}"))
}

fn bad_row(row: usize, line: &str) -> String {
    format!("第 {row} 行不是「R G B」三个数：{line}")
}

// ===== 已导入的调色表库 =====

/// 一条已导入的调色表。名字沿用 PS 里那个文件名，她认得出。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LutInfo {
    pub id: String,
    pub name: String,
    /// 网格点（PS 导出对话框里的「品质」）
    pub size: usize,
    pub imported_at: u64,
}

/// 启动时加载 `<data_dir>/game_data/lighting_luts.json`。
///
/// 与自建预设同样的规矩：文件不存在算正常状态，解析失败只警告——不能让一个坏掉的
/// 调色表把软件启不起来。
pub fn load_library(data_dir: &Path) {
    let game_data = data_dir.join("game_data");
    let _ = LUT_INDEX_FILE.set(game_data.join("lighting_luts.json"));
    let _ = LUT_STORE_DIR.set(game_data.join("lighting_luts"));
    let _ = LUT_CACHE_DIR.set(game_data.join("lighting_lut_cache"));
    let Ok(content) = std::fs::read_to_string(game_data.join("lighting_luts.json")) else {
        return;
    };
    match serde_json::from_str::<Vec<LutInfo>>(&content) {
        Ok(list) => {
            let count = list.len();
            *LUT_LIBRARY.write().expect("调色表库锁被污染") = list;
            tracing::info!("已加载 {count} 个导入的调色表");
        },
        Err(e) => tracing::warn!("调色表索引解析失败，已忽略该文件: {e}"),
    }
}

/// 全部调色表，按导入时间排（后导的排在下面，和预设列表的习惯一致）。
pub fn list() -> Vec<LutInfo> {
    let mut list = LUT_LIBRARY.read().expect("调色表库锁被污染").clone();
    list.sort_by(|a, b| a.imported_at.cmp(&b.imported_at));
    list
}

fn lut_path(id: &str) -> Result<PathBuf, String> {
    let dir = LUT_STORE_DIR.get().ok_or("调色表库还没完成初始化")?;
    // id 一律由本模块生成（`lut_<毫秒>`），仍然挡一道，免得外部拼出 `../`。
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return Err(format!("调色表 id 不合法：{id}"));
    }
    Ok(dir.join(format!("{id}.cube")))
}

/// 从磁盘上的 `.cube` 导入一份调色表。校验通过才落库，坏文件不进库也不留残档。
pub fn import(source_path: &Path, name: Option<&str>) -> Result<LutInfo, String> {
    let text = std::fs::read_to_string(source_path).map_err(|e| format!("读不到这个文件：{e}"))?;
    let lut = parse_cube(&text)?;
    let dir = LUT_STORE_DIR.get().ok_or("调色表库还没完成初始化")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("建调色表目录失败：{e}"))?;

    let fallback = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("未命名调色表")
        .to_string();
    let name = name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&fallback);
    let info = LutInfo {
        id: next_id(),
        name: name.chars().take(40).collect(),
        size: lut.size,
        imported_at: now_millis(),
    };
    std::fs::write(dir.join(format!("{}.cube", info.id)), text)
        .map_err(|e| format!("保存调色表失败：{e}"))?;

    LUT_LIBRARY
        .write()
        .expect("调色表库锁被污染")
        .push(info.clone());
    write_index()?;
    Ok(info)
}

/// 删除一份调色表。引用它的预设会自动退化成「不调色」（查不到 id 就当没有），
/// 所以不必去翻所有预设改参数。这张表烘出来的缓存图一起删掉。
pub fn delete(id: &str) -> Result<(), String> {
    let path = lut_path(id)?;
    let removed = {
        let mut list = LUT_LIBRARY.write().expect("调色表库锁被污染");
        let before = list.len();
        list.retain(|l| l.id != id);
        before - list.len()
    };
    if removed == 0 {
        return Err(format!("找不到调色表：{id}"));
    }
    let _ = std::fs::remove_file(path);
    prune_cache(id);
    write_index()
}

/// 删表时把这张表烘出来的缓存图一起清掉。缓存名以 `<id>_` 开头，所以能按前缀找。
fn prune_cache(lut_id: &str) {
    let Some(dir) = LUT_CACHE_DIR.get() else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let prefix = format!("{lut_id}_");
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn write_index() -> Result<(), String> {
    let Some(path) = LUT_INDEX_FILE.get() else {
        return Err("调色表库还没完成初始化".to_string());
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let list = LUT_LIBRARY.read().expect("调色表库锁被污染").clone();
    let json = serde_json::to_string_pretty(&list).map_err(|e| format!("序列化失败: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("写入调色表索引失败：{e}"))
}

fn next_id() -> String {
    format!("lut_{}", now_millis())
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ===== 烘焙 =====

/// 把调色表烘进一张静态图，返回缓存图的路径。
///
/// `strength` 是「调色前 / 调色后」的混合比例：0 直接回原图（不占缓存），1 全量套用。
/// 缓存名由「原图路径 + 修改时间 + 大小 + 调色表 id + 强度」哈希得到，所以换图、
/// 换表、动强度都会各生一份，旧结果不会被错认成新结果。
pub fn bake(image_path: &Path, lut_id: &str, strength: f64) -> Result<PathBuf, String> {
    if strength <= 0.0 {
        return Ok(image_path.to_path_buf());
    }
    let strength = strength.clamp(0.0, 1.0) as f32;
    let source = lut_path(lut_id)?;
    let text = std::fs::read_to_string(&source)
        .map_err(|e| format!("调色表文件读不到了，请重新导入：{e}"))?;
    let lut = parse_cube(&text)?;

    let meta = std::fs::metadata(image_path).map_err(|e| format!("读不到图片：{e}"))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let cache_dir = LUT_CACHE_DIR.get().ok_or("调色表库还没完成初始化")?;
    let mut hasher = Sha256::new();
    hasher.update(image_path.to_string_lossy().as_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher.update(meta.len().to_le_bytes());
    hasher.update(lut_id.as_bytes());
    hasher.update(strength.to_le_bytes());
    let digest = hasher.finalize();
    // 前缀带调色表 id：删表时能把烘出来的图一并清掉，不然缓存目录只涨不消。
    let key = format!(
        "{lut_id}_{}",
        digest
            .iter()
            .take(6)
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );

    // 扩展名要等看过有没有透明通道才定，所以两种都探一遍。
    for ext in ["jpg", "png"] {
        let candidate = cache_dir.join(format!("{key}.{ext}"));
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let bytes = apply_lut(image_path, &lut, strength)?;
    std::fs::create_dir_all(cache_dir).map_err(|e| format!("建缓存目录失败：{e}"))?;
    let target = cache_dir.join(format!("{key}.{}", bytes.0));
    std::fs::write(&target, bytes.1).map_err(|e| format!("写缓存图失败：{e}"))?;
    Ok(target)
}

/// 解码 → 逐像素查表 → 按强度混合 → 编码。不透明走 JPEG（小得多），带透明走 PNG。
fn apply_lut(image_path: &Path, lut: &Lut, strength: f32) -> Result<(String, Vec<u8>), String> {
    let bytes = std::fs::read(image_path).map_err(|e| format!("读不到图片：{e}"))?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| "认不出这个文件的图片格式（支持 png / jpg / webp）".to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(DECODE_GUARD_EDGE);
    limits.max_image_height = Some(DECODE_GUARD_EDGE);
    reader.limits(limits);
    let img = reader.decode().map_err(|e| format!("解码图片失败：{e}"))?;
    let (w, h) = img.dimensions();
    if w.max(h) > MAX_IMAGE_EDGE {
        return Err(format!(
            "这张图有 {w}×{h}，超过 {MAX_IMAGE_EDGE} 像素上限，换小一点的图再调色"
        ));
    }
    let mut rgba = img.to_rgba8();
    for pixel in rgba.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let [nr, ng, nb] = lut.sample(r, g, b);
        let mix = |src: u8, dst: u8| -> u8 {
            let from = f32::from(src);
            (from + (f32::from(dst) - from) * strength + 0.5) as u8
        };
        pixel.0 = [mix(r, nr), mix(g, ng), mix(b, nb), a];
    }
    let has_alpha = rgba.pixels().any(|p| p.0[3] != 255);
    let mut cursor = std::io::Cursor::new(Vec::new());
    let encoded = if has_alpha {
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| format!("编码 PNG 失败：{e}"))?;
        ("png".to_string(), cursor.into_inner())
    } else {
        let rgb = image::DynamicImage::ImageRgba8(rgba).to_rgb8();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 92)
            .encode_image(&rgb)
            .map_err(|e| format!("编码 JPEG 失败：{e}"))?;
        ("jpg".to_string(), cursor.into_inner())
    };
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 按「红变化最快」的顺序拼一份 2³ 的单位表。
    fn identity_2x() -> String {
        let body = "0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
        format!(
            "TITLE \"identity\"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n{body}"
        )
    }

    #[test]
    fn identity_cube_leaves_colors_untouched() {
        let lut = parse_cube(&identity_2x()).expect("应当解析成功");
        assert_eq!(lut.size, 2);
        assert_eq!(lut.sample(0, 0, 0), [0, 0, 0]);
        assert_eq!(lut.sample(255, 255, 255), [255, 255, 255]);
        assert_eq!(lut.sample(255, 0, 0), [255, 0, 0]);
        assert_eq!(lut.sample(0, 255, 0), [0, 255, 0]);
    }

    #[test]
    fn interpolates_along_red_axis() {
        // 只让红通道随输入红变化，中间值应落在 128 附近。
        let body = "0 0 0\n1 0 0\n0 0 0\n1 0 0\n0 0 0\n1 0 0\n0 0 0\n1 0 0\n";
        let lut = parse_cube(&format!("LUT_3D_SIZE 2\n{body}")).expect("应当解析成功");
        let mid = lut.sample(128, 0, 0);
        assert!((125..=131).contains(&mid[0]), "实际 {mid:?}");
        assert_eq!((mid[1], mid[2]), (0, 0));
    }

    #[test]
    fn one_dimensional_table_respects_domain() {
        // 域收窄到 0.25–0.75：输入 0 落在域起点、255 落在域终点。
        let text = "LUT_1D_SIZE 2\nDOMAIN_MIN 0.25 0.25 0.25\nDOMAIN_MAX 0.75 0.75 0.75\n0.25 0.25 0.25\n0.75 0.75 0.75\n";
        let lut = parse_cube(text).expect("应当解析成功");
        assert_eq!(lut.sample(0, 0, 0), [64, 64, 64]);
        assert_eq!(lut.sample(255, 255, 255), [191, 191, 191]);
    }

    #[test]
    fn rejects_truncated_oversized_and_unparsable_tables() {
        let short = "LUT_3D_SIZE 2\n0 0 0\n1 1 1\n".to_string();
        assert!(parse_cube(&short).unwrap_err().contains("被截断"));
        assert!(
            parse_cube("LUT_3D_SIZE 128\n")
                .unwrap_err()
                .contains("太大")
        );
        assert!(
            parse_cube("# 只有注释\n")
                .unwrap_err()
                .contains("LUT_3D_SIZE")
        );
        assert!(
            parse_cube("LUT_3D_SIZE 2\n0 0\n")
                .unwrap_err()
                .contains("第 2 行")
        );
        let err = parse_cube("LUT_3D_SIZE x\n").unwrap_err();
        assert!(err.contains("LUT_3D_SIZE") && err.contains("整数"), "{err}");
    }

    #[test]
    fn strength_zero_skips_baking() {
        // 强度 0 时不该碰调色表文件，直接回原路径——「显示调色前」就靠这条。
        let path = Path::new("some/background.webp");
        assert_eq!(bake(path, "lut_missing", 0.0).unwrap(), path.to_path_buf());
    }

    /// 红蓝互换的 2³ 表：输入纯红应当出来是纯蓝。
    fn swap_red_blue_2x() -> String {
        let body = "0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n";
        format!("LUT_3D_SIZE 2\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n{body}")
    }

    /// 真的走一遍「解码 → 查表 → 编码 → 落缓存」，只测解析等于没测这条链路。
    #[test]
    fn bakes_a_real_image_into_the_cache_and_prunes_on_delete() {
        let dir = std::env::temp_dir().join(format!("lingchat_lut_bake_{}", now_millis()));
        std::fs::create_dir_all(&dir).expect("临时目录");
        load_library(&dir);

        let source = dir.join("bg.jpg");
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(8, 8, image::Rgb([255, 0, 0])))
            .save(&source)
            .expect("写出测试图");
        let cube = dir.join("swap.cube");
        std::fs::write(&cube, swap_red_blue_2x()).expect("写出调色表");

        let info = import(&cube, Some("红蓝互换")).expect("导入应当成功");
        assert_eq!(info.name, "红蓝互换");
        assert_eq!(info.size, 2);
        assert!(list().iter().any(|l| l.id == info.id));

        let baked = bake(&source, &info.id, 1.0).expect("烘焙应当成功");
        assert!(
            baked.to_string_lossy().contains(&info.id),
            "缓存名应带表 id"
        );
        // 两次编码都是 JPEG，纯色会有几个级的误差，所以按「明显偏蓝」来断言。
        let graded = image::open(&baked).expect("缓存图读得回").to_rgb8();
        let [r, g, b] = graded.get_pixel(4, 4).0;
        assert!(
            b > 200 && r < 60 && g < 60,
            "红应当被换成蓝，实际 {r},{g},{b}"
        );

        assert_eq!(bake(&source, &info.id, 1.0).expect("第二次烘焙"), baked);

        delete(&info.id).expect("删除应当成功");
        assert!(!baked.exists(), "删表要把烘出来的缓存图一起清掉");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
