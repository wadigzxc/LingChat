use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::utils::atomic_file::atomic_replace_file;

#[allow(unused_imports)]
pub use super::lighting::{
    AmbientParams, AssetFit, AssetPlacement, BlendMode, BloomParams, FilterParams, LightShape,
    LightingAssetLayer, LightingParams, LightingTarget, MainLightParams, RimLightParams,
    VignetteParams,
};

/// 用户创建的场景：名称 + 描述 + 背景图片 + 光影参数。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub description: String,
    pub background: String,
    #[serde(default)]
    pub lighting: Option<LightingParams>,
    #[serde(default)]
    pub lighting_preset_id: Option<String>,
    #[serde(default)]
    pub lighting_preset_revision: Option<u32>,
    #[serde(default)]
    pub lighting_customized: bool,
    pub created_at: String,
    pub updated_at: String,
    /// 该场景来自哪个插件（None = 游戏自有 / 用户上传场景）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<String>,
}

/// JSON 文件存储，路径为 `<data_dir>/game_data/scenes.json`。
pub struct SceneStore {
    path: PathBuf,
}

impl SceneStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("game_data").join("scenes.json"),
        }
    }

    fn ensure_dir(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Ok(())
    }

    pub fn load_all(&self) -> Result<Vec<Scene>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let content = std::fs::read_to_string(&self.path)
            .with_context(|| format!("读取场景文件失败: {:?}", self.path))?;
        let scenes: Vec<Scene> = serde_json::from_str(&content)
            .with_context(|| format!("解析场景 JSON 失败: {:?}", self.path))?;
        Ok(scenes)
    }

    pub fn save_all(&self, scenes: &[Scene]) -> Result<()> {
        self.ensure_dir()?;
        let content = serde_json::to_vec_pretty(scenes)?;
        atomic_replace_file(&self.path, &content)
            .with_context(|| format!("写入场景文件失败: {:?}", self.path))?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<Scene>> {
        Ok(self.load_all()?.into_iter().find(|s| s.id == id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_scene_defaults_lighting_source_metadata() {
        let scene: Scene = serde_json::from_str(
            r#"{
                "id":"old",
                "name":"Old scene",
                "description":"",
                "background":"old.png",
                "created_at":"2026-01-01T00:00:00Z",
                "updated_at":"2026-01-01T00:00:00Z"
            }"#,
        )
        .unwrap();

        assert!(scene.lighting.is_none());
        assert!(scene.lighting_preset_id.is_none());
        assert!(scene.lighting_preset_revision.is_none());
        assert!(!scene.lighting_customized);
    }
}
