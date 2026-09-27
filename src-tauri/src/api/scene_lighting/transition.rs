use crate::ai_service::game_system::scene_store::{LightingParams, Scene};
use crate::ai_service::game_system::scene_transition::{
    SceneLightingSource, SceneRuntimeState, SceneTransition,
};

#[derive(Debug, Clone)]
pub(crate) struct RuntimeLightingRequest {
    pub lighting: LightingParams,
    pub source: SceneLightingSource,
    pub preset_id: Option<String>,
    pub preset_revision: Option<u32>,
    pub customized: bool,
}

impl RuntimeLightingRequest {
    pub(crate) fn manual_preset(
        lighting: LightingParams,
        preset_id: String,
        preset_revision: u32,
    ) -> Self {
        Self {
            lighting,
            source: SceneLightingSource::ManualPreset,
            preset_id: Some(preset_id),
            preset_revision: Some(preset_revision),
            customized: false,
        }
    }

    pub(crate) fn ai_preset(
        lighting: LightingParams,
        preset_id: String,
        preset_revision: u32,
    ) -> Self {
        Self {
            lighting,
            source: SceneLightingSource::AiPreset,
            preset_id: Some(preset_id),
            preset_revision: Some(preset_revision),
            customized: false,
        }
    }

    pub(crate) fn manual_custom(lighting: LightingParams) -> Self {
        Self {
            lighting,
            source: SceneLightingSource::ManualCustom,
            preset_id: None,
            preset_revision: None,
            customized: true,
        }
    }

    pub(crate) fn manual_custom_from(
        current: &SceneRuntimeState,
        lighting: LightingParams,
    ) -> Self {
        let mut request = Self::manual_custom(lighting);
        request.preset_id = current.preset_id.clone();
        request.preset_revision = current.preset_revision;
        request
    }
}

pub(crate) fn restore_runtime_lighting(
    current: &SceneRuntimeState,
    scene: Option<Scene>,
) -> Result<SceneTransition, String> {
    let request = match scene.as_ref() {
        Some(scene) => RuntimeLightingRequest {
            lighting: scene.lighting.clone().unwrap_or_default(),
            source: if scene.lighting.is_some() {
                SceneLightingSource::SceneDefault
            } else {
                SceneLightingSource::Neutral
            },
            preset_id: scene.lighting_preset_id.clone(),
            preset_revision: scene.lighting_preset_revision,
            customized: scene.lighting_customized,
        },
        None => RuntimeLightingRequest {
            lighting: LightingParams::default(),
            source: SceneLightingSource::Neutral,
            preset_id: None,
            preset_revision: None,
            customized: false,
        },
    };
    transition_runtime_lighting(current, scene, request)
}

pub(crate) fn transition_runtime_lighting(
    current: &SceneRuntimeState,
    scene: Option<Scene>,
    mut request: RuntimeLightingRequest,
) -> Result<SceneTransition, String> {
    let lighting_revision = current
        .lighting_revision
        .checked_add(1)
        .ok_or_else(|| "场景光影 revision 已达到上限".to_string())?;
    request.lighting.normalize();

    Ok(SceneTransition {
        scene,
        current_scene_id: current.current_scene_id.clone(),
        background: current.background.clone(),
        active_lighting: request.lighting,
        source: request.source,
        preset_id: request.preset_id,
        preset_revision: request.preset_revision,
        customized: request.customized,
        lighting_revision,
    })
}
