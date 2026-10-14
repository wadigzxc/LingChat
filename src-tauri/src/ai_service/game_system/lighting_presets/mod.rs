mod builtins;
mod catalog;
mod model;
mod store;

pub use builtins::builtin_presets;
pub use model::{
    LightingPreset, LightingPresetDraft, LightingPresetUpdate, PresetKind, PresetSort,
};
pub use store::LightingPresetStore;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod favorites_tests;
