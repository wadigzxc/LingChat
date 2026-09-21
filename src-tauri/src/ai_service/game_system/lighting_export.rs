//! 把软件当前在用的场景图导出成 Photoshop 能直接打开的 PNG / JPG。
//!
//! 为什么导原图而不是屏幕上看到的样子：调色表这类逐像素换色作用在底图上，背景滤镜
//! 和光效层是之后才叠上去的。截图当底稿会把灯光算第二遍，颜色偏了没法补救。
//!
//! 解码走文件头猜格式，所以软件里的 webp 背景能存成 PS 认得的 PNG / JPG。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 解码前的防御性上限，与 `utils::image` 同一档，避免病态大图把内存吃爆。
const DECODE_GUARD_EDGE: u32 = 16_384;

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 解码一张静态图。格式靠文件头猜，所以 webp / png / jpg 都能吃；尺寸上限是防御性的，
/// 免得误传的病态大图在解码阶段就把内存吃掉。
fn decode_image(path: &Path) -> Result<image::DynamicImage, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读不到图片：{e}"))?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| "认不出这个文件的图片格式（支持 png / jpg / webp）".to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(DECODE_GUARD_EDGE);
    limits.max_image_height = Some(DECODE_GUARD_EDGE);
    reader.limits(limits);
    reader.decode().map_err(|e| format!("解码图片失败：{e}"))
}

// ===== 导出原图给 Photoshop =====

/// 一张要导出的图。`name` 是给她看的文件主干（「背景_夜晚」这种），由前端拼好；
/// `path` 是软件当前真正在用的那个原始文件。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportItem {
    pub path: String,
    pub name: String,
}

/// 一张图的导出结果。逐张报，所以背景导失败也不会连累立绘。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub name: String,
    /// 写出去的文件完整路径；失败为 `None`
    pub saved: Option<String>,
    pub error: Option<String>,
    /// JPG 没有透明通道，带透明的立绘按白底压平时为 true，面板要提醒她一句
    pub alpha_flattened: bool,
}

/// 把软件正在用的原图另存成 PNG / JPG，给她拿去 Photoshop 当调色的底稿。
///
/// 只导原图、不导「画面现在长这样」：调色表是作用在原图像素上的，背景滤镜和光效层
/// 之后才叠上去。拿合成图当底稿，表回到软件里会再叠一次效果，越调越偏。
pub fn export_sources(out_dir: &Path, items: &[ExportItem], format: &str) -> Vec<ExportOutcome> {
    let chosen = match format.to_ascii_lowercase().as_str() {
        "png" => Format::Png,
        "jpg" | "jpeg" => Format::Jpeg,
        other => {
            let reason = format!("不认识的照片格式：{other}");
            return items
                .iter()
                .map(|item| ExportOutcome {
                    name: item.name.clone(),
                    saved: None,
                    error: Some(reason.clone()),
                    alpha_flattened: false,
                })
                .collect();
        },
    };
    if let Err(e) = std::fs::create_dir_all(out_dir) {
        let reason = format!("建不出导出目录：{e}");
        return items
            .iter()
            .map(|item| ExportOutcome {
                name: item.name.clone(),
                saved: None,
                error: Some(reason.clone()),
                alpha_flattened: false,
            })
            .collect();
    }
    items
        .iter()
        .map(|item| export_one(item, out_dir, chosen))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Png,
    Jpeg,
}

