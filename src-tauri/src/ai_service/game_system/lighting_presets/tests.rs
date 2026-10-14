use std::collections::HashSet;

use super::*;

#[tokio::test]
async fn deleting_preset_does_not_touch_lighting_assets() {
    let temp = tempfile::tempdir().unwrap();
    let assets = temp.path().join("game_data/lighting_assets");
    std::fs::create_dir_all(&assets).unwrap();
    let asset = assets.join("shared.png");
    std::fs::write(&asset, b"shared-asset").unwrap();
    let store = LightingPresetStore::new(temp.path());
    let created = store.create(draft("Uses shared asset")).await.unwrap();

    store.delete(&created.id).await.unwrap();

    assert_eq!(std::fs::read(&asset).unwrap(), b"shared-asset");
    assert!(assets.is_dir());
}

#[tokio::test]
async fn list_sorts_most_recently_used_first_and_never_used_last() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());
    let mut old = draft("A old");
    old.last_used_at = Some("2026-01-01T00:00:00Z".to_string());
    store.create(old).await.unwrap();
    let mut new = draft("Z new");
    new.last_used_at = Some("2026-02-01T00:00:00Z".to_string());
    store.create(new).await.unwrap();
    store.create(draft("M never")).await.unwrap();

    let users: Vec<_> = store
        .list(PresetSort::RecentlyUsed)
        .await
        .unwrap()
        .into_iter()
        .filter(|preset| preset.kind == PresetKind::User)
        .collect();

    assert_eq!(
        users
            .iter()
            .map(|preset| preset.name.as_str())
            .collect::<Vec<_>>(),
        ["Z new", "A old", "M never",]
    );
}

#[tokio::test]
async fn taking_user_preset_for_application_marks_it_used_in_the_same_transaction() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());
    let first = store.create(draft("A first")).await.unwrap();
    let second = store.create(draft("B second")).await.unwrap();

    let applied = store
        .take_for_application(&first.id)
        .await
        .unwrap()
        .unwrap();

    let users: Vec<_> = store
        .list(PresetSort::RecentlyUsed)
        .await
        .unwrap()
        .into_iter()
        .filter(|preset| preset.kind == PresetKind::User)
        .collect();
    assert_eq!(users[0].id, first.id);
    assert_eq!(users[0].last_used_at, applied.last_used_at);
    assert!(applied.last_used_at.is_some());
    assert_eq!(users[1].id, second.id);
    assert!(users[1].last_used_at.is_none());
}

#[tokio::test]
async fn taking_builtin_for_application_does_not_mutate_generated_builtin() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());

    let applied = store
        .take_for_application("builtin:neutral")
        .await
        .unwrap()
        .unwrap();

    assert!(applied.last_used_at.is_none());
    assert!(!temp.path().join("game_data/lighting_presets.json").exists());
}

#[tokio::test]
async fn list_sorts_favorites_first_with_stable_name_ties() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());
    store.create(draft("A regular")).await.unwrap();
    let mut favorite = draft("Z favorite");
    favorite.favorite = true;
    store.create(favorite).await.unwrap();

    let users: Vec<_> = store
        .list(PresetSort::FavoriteFirst)
        .await
        .unwrap()
        .into_iter()
        .filter(|preset| preset.kind == PresetKind::User)
        .collect();

    assert_eq!(users[0].name, "Z favorite");
    assert_eq!(users[1].name, "A regular");
}

#[tokio::test]
async fn list_sorts_by_name_with_stable_id_tie_break() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());
    store.create(draft("Zebra")).await.unwrap();
    store.create(draft("alpha")).await.unwrap();
    let same_a = store.create(draft("Same")).await.unwrap();
    let same_b = store.create(draft("Same")).await.unwrap();

    let users: Vec<_> = store
        .list(PresetSort::Name)
        .await
        .unwrap()
        .into_iter()
        .filter(|preset| preset.kind == PresetKind::User)
        .collect();
    let mut tied_ids = [same_a.id, same_b.id];
    tied_ids.sort();

    assert_eq!(users[0].name, "alpha");
    assert_eq!(users[1].id, tied_ids[0]);
    assert_eq!(users[2].id, tied_ids[1]);
    assert_eq!(users[3].name, "Zebra");
}

#[tokio::test]
async fn application_params_also_use_atomic_recent_use_snapshot() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());
    let created = store.create(draft("Application source")).await.unwrap();
    let lighting = store
        .lighting_for_application(&created.id)
        .await
        .unwrap()
        .unwrap();
    let saved = store.get(&created.id).await.unwrap().unwrap();
    assert!(
        saved.last_used_at.is_some(),
        "legacy application accessor must not bypass recent-use transaction"
    );
    assert_eq!(lighting, saved.lighting);
}

