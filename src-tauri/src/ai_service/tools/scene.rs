use async_trait::async_trait;
use serde_json::{Value, json};
use tauri::Manager;

use crate::AppState;
use crate::ai_service::game_system::lighting_presets::{
    LightingPreset, LightingPresetStore, PresetKind, PresetSort,
};
use crate::ai_service::game_system::scene_transition::SceneLightingSource;
use crate::ai_service::types::ToolDefinition;

use super::ensure_no_args;
use super::executor::{Tool, ToolContext, ToolError, ToolResult};

fn safe_lighting_list(presets: &[LightingPreset]) -> Value {
    json!(
        presets
            .iter()
            .map(|preset| json!({
                "id": preset.id,
                "name": preset.name,
                "aliases": preset.aliases,
                "kind": match preset.kind {
                    PresetKind::BuiltIn => "builtin",
                    PresetKind::User => "user",
                },
                "category": preset.category,
                "tags": preset.tags,
            }))
            .collect::<Vec<_>>()
    )
}

#[derive(Debug)]
enum PresetQueryMatch<'a> {
    Found(&'a LightingPreset),
    NotFound,
    Ambiguous(Vec<&'a LightingPreset>),
}

fn match_lighting_preset<'a>(presets: &'a [LightingPreset], query: &str) -> PresetQueryMatch<'a> {
    if let Some(preset) = presets.iter().find(|preset| preset.id == query) {
        return PresetQueryMatch::Found(preset);
    }

    let mut matches = presets
        .iter()
        .filter(|preset| {
            preset.name.eq_ignore_ascii_case(query)
                || preset
                    .aliases
                    .iter()
                    .any(|alias| alias.eq_ignore_ascii_case(query))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    matches.dedup_by(|left, right| left.id == right.id);

    match matches.len() {
        0 => PresetQueryMatch::NotFound,
        1 => PresetQueryMatch::Found(matches[0]),
        _ => PresetQueryMatch::Ambiguous(matches),
    }
}

/// scene_list：列出所有可用场景。
pub struct SceneList;

#[async_trait]
impl Tool for SceneList {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "scene_list",
            "列出所有可用场景的 ID、名称、描述与背景",
            json!({
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn execute(
        &self,
        _context: &ToolContext,
        arguments: Value,
    ) -> Result<ToolResult, ToolError> {
        ensure_no_args(&arguments, "scene_list").map_err(ToolError::Execution)?;
        let scenes = crate::api::scene::load_synchronized_scenes().map_err(ToolError::Execution)?;
        Ok(json!(
            scenes
                .iter()
                .map(|s| json!({
                    "id": s.id,
                    "name": s.name,
                    "description": s.description,
                    "background": s.background,
                }))
                .collect::<Vec<_>>()
        ))
    }
}

/// scene_switch：切换到指定场景（按 id 或 name）。
pub struct SceneSwitch;

#[async_trait]
impl Tool for SceneSwitch {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "scene_switch",
            "切换到指定场景，可按场景 ID 或场景名称指定",
            json!({
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "场景 ID"},
                    "name": {"type": "string", "description": "场景名称"}
                },
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn execute(
        &self,
        context: &ToolContext,
        arguments: Value,
    ) -> Result<ToolResult, ToolError> {
        let Some(obj) = arguments.as_object() else {
            return Err(ToolError::InvalidArguments(
                "scene_switch 参数必须是 JSON object".into(),
            ));
        };
        let id = obj.get("id").and_then(Value::as_str).map(str::to_string);
        let name = obj.get("name").and_then(Value::as_str).map(str::to_string);
        if id.is_none() && name.is_none() {
            return Err(ToolError::InvalidArguments(
                "scene_switch 需要提供 id 或 name".into(),
            ));
        }

        let scenes = crate::api::scene::load_synchronized_scenes().map_err(ToolError::Execution)?;
        let scene = match (&id, &name) {
            (Some(i), _) => scenes.iter().find(|s| &s.id == i),
            (_, Some(n)) => scenes.iter().find(|s| &s.name == n),
            _ => None,
        };
        let Some(scene) = scene.cloned() else {
            let what = id.or(name).unwrap_or_default();
            return Err(ToolError::Execution(format!("未找到场景: {what}")));
        };
        let scene_id = scene.id.clone();

        let app = context.require_app()?;
        crate::api::scene::apply_scene_selection(&app, Some(&scene))
            .await
            .map_err(ToolError::Execution)?;

        Ok(json!({"ok": true, "scene_id": scene_id}))
    }
}

/// 列出 AI 可选择的光影预设，不暴露参数或本机元数据。
pub struct LightingList;

#[async_trait]
impl Tool for LightingList {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "lighting_list",
            "仅列出可供 AI 选择的光影预设安全信息，不读取或修改光影参数",
            json!({
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn execute(
        &self,
        context: &ToolContext,
        arguments: Value,
    ) -> Result<ToolResult, ToolError> {
        ensure_no_args(&arguments, "lighting_list").map_err(ToolError::Execution)?;
        let app = context.require_app()?;
        let presets = app
            .state::<LightingPresetStore>()
            .list(PresetSort::Name)
            .await
            .map_err(|error| ToolError::Execution(error.to_string()))?;
        Ok(safe_lighting_list(&presets))
    }
}

/// 按精确 ID、名称或别名临时切换到一个现有光影预设。
pub struct LightingSwitch;

#[async_trait]
impl Tool for LightingSwitch {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "lighting_switch",
            "仅按精确 ID、名称或别名临时切换现有光影预设，不允许修改参数",
            json!({
                "type": "object",
                "properties": {
                    "preset": {"type": "string", "description": "光影预设 ID、名称或别名"}
                },
                "required": ["preset"],
                "additionalProperties": false
            }),
        )
    }

    async fn execute(
        &self,
        context: &ToolContext,
        arguments: Value,
    ) -> Result<ToolResult, ToolError> {
        let query = arguments
            .get("preset")
            .and_then(Value::as_str)
            .filter(|query| !query.is_empty())
            .ok_or_else(|| ToolError::InvalidArguments("lighting_switch 需要 preset".into()))?;
        let app = context.require_app()?;
        let presets = app
            .state::<LightingPresetStore>()
            .list(PresetSort::Name)
            .await
            .map_err(|error| ToolError::Execution(error.to_string()))?;
        let preset = match match_lighting_preset(&presets, query) {
            PresetQueryMatch::Found(preset) => preset.clone(),
            PresetQueryMatch::NotFound => {
                return Ok(json!({
                    "ok": false,
                    "error": "not_found",
                    "query": query,
                }));
            },
            PresetQueryMatch::Ambiguous(candidates) => {
                let candidates = candidates.into_iter().cloned().collect::<Vec<_>>();
                return Ok(json!({
                    "ok": false,
                    "error": "ambiguous",
                    "query": query,
                    "candidates": safe_lighting_list(&candidates),
                }));
            },
        };

        let state = app.state::<AppState>();
        let service = state.ai_service.lock().await;
        let payload = crate::api::scene_lighting::apply_lighting_preset_for_service(
            &app,
            &service,
            preset,
            SceneLightingSource::AiPreset,
        )
        .await
        .map_err(ToolError::Execution)?;
        Ok(json!({
            "ok": true,
            "preset_id": payload.preset_id,
            "source": payload.source,
            "lighting_revision": payload.lighting_revision,
        }))
    }
}

/// 恢复当前场景默认光影；无场景时恢复系统中性光影。
pub struct LightingReset;

#[async_trait]
impl Tool for LightingReset {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            "lighting_reset",
            "仅恢复当前场景默认光影；无场景时恢复系统中性光影",
            json!({
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
            }),
        )
    }

    async fn execute(
        &self,
        context: &ToolContext,
        arguments: Value,
    ) -> Result<ToolResult, ToolError> {
        ensure_no_args(&arguments, "lighting_reset").map_err(ToolError::Execution)?;
        let payload = crate::api::scene_lighting::restore_scene_lighting(context.require_app()?)
            .await
            .map_err(ToolError::Execution)?;
        Ok(json!({
            "ok": true,
            "source": payload.source,
            "preset_id": payload.preset_id,
            "lighting_revision": payload.lighting_revision,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_service::game_system::lighting_presets::{LightingPreset, PresetKind};

    fn preset(id: &str, name: &str) -> LightingPreset {
        LightingPreset {
            id: id.into(),
            name: name.into(),
            aliases: vec!["safe alias".into()],
            tags: vec!["tag".into()],
            category: "category".into(),
            kind: PresetKind::User,
            description: "must stay private".into(),
            created_at: "private-created".into(),
            updated_at: "private-updated".into(),
            ..LightingPreset::default()
        }
    }

    #[test]
    fn lighting_list_exposes_only_safe_selection_fields() {
        let value = safe_lighting_list(&[preset("user:one", "One")]);
        let item = value.as_array().unwrap().first().unwrap();

        let mut keys = item
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        keys.sort();
        assert_eq!(keys, ["aliases", "category", "id", "kind", "name", "tags"]);
        let serialized = value.to_string();
        for private in [
            "description",
            "lighting",
            "created_at",
            "updated_at",
            "asset_hash",
            "resolved_path",
            "private-created",
        ] {
            assert!(!serialized.contains(private), "leaked {private}");
        }
    }

    #[test]
    fn lighting_switch_matches_exact_id_before_name_or_alias() {
        let presets = vec![
            preset("builtin:neutral", "Other"),
            preset("user:two", "builtin:neutral"),
        ];
        let PresetQueryMatch::Found(found) = match_lighting_preset(&presets, "builtin:neutral")
        else {
            panic!("expected exact id match");
        };
        assert_eq!(found.id, "builtin:neutral");
    }

    #[test]
    fn lighting_switch_matches_exact_name_alias_and_ascii_case_insensitively() {
        let mut named = preset("user:named", "Warm Window");
        named.aliases = vec!["暖窗".into(), "Golden Hour".into()];
        let presets = vec![named];

        for query in ["Warm Window", "warm window", "暖窗", "golden hour"] {
            let PresetQueryMatch::Found(found) = match_lighting_preset(&presets, query) else {
                panic!("expected match for {query}");
            };
            assert_eq!(found.id, "user:named");
        }
    }

    #[test]
    fn lighting_switch_reports_not_found_without_fuzzy_guessing() {
        let presets = vec![preset("user:one", "Moonlight")];
        assert!(matches!(
            match_lighting_preset(&presets, "Moon"),
            PresetQueryMatch::NotFound
        ));
    }

    #[test]
    fn lighting_switch_reports_stably_sorted_ambiguity_without_selection() {
        let mut zulu = preset("user:z", "Zulu");
        zulu.aliases = vec!["shared".into()];
        let mut alpha_b = preset("user:b", "Alpha");
        alpha_b.aliases = vec!["shared".into()];
        let mut alpha_a = preset("user:a", "Alpha");
        alpha_a.aliases = vec!["shared".into()];

        let presets = [zulu, alpha_b, alpha_a];
        let PresetQueryMatch::Ambiguous(candidates) = match_lighting_preset(&presets, "SHARED")
        else {
            panic!("expected ambiguity");
        };
        assert_eq!(
            candidates
                .iter()
                .map(|preset| preset.id.as_str())
                .collect::<Vec<_>>(),
            ["user:a", "user:b", "user:z"]
        );
    }

    #[test]
    fn lighting_tool_schemas_do_not_allow_parameter_editing() {
        let list = LightingList.definition();
        let switch = LightingSwitch.definition();
        let reset = LightingReset.definition();

        assert_eq!(list.function.parameters["properties"], json!({}));
        assert_eq!(reset.function.parameters["properties"], json!({}));
        assert_eq!(
            switch.function.parameters["properties"],
            json!({"preset": {"type": "string", "description": "光影预设 ID、名称或别名"}})
        );
        assert_eq!(switch.function.parameters["required"], json!(["preset"]));
        assert_eq!(switch.function.parameters["additionalProperties"], false);
        let schema = switch.function.parameters.to_string();
        for forbidden in ["lighting", "intensity", "color", "asset", "params"] {
            assert!(!schema.contains(forbidden), "schema exposed {forbidden}");
        }
    }
}