fn export_one(item: &ExportItem, out_dir: &Path, format: Format) -> ExportOutcome {
    let fail = |error: String| ExportOutcome {
        name: item.name.clone(),
        saved: None,
        error: Some(error),
        alpha_flattened: false,
    };
    let img = match decode_image(Path::new(&item.path)) {
        Ok(img) => img,
        Err(e) => return fail(e),
    };
    let rgba = img.to_rgba8();
    let has_alpha = rgba.pixels().any(|p| p.0[3] != 255);
    let flattened = has_alpha && format == Format::Jpeg;
    let target = pick_target_name(
        out_dir,
        &item.name,
        if format == Format::Png { "png" } else { "jpg" },
    );

    let encoded = match format {
        // JPEG 存不了透明，按白底压平 —— 跟 PS 自己把带透明的图存成 JPG 的结果一致。
        Format::Jpeg => {
            let rgb = if flattened {
                flatten_on_white(&rgba)
            } else {
                image::DynamicImage::ImageRgba8(rgba.clone()).to_rgb8()
            };
            let mut cursor = std::io::Cursor::new(Vec::new());
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 95)
                .encode_image(&rgb)
                .map(|_| cursor.into_inner())
                .map_err(|e| format!("编码 JPG 失败：{e}"))
        },
        Format::Png => {
            let mut cursor = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(rgba)
                .write_to(&mut cursor, image::ImageFormat::Png)
                .map(|_| cursor.into_inner())
                .map_err(|e| format!("编码 PNG 失败：{e}"))
        },
    };
    match encoded {
        Ok(bytes) => match std::fs::write(&target, &bytes) {
            Ok(_) => ExportOutcome {
                name: item.name.clone(),
                saved: Some(target.to_string_lossy().into_owned()),
                error: None,
                alpha_flattened: flattened,
            },
            Err(e) => fail(format!("写文件失败：{e}")),
        },
        Err(e) => fail(e),
    }
}

fn flatten_on_white(rgba: &image::RgbaImage) -> image::RgbImage {
    let mut out = image::RgbImage::new(rgba.width(), rgba.height());
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let [r, g, b, a] = pixel.0;
        let blend = |c: u8| -> u8 {
            let t = f32::from(a) / 255.0;
            (255.0 + (f32::from(c) - 255.0) * t + 0.5) as u8
        };
        out.put_pixel(x, y, image::Rgb([blend(r), blend(g), blend(b)]));
    }
    out
}

