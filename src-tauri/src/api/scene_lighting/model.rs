use serde::{Deserialize, Serialize};

use crate::ai_service::game_system::scene_store::{LightingParams, Scene};
use crate::ai_service::game_system::scene_transition::{
    SceneLightingSource, SceneRuntimeState, SceneTransition,
};

use super::transition::{RuntimeLightingRequest, transition_runtime_lighting};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeLightingMetadata {
    pub source: SceneLightingSource,
    pub preset_id: Option<String>,
    pub preset_revision: Option<u32>,
    pub customized: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreviewRuntimeLightingBackup {
    pub active_lighting: LightingParams,
    pub metadata: RuntimeLightingMetadata,
}

impl PreviewRuntimeLightingBackup {
    pub fn capture(runtime: &SceneRuntimeState) -> Self {
        Self {
            active_lighting: runtime.active_lighting.clone(),
            metadata: RuntimeLightingMetadata {
                source: runtime.source,
                preset_id: runtime.preset_id.clone(),
                preset_revision: runtime.preset_revision,
                customized: runtime.customized,
            },
        }
    }

    pub(crate) fn restore_transition(
        self,
        current: &SceneRuntimeState,
        scene: Option<Scene>,
    ) -> Result<SceneTransition, String> {
        transition_runtime_lighting(
            current,
            scene,
            RuntimeLightingRequest {
                lighting: self.active_lighting,
                source: self.metadata.source,
                preset_id: self.metadata.preset_id,
                preset_revision: self.metadata.preset_revision,
                customized: self.metadata.customized,
            },
        )
    }
}
