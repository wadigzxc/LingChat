use serde::{Deserialize, Serialize};

use super::scene_store::{LightingParams, Scene};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SceneLightingSource {
    Neutral,
    SceneDefault,
    ManualPreset,
    ManualCustom,
    AiPreset,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SceneRuntimeState {
    pub current_scene_id: Option<String>,
    pub background: String,
    pub active_lighting: LightingParams,
    pub source: SceneLightingSource,
    pub preset_id: Option<String>,
    pub preset_revision: Option<u32>,
    pub customized: bool,
    pub lighting_revision: u64,
}

impl SceneRuntimeState {
    pub fn neutral(lighting_revision: u64) -> Self {
        Self {
            current_scene_id: None,
            background: String::new(),
            active_lighting: LightingParams::default(),
            source: SceneLightingSource::Neutral,
            preset_id: None,
            preset_revision: None,
            customized: false,
            lighting_revision,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SceneSelection {
    pub scene: Scene,
    pub resolved_background: String,
}

impl SceneSelection {
    pub fn new(scene: Scene, resolved_background: String) -> Self {
        Self {
            scene,
            resolved_background,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SceneTransition {
    pub scene: Option<Scene>,
    pub current_scene_id: Option<String>,
    pub background: String,
    pub active_lighting: LightingParams,
    pub source: SceneLightingSource,
    pub preset_id: Option<String>,
    pub preset_revision: Option<u32>,
    pub customized: bool,
    pub lighting_revision: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SceneStatePayload {
    pub scene: Option<Scene>,
    pub background: String,
    pub active_lighting: LightingParams,
    pub source: SceneLightingSource,
    pub preset_id: Option<String>,
    pub preset_revision: Option<u32>,
    pub customized: bool,
    pub lighting_revision: u64,
}

impl From<&SceneTransition> for SceneStatePayload {
    fn from(transition: &SceneTransition) -> Self {
        Self {
            scene: transition.scene.clone(),
            background: transition.background.clone(),
            active_lighting: transition.active_lighting.clone(),
            source: transition.source,
            preset_id: transition.preset_id.clone(),
            preset_revision: transition.preset_revision,
            customized: transition.customized,
            lighting_revision: transition.lighting_revision,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoredSceneSelection {
    NeverSelected,
    ExplicitNone,
    SceneId(String),
}

#[derive(Debug, Clone)]
pub struct StartupSceneResolution<'a> {
    pub scene: Option<&'a Scene>,
    pub persist_correction: bool,
}

pub fn resolve_startup_selection<'a>(
    stored: StoredSceneSelection,
    scenes: &'a [Scene],
) -> StartupSceneResolution<'a> {
    match stored {
        StoredSceneSelection::ExplicitNone => StartupSceneResolution {
            scene: None,
            persist_correction: false,
        },
        StoredSceneSelection::SceneId(id) => {
            if let Some(scene) = scenes.iter().find(|scene| scene.id == id) {
                StartupSceneResolution {
                    scene: Some(scene),
                    persist_correction: false,
                }
            } else {
                StartupSceneResolution {
                    scene: scenes.first(),
                    persist_correction: true,
                }
            }
        },
        StoredSceneSelection::NeverSelected => StartupSceneResolution {
            scene: scenes.first(),
            persist_correction: true,
        },
    }
}

pub fn transition_scene_selection(
    current: &SceneRuntimeState,
    selected: Option<SceneSelection>,
) -> Result<SceneTransition, String> {
    let lighting_revision = current
        .lighting_revision
        .checked_add(1)
        .ok_or_else(|| "场景光影 revision 已达到上限".to_string())?;

    match selected {
        Some(selected) => {
            let scene = selected.scene;
            let active_lighting = scene.lighting.clone().unwrap_or_default();
            let source = if scene.lighting.is_some() {
                SceneLightingSource::SceneDefault
            } else {
                SceneLightingSource::Neutral
            };
            Ok(SceneTransition {
                current_scene_id: Some(scene.id.clone()),
                background: selected.resolved_background,
                active_lighting,
                source,
                preset_id: scene.lighting_preset_id.clone(),
                preset_revision: scene.lighting_preset_revision,
                customized: scene.lighting_customized,
                scene: Some(scene),
                lighting_revision,
            })
        },
        None => Ok(SceneTransition {
            scene: None,
            current_scene_id: None,
            background: String::new(),
            active_lighting: LightingParams::default(),
            source: SceneLightingSource::Neutral,
            preset_id: None,
            preset_revision: None,
            customized: false,
            lighting_revision,
        }),
    }
}

pub fn transition_scene_by_id<F>(
    current: &SceneRuntimeState,
    scenes: &[Scene],
    scene_id: Option<&str>,
    resolve_background: F,
) -> Result<SceneTransition, String>
where
    F: FnOnce(&Scene) -> String,
{
    let selected = match scene_id {
        Some(id) => {
            let scene = scenes
                .iter()
                .find(|scene| scene.id == id)
                .ok_or_else(|| format!("场景 {id} 不存在"))?;
            Some(SceneSelection::new(
                scene.clone(),
                resolve_background(scene),
            ))
        },
        None => None,
    };
    transition_scene_selection(current, selected)
}

pub fn restore_snapshot_scene<F>(
    current: &SceneRuntimeState,
    snapshot_scene_id: Option<&str>,
    scenes: &[Scene],
    resolve_background: F,
) -> Result<SceneTransition, String>
where
    F: FnOnce(&Scene) -> String,
{
    transition_scene_by_id(current, scenes, snapshot_scene_id, resolve_background)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_service::game_system::scene_store::{LightingParams, Scene};

    fn scene(id: &str, background: &str, lighting: Option<LightingParams>) -> Scene {
        Scene {
            id: id.into(),
            name: format!("Scene {id}"),
            description: "description".into(),
            background: background.into(),
            lighting,
            lighting_preset_id: Some("preset:test".into()),
            lighting_preset_revision: Some(3),
            lighting_customized: true,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            plugin_id: None,
        }
    }

    #[test]
    fn selecting_scene_updates_every_runtime_field() {
        let current = SceneRuntimeState::neutral(7);
        let mut lighting = LightingParams::default();
        lighting.enabled = true;
        let selected = SceneSelection::new(
            scene("scene-1", "stored.png", Some(lighting.clone())),
            "C:/backgrounds/stored.png".into(),
        );

        let transition = transition_scene_selection(&current, Some(selected)).unwrap();

        assert_eq!(transition.current_scene_id.as_deref(), Some("scene-1"));
        assert_eq!(transition.background, "C:/backgrounds/stored.png");
        assert_eq!(transition.active_lighting, lighting);
        assert_eq!(transition.source, SceneLightingSource::SceneDefault);
        assert_eq!(transition.preset_id.as_deref(), Some("preset:test"));
        assert_eq!(transition.preset_revision, Some(3));
        assert!(transition.customized);
        assert_eq!(transition.lighting_revision, 8);
    }

    #[test]
    fn selecting_none_clears_scene_and_applies_neutral_lighting() {
        let lighting = LightingParams {
            enabled: true,
            ..LightingParams::default()
        };
        let current = SceneRuntimeState {
            current_scene_id: Some("scene-1".into()),
            background: "C:/backgrounds/stored.png".into(),
            active_lighting: lighting,
            source: SceneLightingSource::SceneDefault,
            preset_id: Some("preset:test".into()),
            preset_revision: Some(3),
            customized: true,
            lighting_revision: 8,
        };

        let transition = transition_scene_selection(&current, None).unwrap();

        assert!(transition.scene.is_none());
        assert!(transition.current_scene_id.is_none());
        assert!(transition.background.is_empty());
        assert_eq!(transition.active_lighting, LightingParams::default());
        assert_eq!(transition.source, SceneLightingSource::Neutral);
        assert!(transition.preset_id.is_none());
        assert!(transition.preset_revision.is_none());
        assert!(!transition.customized);
        assert_eq!(transition.lighting_revision, 9);
        let payload = serde_json::to_value(SceneStatePayload::from(&transition)).unwrap();
        assert!(payload["scene"].is_null());
        assert_eq!(payload["source"], "neutral");
    }

    #[test]
    fn reapplying_same_scene_refreshes_snapshot_and_revision() {
        let current = SceneRuntimeState {
            current_scene_id: Some("scene-1".into()),
            background: "old.png".into(),
            active_lighting: LightingParams::default(),
            source: SceneLightingSource::Neutral,
            preset_id: None,
            preset_revision: None,
            customized: false,
            lighting_revision: 41,
        };
        let mut changed_lighting = LightingParams::default();
        changed_lighting.enabled = true;
        let selected = SceneSelection::new(
            scene("scene-1", "changed.png", Some(changed_lighting.clone())),
            "C:/backgrounds/changed.png".into(),
        );

        let transition = transition_scene_selection(&current, Some(selected)).unwrap();

        assert_eq!(transition.current_scene_id.as_deref(), Some("scene-1"));
        assert_eq!(transition.background, "C:/backgrounds/changed.png");
        assert_eq!(transition.active_lighting, changed_lighting);
        assert_eq!(transition.lighting_revision, 42);
    }

    #[test]
    fn full_event_payload_contains_scene_lighting_source_and_revision() {
        let current = SceneRuntimeState::neutral(12);
        let selected = SceneSelection::new(
            scene("scene-1", "stored.png", Some(LightingParams::default())),
            "C:/backgrounds/stored.png".into(),
        );
        let transition = transition_scene_selection(&current, Some(selected)).unwrap();

        let value = serde_json::to_value(SceneStatePayload::from(&transition)).unwrap();

        assert_eq!(value["scene"]["id"], "scene-1");
        assert_eq!(value["background"], "C:/backgrounds/stored.png");
        assert!(value.get("active_lighting").is_some());
        assert_eq!(value["source"], "scene_default");
        assert_eq!(value["preset_id"], "preset:test");
        assert_eq!(value["preset_revision"], 3);
        assert_eq!(value["customized"], true);
        assert_eq!(value["lighting_revision"], 13);
    }

    #[test]
    fn startup_distinguishes_never_selected_from_explicit_none() {
        let scenes = vec![scene("default", "default.png", None)];

        let never = resolve_startup_selection(StoredSceneSelection::NeverSelected, &scenes);
        let explicit_none = resolve_startup_selection(StoredSceneSelection::ExplicitNone, &scenes);

        assert_eq!(never.scene.map(|s| s.id.as_str()), Some("default"));
        assert!(never.persist_correction);
        assert!(explicit_none.scene.is_none());
        assert!(!explicit_none.persist_correction);
    }

    #[test]
    fn invalid_stored_scene_id_falls_back_and_requests_persistence_correction() {
        let scenes = vec![scene("fallback", "fallback.png", None)];

        let resolution =
            resolve_startup_selection(StoredSceneSelection::SceneId("missing".into()), &scenes);

        assert_eq!(resolution.scene.map(|s| s.id.as_str()), Some("fallback"));
        assert!(resolution.persist_correction);
    }

    #[test]
    fn invalid_scene_id_returns_error_without_transitioning_state() {
        let current = SceneRuntimeState::neutral(9);
        let before = current.clone();

        let result = transition_scene_by_id(&current, &[], Some("missing"), |_| String::new());

        assert_eq!(result.unwrap_err(), "场景 missing 不存在");
        assert_eq!(current, before);
    }

    #[test]
    fn save_restore_recomputes_lighting_from_scene_snapshot() {
        let mut temporary = LightingParams::default();
        temporary.master_intensity = 0.25;
        let current = SceneRuntimeState {
            current_scene_id: Some("scene-1".into()),
            background: "temporary.png".into(),
            active_lighting: temporary,
            source: SceneLightingSource::Neutral,
            preset_id: Some("temporary".into()),
            preset_revision: Some(99),
            customized: true,
            lighting_revision: 20,
        };
        let mut snapshot_lighting = LightingParams::default();
        snapshot_lighting.master_intensity = 1.5;
        let scenes = vec![scene(
            "scene-1",
            "snapshot.png",
            Some(snapshot_lighting.clone()),
        )];

        let restored = restore_snapshot_scene(&current, Some("scene-1"), &scenes, |_| {
            "C:/backgrounds/snapshot.png".into()
        })
        .unwrap();

        assert_eq!(restored.active_lighting, snapshot_lighting);
        assert_eq!(restored.source, SceneLightingSource::SceneDefault);
        assert_eq!(restored.preset_id.as_deref(), Some("preset:test"));
        assert_eq!(restored.preset_revision, Some(3));
        assert!(restored.customized);
        assert_eq!(restored.lighting_revision, 21);
    }
}