/// 重名就往后缀加 `-2`、`-3`：她可能选到已经放过图的文件夹，不能把原来的盖掉。
fn pick_target_name(out_dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let safe = sanitize_stem(stem);
    let first = out_dir.join(format!("{safe}.{ext}"));
    if !first.exists() {
        return first;
    }
    for i in 2..1000 {
        let candidate = out_dir.join(format!("{safe}-{i}.{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    out_dir.join(format!("{safe}-{}.{ext}", now_millis()))
}

/// 文件主干清洗：去掉路径分隔符、Windows 保留字符和控制字符，限长后兜一个底。
fn sanitize_stem(raw: &str) -> String {
    const BANNED: &[char] = &['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    let cleaned: String = raw
        .chars()
        .filter(|c| !BANNED.contains(c) && !c.is_control())
        .collect();
    let cleaned: String = cleaned
        .trim()
        .trim_end_matches(['.', ' '])
        .chars()
        .take(60)
        .collect();
    if cleaned.is_empty() {
        "场景图".to_string()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===== 导出原图给 PS =====

    fn one(path: &Path, name: &str) -> [ExportItem; 1] {
        [ExportItem {
            path: path.to_string_lossy().into_owned(),
            name: name.to_string(),
        }]
    }

    /// 背景其实是 webp，老版本 PS 打不开，所以导出必须真能解码 webp 再另存。
    #[test]
    fn exports_a_webp_source_as_png_and_jpg() {
        let dir = std::env::temp_dir().join(format!("lingchat_lut_export_{}", now_millis()));
        let out = dir.join("out");
        std::fs::create_dir_all(&out).expect("临时目录");
        let source = dir.join("背景.webp");
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            6,
            4,
            image::Rgb([10, 200, 30]),
        ))
        .save_with_format(&source, image::ImageFormat::WebP)
        .expect("写出 webp 测试图");

        let items = one(&source, "背景_夜晚");
        let png = export_sources(&out, &items, "png");
        let saved = png[0]
            .saved
            .as_ref()
            .unwrap_or_else(|| panic!("PNG 导出应当成功：{:?}", png[0].error));
        assert!(
            saved.ends_with("背景_夜晚.png"),
            "文件名该用前端给的主干：{saved}"
        );
        let back = image::open(saved).expect("导出的 PNG 读得回");
        assert_eq!((back.width(), back.height()), (6, 4));

        let jpg = export_sources(&out, &items, "jpg");
        let saved = jpg[0]
            .saved
            .as_ref()
            .unwrap_or_else(|| panic!("JPG 导出应当成功：{:?}", jpg[0].error));
        assert!(
            saved.ends_with("背景_夜晚.jpg"),
            "换个格式本来就不重名，不该无端加后缀：{saved}"
        );
        assert_eq!(
            &std::fs::read(saved).expect("读回 JPG")[..2],
            &[0xFF, 0xD8],
            "扩展名是 jpg，内容也得真是 JPEG"
        );

        // 同格式再导一次才是真的撞名：要往后缀，不能把上一次导出的图盖掉。
        let again = export_sources(&out, &items, "png");
        let saved = again[0]
            .saved
            .as_ref()
            .unwrap_or_else(|| panic!("第二次 PNG 导出应当成功：{:?}", again[0].error));
        assert!(
            saved.ends_with("背景_夜晚-2.png"),
            "同名要往后缀，不能盖掉上一次导出的图：{saved}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 立绘多半带透明。JPG 存不了透明，只能按白底压平，而且要把这件事告诉她。
    #[test]
    fn flattens_alpha_onto_white_only_for_jpg() {
        let dir = std::env::temp_dir().join(format!("lingchat_lut_alpha_{}", now_millis()));
        let out = dir.join("out");
        std::fs::create_dir_all(&out).expect("临时目录");
        let source = dir.join("立绘.png");
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            2,
            2,
            image::Rgba([20, 40, 60, 0]),
        ))
        .save_with_format(&source, image::ImageFormat::Png)
        .expect("写出带透明的测试图");

        let items = one(&source, "立绘");
        let png = export_sources(&out, &items, "png");
        assert!(!png[0].alpha_flattened, "PNG 保得住透明，不该报压平");
        let kept = image::open(png[0].saved.as_ref().expect("PNG 应当导出成功"))
            .expect("导出的 PNG 读得回")
            .to_rgba8();
        assert_eq!(kept.get_pixel(0, 0).0, [20, 40, 60, 0], "透明要原样带过去");

        let jpg = export_sources(&out, &items, "jpg");
        assert!(jpg[0].alpha_flattened, "带透明存 JPG 要报「已按白底压平」");
        let flat = image::open(jpg[0].saved.as_ref().expect("JPG 应当导出成功"))
            .expect("导出的 JPG 读得回")
            .to_rgb8();
        assert_eq!(flat.get_pixel(0, 0).0, [255, 255, 255]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 格式不认识、图读不到，都只该废掉那一张，不能整个动作一起失败。
    #[test]
    fn reports_per_item_errors_without_losing_the_other_images() {
        let dir = std::env::temp_dir().join(format!("lingchat_lut_partial_{}", now_millis()));
        let out = dir.join("out");
        std::fs::create_dir_all(&out).expect("临时目录");
        let source = dir.join("立绘.png");
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 2, image::Rgb([7, 7, 7])))
            .save_with_format(&source, image::ImageFormat::Png)
            .expect("写出测试图");
        let items = [
            ExportItem {
                path: dir.join("没有这个文件.png").to_string_lossy().into_owned(),
                name: "背景".to_string(),
            },
            ExportItem {
                path: source.to_string_lossy().into_owned(),
                name: "立绘".to_string(),
            },
        ];

        let bad_format = export_sources(&out, &items, "tiff");
        assert!(
            bad_format.iter().all(|o| o.error.is_some()),
            "不认识的格式要逐张说清楚"
        );

        let missing = export_sources(&out, &items, "png");
        assert!(missing[0].error.is_some(), "读不到的那张要报错");
        assert!(missing[1].saved.is_some(), "另一张不能跟着失败");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
