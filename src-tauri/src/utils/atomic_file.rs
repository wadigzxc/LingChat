use std::io::Write;
use std::path::Path;

use anyhow::{Context, Result};

pub fn atomic_replace_file(path: &Path, bytes: &[u8]) -> Result<()> {
    atomic_replace_file_inner(path, bytes, || Ok(()))
}

#[cfg(test)]
pub(crate) fn atomic_replace_file_with_hook<F>(
    path: &Path,
    bytes: &[u8],
    before_replace: F,
) -> Result<()>
where
    F: FnOnce() -> Result<()>,
{
    atomic_replace_file_inner(path, bytes, before_replace)
}

fn atomic_replace_file_inner<F>(path: &Path, bytes: &[u8], before_replace: F) -> Result<()>
where
    F: FnOnce() -> Result<()>,
{
    let parent = path
        .parent()
        .with_context(|| format!("目标路径没有父目录: {path:?}"))?;
    std::fs::create_dir_all(parent).with_context(|| format!("创建目标目录失败: {parent:?}"))?;

    let mut temp = tempfile::Builder::new()
        .prefix(".atomic-")
        .tempfile_in(parent)
        .with_context(|| format!("创建同目录临时文件失败: {parent:?}"))?;
    temp.write_all(bytes)
        .with_context(|| format!("写入临时文件失败: {:?}", temp.path()))?;
    temp.flush()
        .with_context(|| format!("刷新临时文件失败: {:?}", temp.path()))?;
    temp.as_file()
        .sync_all()
        .with_context(|| format!("同步临时文件失败: {:?}", temp.path()))?;

    before_replace()?;

    let temp_path = temp.into_temp_path();
    replace_path(temp_path.as_ref(), path)?;
    sync_parent(parent)?;
    Ok(())
}

#[cfg(windows)]
fn replace_path(source: &Path, target: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;

    use windows::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    use windows::core::PCWSTR;

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .with_context(|| "原子替换目标文件失败")?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_path(source: &Path, target: &Path) -> Result<()> {
    std::fs::rename(source, target)
        .with_context(|| format!("原子替换目标文件失败: {source:?} -> {target:?}"))
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> Result<()> {
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .with_context(|| format!("同步目标目录失败: {parent:?}"))
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) -> Result<()> {
    Ok(())
}