#[tokio::test]
async fn application_params_are_owned_deep_copies() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());
    let created = store.create(draft("Copy source")).await.unwrap();

    let mut applied = store
        .lighting_for_application(&created.id)
        .await
        .unwrap()
        .unwrap();
    applied.character.glow_color = "#123456".to_string();
    applied.asset_layers.push(Default::default());

    let stored = store.get(&created.id).await.unwrap().unwrap();
    assert_ne!(stored.lighting.character.glow_color, "#123456");
    assert!(stored.lighting.asset_layers.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_creates_do_not_lose_updates() {
    let temp = tempfile::tempdir().unwrap();
    let store = std::sync::Arc::new(LightingPresetStore::new(temp.path()));
    let barrier = std::sync::Arc::new(tokio::sync::Barrier::new(2));

    let first = {
        let store = store.clone();
        let barrier = barrier.clone();
        tokio::spawn(async move {
            barrier.wait().await;
            store.create(draft("First")).await.unwrap()
        })
    };
    let second = {
        let store = store.clone();
        let barrier = barrier.clone();
        tokio::spawn(async move {
            barrier.wait().await;
            store.create(draft("Second")).await.unwrap()
        })
    };
    let (first, second) = tokio::join!(first, second);
    let first = first.unwrap();
    let second = second.unwrap();

    let listed = store.list(PresetSort::Name).await.unwrap();
    assert!(listed.iter().any(|preset| preset.id == first.id));
    assert!(listed.iter().any(|preset| preset.id == second.id));
    assert_eq!(listed.len(), builtin_presets().len() + 2);
}

#[test]
fn atomic_write_failure_preserves_previous_file() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("lighting_presets.json");
    std::fs::write(&path, b"old-content").unwrap();

    let result =
        crate::utils::atomic_file::atomic_replace_file_with_hook(&path, b"new-content", || {
            anyhow::bail!("injected failure")
        });

    assert!(result.is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"old-content");
}

fn draft(name: &str) -> LightingPresetDraft {
    LightingPresetDraft {
        name: name.to_string(),
        category: "custom".to_string(),
        tags: vec!["tag".to_string()],
        ..Default::default()
    }
}

#[tokio::test]
async fn builtin_presets_reject_update_and_delete() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());
    let id = "builtin:neutral";

    let update_error = store
        .update(
            id,
            LightingPresetUpdate {
                name: Some("Changed".to_string()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err()
        .to_string();
    let delete_error = store.delete(id).await.unwrap_err().to_string();

    assert!(update_error.contains("内置光影预设不可更新"));
    assert!(delete_error.contains("内置光影预设不可删除"));
    assert_eq!(store.get(id).await.unwrap().unwrap().name, "中性");
}

#[tokio::test]
async fn user_preset_crud_persists_changes() {
    let temp = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(temp.path());

    let created = store.create(draft("Original")).await.unwrap();
    assert_eq!(created.kind, PresetKind::User);
    assert!(created.id.starts_with("user:"));
    assert_eq!(created.origin_id.as_deref(), Some(created.id.as_str()));
    assert_eq!(store.get(&created.id).await.unwrap(), Some(created.clone()));

    let updated = store
        .update(
            &created.id,
            LightingPresetUpdate {
                name: Some("Updated".to_string()),
                favorite: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.name, "Updated");
    assert!(updated.favorite);
    assert_eq!(updated.revision, created.revision + 1);

    let deleted = store.delete(&created.id).await.unwrap();
    assert_eq!(deleted.unwrap().id, created.id);
    assert!(store.get(&created.id).await.unwrap().is_none());

    let persisted: serde_json::Value = serde_json::from_slice(
        &std::fs::read(temp.path().join("game_data/lighting_presets.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(persisted["version"], 1);
    assert!(persisted["users"].as_array().unwrap().is_empty());
    assert!(persisted["favorites"].as_object().unwrap().is_empty());
}

#[test]
fn missing_preset_fields_use_compatible_defaults() {
    let preset: LightingPreset = serde_json::from_str("{}").unwrap();

    assert!(preset.id.is_empty());
    assert!(preset.origin_id.is_none());
    assert_eq!(preset.revision, 1);
    assert_eq!(preset.kind, PresetKind::User);
    assert!(preset.name.is_empty());
    assert!(preset.i18n_key.is_none());
    assert!(preset.description.is_empty());
    assert!(preset.aliases.is_empty());
    assert!(preset.tags.is_empty());
    assert!(preset.category.is_empty());
    assert!(!preset.favorite);
    assert!(preset.last_used_at.is_none());
    assert_eq!(preset.lighting, Default::default());
    assert!(preset.created_at.is_empty());
    assert!(preset.updated_at.is_empty());
}

#[test]
fn builtin_presets_have_stable_chinese_and_english_aliases() {
    let aliases = builtin_presets()
        .into_iter()
        .map(|preset| (preset.id, preset.aliases))
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(aliases["builtin:neutral"], ["中性", "Neutral"]);
    assert_eq!(
        aliases["builtin:cold-backlight"],
        ["冷色逆光", "Cold Backlight"]
    );
    assert_eq!(
        aliases["builtin:warm-side"],
        ["暖阳侧光", "Warm Side Light"]
    );
    assert_eq!(aliases["builtin:moonlight"], ["月夜", "Moonlight"]);
    assert_eq!(
        aliases["builtin:indoor-soft"],
        ["室内柔光", "Indoor Soft Light"]
    );
}

#[test]
fn builtin_ids_are_unique_stable_and_normalized() {
    let presets = builtin_presets();
    let expected = [
        "builtin:neutral",
        "builtin:cold-backlight",
        "builtin:warm-side",
        "builtin:moonlight",
        "builtin:indoor-soft",
    ];

    assert_eq!(presets.len(), expected.len());
    assert_eq!(
        presets
            .iter()
            .map(|preset| preset.id.as_str())
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(
        presets
            .iter()
            .map(|preset| &preset.id)
            .collect::<HashSet<_>>()
            .len(),
        expected.len()
    );
    for preset in presets {
        let mut normalized = preset.lighting.clone();
        normalized.normalize();
        assert_eq!(preset.lighting, normalized);
        assert_eq!(preset.kind, PresetKind::BuiltIn);
    }
}
