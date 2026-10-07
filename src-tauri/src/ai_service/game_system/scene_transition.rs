use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::scene_store::{LightingParams, Scene};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SceneLightingSource {
    Neutral,
    SceneDefault,
    ManualPreset,
    ManualCustom,
    AiPreset,
}

impl Serialize for SceneLightingSource {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(match self {
            Self::Neutral => "neutral",
            Self::SceneDefault => "scene_default",
            Self::ManualPreset | Self::ManualCustom => "manual",
            Self::AiPreset => "ai",
        })
    }
}

impl<'de> Deserialize<'de> for SceneLightingSource {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "neutral" => Ok(Self::Neutral),
            "scene_default" => Ok(Self::SceneDefault),
            "manual" => Ok(Self::ManualCustom),
            "ai" => Ok(Self::AiPreset),
            _ => Err(serde::de::Error::unknown_variant(
                &value,
                &["neutral", "scene_default", "manual", "ai"],
            )),
        }
    }
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

pub fn transition_scene_update(
    current: &SceneRuntimeState,
    previous: &Scene,
    updated: Scene,
    resolved_background: String,
) -> Result<SceneTransition, String> {
    let snapshot_changed = previous.background != updated.background
        || previous.lighting != updated.lighting
        || previous.lighting_preset_id != updated.lighting_preset_id
        || previous.lighting_preset_revision != updated.lighting_preset_revision
        || previous.lighting_customized != updated.lighting_customized;
    if snapshot_changed {
        return transition_scene_selection(
            current,
            Some(SceneSelection::new(updated, resolved_background)),
        );
    }

    let lighting_revision = current
        .lighting_revision
        .checked_add(1)
        .ok_or_else(|| "场景光影 revision 已达到上限".to_string())?;
    Ok(SceneTransition {
        scene: Some(updated),
        current_scene_id: current.current_scene_id.clone(),
        background: resolved_background,
        active_lighting: current.active_lighting.clone(),
        source: current.source,
        preset_id: current.preset_id.clone(),
        preset_revision: current.preset_revision,
        customized: current.customized,
        lighting_revision,
    })
}

/// Explicit default saves restore provenance even when the saved snapshot is unchanged.
/// Ordinary edits retain the metadata-only behavior of `transition_scene_update`.
/// Returns the optional runtime event for an update of the captured scene ID.
pub fn transition_scene_update_with_intent(
    current: &SceneRuntimeState,
    previous: &Scene,
    updated: Scene,
    resolved_background: String,
    apply_lighting_as_default: bool,
) -> Result<Option<SceneTransition>, String> {
    if current.current_scene_id.as_deref() != Some(updated.id.as_str()) {
        return Ok(None);
    }
    let transition = if apply_lighting_as_default {
        transition_scene_selection(
            current,
            Some(SceneSelection::new(updated, resolved_background)),
        )
    } else {
        transition_scene_update(current, previous, updated, resolved_background)
    }?;
    Ok(Some(transition))
}

