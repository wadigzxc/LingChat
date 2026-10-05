use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

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
    mutation_lock: Arc<Mutex<()>>,
}

fn shared_mutation_lock(path: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(path.to_path_buf(), Arc::downgrade(&lock));
    lock
}

impl SceneStore {
    pub fn new(data_dir: &Path) -> Self {
        let path = data_dir.join("game_data").join("scenes.json");
        Self {
            mutation_lock: shared_mutation_lock(&path),
            path,
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

    fn save_all(&self, scenes: &[Scene]) -> Result<()> {
        self.ensure_dir()?;
        let content = serde_json::to_vec_pretty(scenes)?;
        atomic_replace_file(&self.path, &content)
            .with_context(|| format!("写入场景文件失败: {:?}", self.path))?;
        Ok(())
    }

    pub fn mutate<T, F>(&self, operation: F) -> Result<T>
    where
        F: FnOnce(&mut Vec<Scene>) -> Result<T>,
    {
        self.mutate_if_changed(|scenes| operation(scenes).map(|result| (result, true)))
    }

    pub fn mutate_if_changed<T, F>(&self, operation: F) -> Result<T>
    where
        F: FnOnce(&mut Vec<Scene>) -> Result<(T, bool)>,
    {
        let _guard = self
            .mutation_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut scenes = self.load_all()?;
        let (result, changed) = operation(&mut scenes)?;
        if changed {
            self.save_all(&scenes)?;
        }
        Ok(result)
    }

    /// Commit JSON before irreversible cleanup, retaining the shared mutation lock
    /// until reference checking and file removal both finish. If saving fails,
    /// cleanup never runs; if cleanup fails, the JSON deletion stays committed.
    pub fn mutate_with_cleanup<T, F, C>(&self, operation: F, cleanup: C) -> Result<T>
    where
        F: FnOnce(&mut Vec<Scene>) -> Result<T>,
        C: FnOnce(&[Scene], &T) -> Result<()>,
    {
        let _guard = self
            .mutation_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut scenes = self.load_all()?;
        let result = operation(&mut scenes)?;
        self.save_all(&scenes)?;
        cleanup(&scenes, &result)?;
        Ok(result)
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<Scene>> {
        Ok(self.load_all()?.into_iter().find(|s| s.id == id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(id: &str) -> Scene {
        Scene {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            background: String::new(),
            lighting: None,
            lighting_preset_id: None,
            lighting_preset_revision: None,
            lighting_customized: false,
            created_at: String::new(),
            updated_at: String::new(),
            plugin_id: None,
        }
    }

    #[test]
    fn independent_stores_share_one_mutation_transaction() {
        let temp = tempfile::tempdir().unwrap();
        let data_dir = temp.path().to_path_buf();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|id| {
                let data_dir = data_dir.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let store = SceneStore::new(&data_dir);
                    barrier.wait();
                    store
                        .mutate(|scenes| {
                            std::thread::sleep(std::time::Duration::from_millis(25));
                            scenes.push(scene(id));
                            Ok(())
                        })
                        .unwrap();
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        let scenes = SceneStore::new(&data_dir).load_all().unwrap();
        assert_eq!(scenes.len(), 2);
        assert!(scenes.iter().any(|item| item.id == "first"));
        assert!(scenes.iter().any(|item| item.id == "second"));
    }

    #[test]
    fn cleanup_and_reference_mutation_share_one_transaction() {
        let temp = tempfile::tempdir().unwrap();
        let data_dir = temp.path().to_path_buf();
        let store = SceneStore::new(&data_dir);
        store
            .mutate(|scenes| {
                scenes.push(scene("deleted"));
                Ok(())
            })
            .unwrap();

        let cleanup_started = std::sync::Arc::new(std::sync::Barrier::new(2));
        let finish_cleanup = std::sync::Arc::new(std::sync::Barrier::new(2));
        let delete_data_dir = data_dir.clone();
        let delete_started = cleanup_started.clone();
        let delete_finish = finish_cleanup.clone();
        let delete = std::thread::spawn(move || {
            SceneStore::new(&delete_data_dir)
                .mutate_with_cleanup(
                    |scenes| {
                        scenes.retain(|scene| scene.id != "deleted");
                        Ok(())
                    },
                    |_scenes, _result| {
                        delete_started.wait();
                        delete_finish.wait();
                        Ok(())
                    },
                )
                .unwrap();
        });

        cleanup_started.wait();
        let (mutation_attempted_tx, mutation_attempted_rx) = std::sync::mpsc::channel();
        let (mutation_finished_tx, mutation_finished_rx) = std::sync::mpsc::channel();
        let create_data_dir = data_dir.clone();
        let create = std::thread::spawn(move || {
            mutation_attempted_tx.send(()).unwrap();
            SceneStore::new(&create_data_dir)
                .mutate(|scenes| {
                    scenes.push(scene("new-reference"));
                    Ok(())
                })
                .unwrap();
            mutation_finished_tx.send(()).unwrap();
        });
        mutation_attempted_rx.recv().unwrap();
        assert!(
            mutation_finished_rx
                .recv_timeout(std::time::Duration::from_millis(100))
                .is_err(),
            "reference mutation completed before cleanup released the transaction lock"
        );

        finish_cleanup.wait();
        delete.join().unwrap();
        mutation_finished_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        create.join().unwrap();
    }

    #[test]
    fn cleanup_failure_leaves_scene_deletion_committed() {
        let temp = tempfile::tempdir().unwrap();
        let store = SceneStore::new(temp.path());
        store
            .mutate(|scenes| {
                scenes.push(scene("keep-on-cleanup-error"));
                Ok(())
            })
            .unwrap();

        let error = store
            .mutate_with_cleanup(
                |scenes| {
                    scenes.clear();
                    Ok(())
                },
                |_scenes, _result| anyhow::bail!("controlled cleanup failure"),
            )
            .unwrap_err();

        assert!(error.to_string().contains("controlled cleanup failure"));
        let scenes = store.load_all().unwrap();
        assert!(
            scenes.is_empty(),
            "JSON commit precedes irreversible file cleanup"
        );
    }

    #[test]
    fn save_failure_never_runs_irreversible_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let store = SceneStore::new(temp.path());
        store
            .mutate(|scenes| {
                scenes.push(scene("keep"));
                Ok(())
            })
            .unwrap();
        let backup = store.path.with_extension("backup");
        let mut cleanup_ran = false;
        let error = store.mutate_with_cleanup(
            |scenes| {
                scenes.clear();
                // Force atomic replacement to fail on both Windows and Unix.
                std::fs::rename(&store.path, &backup)?;
                std::fs::create_dir(&store.path)?;
                Ok(())
            },
            |_, _| {
                cleanup_ran = true;
                Ok(())
            },
        );
        assert!(error.is_err());
        assert!(!cleanup_ran);
        std::fs::remove_dir(&store.path).unwrap();
        std::fs::rename(backup, &store.path).unwrap();
        assert_eq!(store.load_all().unwrap()[0].id, "keep");
    }

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