pub fn preserve_temporary_lighting_after_session_reset(
    before: &SceneRuntimeState,
    reset: SceneRuntimeState,
) -> SceneRuntimeState {
    match before.source {
        SceneLightingSource::ManualPreset
        | SceneLightingSource::ManualCustom
        | SceneLightingSource::AiPreset => before.clone(),
        SceneLightingSource::Neutral | SceneLightingSource::SceneDefault => reset,
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
    fn explicit_default_save_of_identical_snapshot_reclassifies_temporary_source_once() {
        let mut lighting = LightingParams::default();
        lighting.master_intensity = 0.25;
        let saved = scene("scene-1", "stored.png", Some(lighting.clone()));
        for source in [
            SceneLightingSource::ManualPreset,
            SceneLightingSource::ManualCustom,
            SceneLightingSource::AiPreset,
        ] {
            let current = SceneRuntimeState {
                current_scene_id: Some("scene-1".into()),
                background: "C:/backgrounds/stored.png".into(),
                active_lighting: lighting.clone(),
                source,
                preset_id: saved.lighting_preset_id.clone(),
                preset_revision: saved.lighting_preset_revision,
                customized: saved.lighting_customized,
                lighting_revision: 20,
            };
            let transition = transition_scene_update_with_intent(
                &current,
                &saved,
                saved.clone(),
                "C:/backgrounds/stored.png".into(),
                true,
            )
            .unwrap()
            .unwrap();
            assert_eq!(transition.source, SceneLightingSource::SceneDefault);
            assert_eq!(transition.active_lighting, lighting);
            assert_eq!(transition.current_scene_id.as_deref(), Some("scene-1"));
            assert_eq!(transition.background, "C:/backgrounds/stored.png");
            assert_eq!(transition.preset_id.as_deref(), Some("preset:test"));
            assert_eq!(transition.preset_revision, Some(3));
            assert!(transition.customized);
            assert_eq!(transition.lighting_revision, 21);
        }
    }

    #[test]
    fn captured_old_scene_save_never_transitions_new_current_or_none() {
        let saved = scene("scene-1", "stored.png", Some(LightingParams::default()));
        for current_id in [Some("scene-2".to_string()), None] {
            let mut current = SceneRuntimeState::neutral(21);
            current.current_scene_id = current_id;
            current.background = "new-current.png".into();
            current.active_lighting.master_intensity = 1.75;
            current.source = SceneLightingSource::AiPreset;
            current.preset_id = Some("new:preset".into());
            current.preset_revision = Some(12);
            current.customized = true;
            let before = current.clone();
            for intent in [true, false] {
                let event = transition_scene_update_with_intent(
                    &current,
                    &saved,
                    saved.clone(),
                    "C:/backgrounds/stored.png".into(),
                    intent,
                )
                .unwrap();
                assert!(
                    event.is_none(),
                    "non-current save must not emit or increment revision"
                );
                assert_eq!(current, before);
            }
        }
    }

    #[test]
    fn ordinary_update_intent_preserves_manual_and_ai_metadata_only_state() {
        let previous = scene("scene-1", "stored.png", Some(LightingParams::default()));
        let mut updated = previous.clone();
        updated.name = "Renamed".into();
        updated.description = "Metadata only".into();
        for source in [
            SceneLightingSource::ManualPreset,
            SceneLightingSource::ManualCustom,
            SceneLightingSource::AiPreset,
        ] {
            let mut current = SceneRuntimeState::neutral(20);
            current.current_scene_id = Some("scene-1".into());
            current.background = "C:/backgrounds/stored.png".into();
            current.active_lighting.master_intensity = 0.75;
            current.source = source;
            current.preset_id = Some("user:temporary".into());
            current.preset_revision = Some(9);
            current.customized = true;
            let transition = transition_scene_update_with_intent(
                &current,
                &previous,
                updated.clone(),
                current.background.clone(),
                false,
            )
            .unwrap()
            .unwrap();
            assert_eq!(transition.scene.as_ref().unwrap().name, "Renamed");
            assert_eq!(transition.active_lighting, current.active_lighting);
            assert_eq!(transition.source, source);
            assert_eq!(transition.preset_id.as_deref(), Some("user:temporary"));
            assert_eq!(transition.preset_revision, Some(9));
            assert!(transition.customized);
            assert_eq!(transition.lighting_revision, 21);
        }
    }

    #[test]
    fn explicit_default_without_snapshot_keeps_neutral_contract() {
        let mut saved = scene("scene-1", "stored.png", None);
        saved.lighting_preset_id = None;
        saved.lighting_preset_revision = None;
        saved.lighting_customized = false;
        let mut current = SceneRuntimeState::neutral(20);
        current.current_scene_id = Some("scene-1".into());
        current.active_lighting.master_intensity = 0.75;
        current.source = SceneLightingSource::AiPreset;
        let transition = transition_scene_update_with_intent(
            &current,
            &saved,
            saved.clone(),
            "C:/backgrounds/stored.png".into(),
            true,
        )
        .unwrap()
        .unwrap();
        assert_eq!(transition.source, SceneLightingSource::Neutral);
        assert_eq!(transition.active_lighting, LightingParams::default());
        assert_eq!(transition.current_scene_id.as_deref(), Some("scene-1"));
        assert!(transition.preset_id.is_none());
        assert!(transition.preset_revision.is_none());
        assert!(!transition.customized);
        assert_eq!(transition.lighting_revision, 21);
    }

    #[test]
    fn current_scene_metadata_update_preserves_temporary_lighting() {
        let mut temporary = LightingParams::default();
        temporary.master_intensity = 0.25;
        let current = SceneRuntimeState {
            current_scene_id: Some("scene-1".into()),
            background: "C:/backgrounds/stored.png".into(),
            active_lighting: temporary.clone(),
            source: SceneLightingSource::ManualCustom,
            preset_id: Some("user:temporary".into()),
            preset_revision: Some(9),
            customized: true,
            lighting_revision: 20,
        };
        let previous = scene("scene-1", "stored.png", Some(LightingParams::default()));
        let mut updated = previous.clone();
        updated.name = "Renamed".into();
        updated.description = "New description".into();

        let transition = transition_scene_update(
            &current,
            &previous,
            updated.clone(),
            "C:/backgrounds/stored.png".into(),
        )
        .unwrap();

        assert_eq!(transition.scene.unwrap().name, "Renamed");
        assert_eq!(transition.background, "C:/backgrounds/stored.png");
        assert_eq!(transition.active_lighting, temporary);
        assert_eq!(transition.source, SceneLightingSource::ManualCustom);
        assert_eq!(transition.preset_id.as_deref(), Some("user:temporary"));
        assert_eq!(transition.preset_revision, Some(9));
        assert!(transition.customized);
        assert_eq!(transition.lighting_revision, 21);
    }

    #[test]
    fn current_scene_snapshot_update_restores_scene_default() {
        let mut temporary = LightingParams::default();
        temporary.master_intensity = 0.25;
        let current = SceneRuntimeState {
            current_scene_id: Some("scene-1".into()),
            background: "C:/backgrounds/stored.png".into(),
            active_lighting: temporary,
            source: SceneLightingSource::AiPreset,
            preset_id: Some("user:temporary".into()),
            preset_revision: Some(9),
            customized: false,
            lighting_revision: 20,
        };
        let previous = scene("scene-1", "stored.png", Some(LightingParams::default()));
        let mut updated = previous.clone();
        updated.lighting.as_mut().unwrap().master_intensity = 1.4;
        updated.lighting_preset_id = Some("user:saved".into());
        updated.lighting_preset_revision = Some(10);

        let transition = transition_scene_update(
            &current,
            &previous,
            updated,
            "C:/backgrounds/stored.png".into(),
        )
        .unwrap();

        assert_eq!(transition.active_lighting.master_intensity, 1.4);
        assert_eq!(transition.source, SceneLightingSource::SceneDefault);
        assert_eq!(transition.preset_id.as_deref(), Some("user:saved"));
        assert_eq!(transition.preset_revision, Some(10));
        assert_eq!(transition.lighting_revision, 21);
    }

    #[test]
    fn public_source_wire_collapses_internal_manual_and_ai_kinds() {
        assert_eq!(
            serde_json::to_value(SceneLightingSource::ManualPreset).unwrap(),
            "manual"
        );
        assert_eq!(
            serde_json::to_value(SceneLightingSource::ManualCustom).unwrap(),
            "manual"
        );
        assert_eq!(
            serde_json::to_value(SceneLightingSource::AiPreset).unwrap(),
            "ai"
        );
        assert_eq!(
            serde_json::from_str::<SceneLightingSource>(r#""manual""#).unwrap(),
            SceneLightingSource::ManualCustom
        );
        for internal in ["manual_preset", "manual_custom", "ai_preset"] {
            assert!(
                serde_json::from_str::<SceneLightingSource>(&format!(r#""{internal}""#)).is_err(),
                "internal source leaked onto the public wire: {internal}"
            );
        }
    }

    #[test]
    fn session_reset_preserves_temporary_manual_lighting() {
        let mut before = SceneRuntimeState::neutral(12);
        before.current_scene_id = Some("scene-1".into());
        before.background = "background.png".into();
        before.active_lighting.master_intensity = 0.25;
        before.source = SceneLightingSource::ManualCustom;
        before.preset_id = Some("user:base".into());
        before.preset_revision = Some(4);
        before.customized = true;
        let mut reset = SceneRuntimeState::neutral(0);
        reset.current_scene_id = Some("scene-1".into());

        let preserved = preserve_temporary_lighting_after_session_reset(&before, reset);

        assert_eq!(preserved, before);
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
