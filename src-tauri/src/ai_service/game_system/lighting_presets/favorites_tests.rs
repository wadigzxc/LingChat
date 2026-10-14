use super::*;

fn draft(name: &str) -> LightingPresetDraft {
    LightingPresetDraft {
        name: name.into(),
        ..Default::default()
    }
}

fn path(root: &std::path::Path) -> std::path::PathBuf {
    root.join("game_data/lighting_presets.json")
}

#[tokio::test]
async fn user_favorite_is_metadata_only_and_survives_disk_reconstruction() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let original = store.create(draft("User favorite")).await.unwrap();
    let mut expected = original.clone();
    for favorite in [true, true, false, false] {
        expected.favorite = favorite;
        let saved = store.set_favorite(&original.id, favorite).await.unwrap();
        assert_eq!(
            saved, expected,
            "favorite must not change effect revision, timestamps or recent use"
        );
        drop(saved);
        let reopened = LightingPresetStore::new(root.path());
        assert_eq!(
            reopened.get(&original.id).await.unwrap(),
            Some(expected.clone())
        );
        assert_eq!(
            reopened
                .list(PresetSort::FavoriteFirst)
                .await
                .unwrap()
                .into_iter()
                .find(|p| p.id == original.id),
            Some(expected.clone())
        );
    }
    println!(
        "real tmpdir reconstruction verified: {:?}",
        path(root.path())
    );
}

#[tokio::test]
async fn builtin_favorite_atomically_migrates_legacy_users_without_copying_builtin_effects() {
    let root = tempfile::tempdir().unwrap();
    let mut yes = LightingPreset {
        id: "user:legacy-yes".into(),
        favorite: true,
        ..Default::default()
    };
    yes.name = "Legacy true".into();
    let no = LightingPreset {
        id: "user:legacy-no".into(),
        favorite: false,
        ..Default::default()
    };
    let legacy = serde_json::to_vec_pretty(&vec![yes.clone(), no.clone()]).unwrap();
    std::fs::create_dir_all(path(root.path()).parent().unwrap()).unwrap();
    std::fs::write(path(root.path()), &legacy).unwrap();
    let store = LightingPresetStore::new(root.path());
    assert_eq!(store.get(&yes.id).await.unwrap(), Some(yes.clone()));
    assert_eq!(store.get(&no.id).await.unwrap(), Some(no.clone()));
    store.list(PresetSort::Name).await.unwrap();
    assert_eq!(
        std::fs::read(path(root.path())).unwrap(),
        legacy,
        "legacy reads must not migrate"
    );

    let mut builtin = builtin_presets()
        .into_iter()
        .find(|p| p.id == "builtin:neutral")
        .unwrap();
    builtin.favorite = true;
    let changed = store.set_favorite(&builtin.id, true).await;
    assert!(
        changed.is_ok(),
        "builtins must support independent favorite metadata: {changed:?}"
    );
    assert_eq!(changed.unwrap(), builtin);
    let catalog: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path(root.path())).unwrap()).unwrap();
    assert_eq!(catalog["version"], 1);
    assert_eq!(catalog["users"].as_array().unwrap().len(), 2);
    assert!(
        catalog["users"]
            .as_array()
            .unwrap()
            .iter()
            .all(|p| p["kind"] == "user" && p.get("favorite").is_none())
    );
    assert_eq!(catalog["favorites"][&yes.id], true);
    assert_eq!(catalog["favorites"][&no.id], false);
    assert_eq!(catalog["favorites"][&builtin.id], true);
    println!("migrated real catalog: {}", catalog);
    drop(store);
    let reopened = LightingPresetStore::new(root.path());
    assert_eq!(reopened.get(&yes.id).await.unwrap(), Some(yes));
    assert_eq!(reopened.get(&no.id).await.unwrap(), Some(no));
    assert_eq!(
        reopened.get(&builtin.id).await.unwrap(),
        Some(builtin.clone())
    );
    assert_eq!(
        reopened.take_for_application(&builtin.id).await.unwrap(),
        Some(builtin.clone())
    );
    assert_eq!(
        reopened
            .list(PresetSort::FavoriteFirst)
            .await
            .unwrap()
            .into_iter()
            .find(|p| p.id == builtin.id),
        Some(builtin.clone())
    );
    let bytes = std::fs::read(path(root.path())).unwrap();
    reopened.set_favorite(&builtin.id, true).await.unwrap();
    assert_eq!(
        std::fs::read(path(root.path())).unwrap(),
        bytes,
        "idempotent favorite must not rewrite"
    );
    assert!(
        reopened
            .update(
                &builtin.id,
                LightingPresetUpdate {
                    favorite: Some(false),
                    ..Default::default()
                }
            )
            .await
            .is_err()
    );
    assert!(reopened.delete(&builtin.id).await.is_err());
    builtin.favorite = false;
    assert_eq!(
        reopened.set_favorite(&builtin.id, false).await.unwrap(),
        builtin
    );
    assert_eq!(
        LightingPresetStore::new(root.path())
            .get(&builtin.id)
            .await
            .unwrap(),
        Some(builtin)
    );
}

#[tokio::test]
async fn corrupt_catalog_shapes_and_unknown_versions_are_rejected_without_replacement() {
    use serde_json::json;
    let cases = [
        json!({"version": 1, "users": [[]], "favorites": {}}),
        json!({"version": 1, "users": [{}], "favorites": {}}),
        json!({"version": 1, "users": [{"id": "builtin:neutral", "kind": "built_in"}], "favorites": {}}),
        json!({"version": 1, "users": [{"id": "user:same"}, {"id": "user:same"}], "favorites": {}}),
        json!({"version": 2, "users": [], "favorites": {}}),
        json!({"version": 1, "users": [], "favorites": []}),
        json!({"version": 1, "users": [], "favorites": {"builtin:neutral": "true"}}),
        json!({"version": 1, "users": {}, "favorites": {}}),
        json!({"version": 1, "favorites": {}}),
        json!({"users": [], "favorites": {}}),
        json!({"version": 1, "users": [], "favorites": {}, "extra": 1}),
        json!([[]]),
        json!({}),
        json!(null),
    ];
    for case in cases {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(path(root.path()).parent().unwrap()).unwrap();
        let bytes = serde_json::to_vec(&case).unwrap();
        std::fs::write(path(root.path()), &bytes).unwrap();
        let store = LightingPresetStore::new(root.path());
        assert!(
            store.list(PresetSort::Name).await.is_err(),
            "corrupt catalog was accepted: {case}"
        );
        assert!(store.get("builtin:neutral").await.is_err());
        assert!(store.take_for_application("builtin:neutral").await.is_err());
        assert!(
            store
                .create(draft("Must not erase corruption"))
                .await
                .is_err()
        );
        assert!(store.set_favorite("builtin:neutral", true).await.is_err());
        assert_eq!(std::fs::read(path(root.path())).unwrap(), bytes);
    }
}

#[tokio::test]
async fn missing_ids_and_idempotent_favorites_never_write_or_consume_save_failure() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    for id in ["", "builtin:missing", "user:missing"] {
        for favorite in [false, true] {
            assert!(store.set_favorite(id, favorite).await.is_err());
        }
    }
    assert!(!path(root.path()).exists());
    store.set_favorite("builtin:neutral", false).await.unwrap();
    assert!(!path(root.path()).exists());
    let preset = store.create(draft("Idempotent")).await.unwrap();
    let before = std::fs::read(path(root.path())).unwrap();
    store.fail_next_save_for_test();
    assert!(store.set_favorite("", true).await.is_err());
    assert_eq!(store.set_favorite(&preset.id, false).await.unwrap(), preset);
    assert!(
        store
            .set_favorite(&preset.id, true)
            .await
            .unwrap_err()
            .to_string()
            .contains("injected preset save failure")
    );
    assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
    assert_eq!(
        LightingPresetStore::new(root.path())
            .get(&preset.id)
            .await
            .unwrap(),
        Some(preset)
    );
}

#[tokio::test]
async fn canonical_metadata_wins_over_embedded_favorite_and_ordinary_update_preserves_it() {
    let root = tempfile::tempdir().unwrap();
    let preset = LightingPreset {
        id: "user:canonical".into(),
        favorite: true,
        ..Default::default()
    };
    let catalog = serde_json::json!({ "version": 1, "users": [preset], "favorites": {"user:canonical": false, "builtin:neutral": true} });
    std::fs::create_dir_all(path(root.path()).parent().unwrap()).unwrap();
    std::fs::write(path(root.path()), serde_json::to_vec(&catalog).unwrap()).unwrap();
    let store = LightingPresetStore::new(root.path());
    let mut expected = preset.clone();
    expected.favorite = false;
    assert_eq!(store.get(&preset.id).await.unwrap(), Some(expected.clone()));
    assert_eq!(
        store
            .list(PresetSort::Name)
            .await
            .unwrap()
            .into_iter()
            .find(|p| p.id == preset.id),
        Some(expected)
    );
    let taken = store
        .take_for_application(&preset.id)
        .await
        .unwrap()
        .unwrap();
    assert!(!taken.favorite);
    assert_eq!(taken.revision, preset.revision);
    assert_eq!(taken.updated_at, preset.updated_at);
    assert!(
        taken.last_used_at.is_some(),
        "retain the existing recent-use path"
    );
    let starred = store.set_favorite(&preset.id, true).await.unwrap();
    let updated = store
        .update(
            &preset.id,
            LightingPresetUpdate {
                name: Some("Draft name".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(
        updated.favorite,
        "omitted favorite must not resurrect a stale manager draft"
    );
    assert_eq!(
        updated.revision,
        starred.revision + 1,
        "ordinary update retains its existing revision behavior"
    );
    let explicit = store
        .update(
            &preset.id,
            LightingPresetUpdate {
                favorite: Some(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(
        !explicit.favorite,
        "explicit generic favorite payload remains supported"
    );
    let reopened = LightingPresetStore::new(root.path());
    assert_eq!(reopened.get(&preset.id).await.unwrap(), Some(explicit));
    assert!(
        reopened
            .get("builtin:neutral")
            .await
            .unwrap()
            .unwrap()
            .favorite
    );
}

#[tokio::test]
async fn deleting_user_cleans_only_its_favorite_metadata_and_preserves_shared_assets() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let created = store
        .create(LightingPresetDraft {
            favorite: true,
            ..draft("Deleted")
        })
        .await
        .unwrap();
    let survivor = store
        .create(LightingPresetDraft {
            favorite: true,
            ..draft("Survivor")
        })
        .await
        .unwrap();
    store.set_favorite("builtin:neutral", true).await.unwrap();
    let asset = root.path().join("game_data/lighting_assets/shared.png");
    std::fs::create_dir_all(asset.parent().unwrap()).unwrap();
    std::fs::write(&asset, b"shared asset bytes").unwrap();
    assert_eq!(
        store.delete(&created.id).await.unwrap(),
        Some(created.clone())
    );
    let catalog: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path(root.path())).unwrap()).unwrap();
    assert!(catalog["favorites"].get(&created.id).is_none());
    assert_eq!(catalog["favorites"][&survivor.id], true);
    assert_eq!(catalog["favorites"]["builtin:neutral"], true);
    assert_eq!(catalog["users"].as_array().unwrap().len(), 1);
    assert_eq!(std::fs::read(asset).unwrap(), b"shared asset bytes");
    let reopened = LightingPresetStore::new(root.path());
    assert!(reopened.get(&created.id).await.unwrap().is_none());
    assert_eq!(reopened.get(&survivor.id).await.unwrap(), Some(survivor));
}

#[tokio::test]
async fn injected_favorite_save_failure_preserves_legacy_migration_bytes_and_all_metadata() {
    for legacy in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let store = LightingPresetStore::new(root.path());
        let preset = store
            .create(LightingPresetDraft {
                favorite: true,
                ..draft("Failure")
            })
            .await
            .unwrap();
        if legacy {
            std::fs::write(
                path(root.path()),
                serde_json::to_vec(&vec![preset.clone()]).unwrap(),
            )
            .unwrap();
        }
        let before = std::fs::read(path(root.path())).unwrap();
        for (id, favorite) in [("builtin:neutral", true), (preset.id.as_str(), false)] {
            store.fail_next_save_for_test();
            assert!(
                store
                    .set_favorite(id, favorite)
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("injected preset save failure")
            );
            assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
            let reopened = LightingPresetStore::new(root.path());
            assert_eq!(
                reopened.get(&preset.id).await.unwrap(),
                Some(preset.clone())
            );
            assert!(
                !reopened
                    .get("builtin:neutral")
                    .await
                    .unwrap()
                    .unwrap()
                    .favorite
            );
        }
        println!(
            "injected save failure preserved {} real bytes; legacy={legacy}",
            before.len()
        );
        store.set_favorite("builtin:neutral", true).await.unwrap();
        assert!(
            LightingPresetStore::new(root.path())
                .get("builtin:neutral")
                .await
                .unwrap()
                .unwrap()
                .favorite
        );
    }
}

#[cfg(windows)]
#[tokio::test]
async fn real_windows_atomic_replace_failure_preserves_catalog_and_legacy_bytes() {
    use std::os::windows::fs::OpenOptionsExt;
    for legacy in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let store = LightingPresetStore::new(root.path());
        let preset = store.create(draft("Windows failure")).await.unwrap();
        if legacy {
            std::fs::write(
                path(root.path()),
                serde_json::to_vec(&vec![preset.clone()]).unwrap(),
            )
            .unwrap();
        }
        let before = std::fs::read(path(root.path())).unwrap();
        // A real open file allows reads/writes but denies replacement/deletion.
        let handle = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(path(root.path()))
            .unwrap();
        let error = store
            .set_favorite("builtin:neutral", true)
            .await
            .unwrap_err();
        assert!(format!("{error:#}").contains("原子替换目标文件失败"));
        assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
        assert_eq!(
            std::fs::read_dir(path(root.path()).parent().unwrap())
                .unwrap()
                .count(),
            1,
            "atomic temporary file must be cleaned up"
        );
        let reopened = LightingPresetStore::new(root.path());
        assert_eq!(reopened.get(&preset.id).await.unwrap(), Some(preset));
        assert!(
            !reopened
                .get("builtin:neutral")
                .await
                .unwrap()
                .unwrap()
                .favorite
        );
        println!(
            "real Windows replacement error; legacy={legacy}; bytes={}; {error:#}",
            before.len()
        );
        drop(handle);
        store.set_favorite("builtin:neutral", true).await.unwrap();
        assert!(
            LightingPresetStore::new(root.path())
                .get("builtin:neutral")
                .await
                .unwrap()
                .unwrap()
                .favorite
        );
    }
}

#[tokio::test]
async fn real_archive_roundtrip_and_same_origin_overwrite_preserve_canonical_favorites() {
    use crate::api::lighting_archive::export::export_linglight_path;
    use crate::api::lighting_archive::r#import::{
        ImportStrategy, commit_linglight_import_inner, inspect_linglight_path,
    };
    use crate::api::lighting_archive::{ArchiveLimits, LingLightImportState, validate_linglight};
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let source_store = LightingPresetStore::new(source.path());
    let source_preset = source_store
        .create(LightingPresetDraft {
            favorite: true,
            ..draft("Portable favorite")
        })
        .await
        .unwrap();
    let archive = source.path().join("snapshot.linglight");
    export_linglight_path(&source_preset.id, &archive, &source_store, source.path())
        .await
        .unwrap();
    let validated = validate_linglight(&archive, ArchiveLimits::default()).unwrap();
    let wire = serde_json::to_value(&validated.manifest).unwrap();
    assert!(
        wire["metadata"].get("favorite").is_none(),
        "local favorite must not change portable archive format"
    );
    let store = LightingPresetStore::new(target.path());
    store.set_favorite("builtin:neutral", true).await.unwrap();
    let state = LingLightImportState::default();
    let inspection = inspect_linglight_path(&archive, &state, &store)
        .await
        .unwrap();
    let imported = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::KeepBoth,
        false,
        &state,
        &store,
        target.path(),
    )
    .await
    .unwrap()
    .preset;
    assert!(
        !imported.favorite,
        "new portable copies retain existing unfavorited semantics"
    );
    assert_eq!(imported.lighting, source_preset.lighting);
    assert_eq!(imported.origin_id, source_preset.origin_id);
    for favorite in [true, false] {
        store.set_favorite(&imported.id, favorite).await.unwrap();
        let inspection = inspect_linglight_path(&archive, &state, &store)
            .await
            .unwrap();
        let replaced = commit_linglight_import_inner(
            &inspection.token,
            ImportStrategy::OverwriteSameOrigin,
            false,
            &state,
            &store,
            target.path(),
        )
        .await
        .unwrap()
        .preset;
        assert_eq!(replaced.favorite, favorite);
        assert_eq!(replaced.id, imported.id);
        assert_eq!(replaced.revision, source_preset.revision);
        assert_eq!(replaced.lighting, source_preset.lighting);
        let reopened = LightingPresetStore::new(target.path());
        assert_eq!(reopened.get(&imported.id).await.unwrap(), Some(replaced));
        assert!(
            reopened
                .get("builtin:neutral")
                .await
                .unwrap()
                .unwrap()
                .favorite
        );
    }
    println!("real export -> validate -> inspect -> commit -> overwrite -> fresh Store verified");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn favorites_crud_and_import_share_one_serialized_durable_transaction_lock() {
    use futures_util::poll;
    use std::sync::{Arc, mpsc};
    use std::time::Duration;
    for favorite_first in [true, false] {
        let root = tempfile::tempdir().unwrap();
        let store = Arc::new(LightingPresetStore::new(root.path()));
        let original = store
            .create(draft("Before concurrent update"))
            .await
            .unwrap();
        let deleted = store
            .create(LightingPresetDraft {
                favorite: true,
                ..draft("Concurrent delete")
            })
            .await
            .unwrap();
        let before = std::fs::read(path(root.path())).unwrap();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let importer = {
            let store = store.clone();
            tokio::spawn(async move {
                store
                    .import_transaction(move |users, builtins| {
                        assert!(
                            !builtins
                                .iter()
                                .find(|p| p.id == "builtin:neutral")
                                .unwrap()
                                .favorite
                        );
                        entered_tx.send(()).unwrap();
                        release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                        let imported = LightingPreset {
                            id: "user:concurrent-import".into(),
                            name: "Imported".into(),
                            favorite: true,
                            ..Default::default()
                        };
                        users.push(imported.clone());
                        Ok(imported)
                    })
                    .await
                    .unwrap()
            })
        };
        entered_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let mut favorite = Box::pin(store.set_favorite(&original.id, true));
        let mut builtin_favorite = Box::pin(store.set_favorite("builtin:neutral", true));
        let mut update = Box::pin(store.update(
            &original.id,
            LightingPresetUpdate {
                name: Some("After concurrent update".into()),
                ..Default::default()
            },
        ));
        let mut create = Box::pin(store.create(LightingPresetDraft {
            favorite: true,
            ..draft("Concurrent create")
        }));
        let mut delete = Box::pin(store.delete(&deleted.id));
        // Poll contenders once while the actual import callback holds the lock:
        // this establishes FIFO order without timing-based sleeps or mocks.
        if favorite_first {
            assert!(poll!(favorite.as_mut()).is_pending());
            assert!(poll!(update.as_mut()).is_pending());
        } else {
            assert!(poll!(update.as_mut()).is_pending());
            assert!(poll!(favorite.as_mut()).is_pending());
        }
        assert!(poll!(builtin_favorite.as_mut()).is_pending());
        assert!(poll!(create.as_mut()).is_pending());
        assert!(poll!(delete.as_mut()).is_pending());
        assert_eq!(
            std::fs::read(path(root.path())).unwrap(),
            before,
            "blocked contenders cannot publish before import commits"
        );
        release_tx.send(()).unwrap();
        let imported = importer.await.unwrap();
        let (favorite, builtin_favorite, updated, created, removed) =
            tokio::join!(favorite, builtin_favorite, update, create, delete);
        assert!(favorite.unwrap().favorite);
        assert!(builtin_favorite.unwrap().favorite);
        let updated = updated.unwrap();
        let created = created.unwrap();
        assert_eq!(removed.unwrap(), Some(deleted.clone()));
        let reopened = LightingPresetStore::new(root.path());
        let saved = reopened.get(&original.id).await.unwrap().unwrap();
        assert!(saved.favorite);
        assert_eq!(saved.name, "After concurrent update");
        assert_eq!(saved.revision, original.revision + 1);
        assert_eq!(saved.updated_at, updated.updated_at);
        assert_eq!(saved.lighting, original.lighting);
        assert_eq!(saved.last_used_at, original.last_used_at);
        assert_eq!(reopened.get(&imported.id).await.unwrap(), Some(imported));
        assert_eq!(reopened.get(&created.id).await.unwrap(), Some(created));
        assert!(reopened.get(&deleted.id).await.unwrap().is_none());
        assert!(
            reopened
                .get("builtin:neutral")
                .await
                .unwrap()
                .unwrap()
                .favorite
        );
        let catalog: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path(root.path())).unwrap()).unwrap();
        assert!(catalog["favorites"].get(&deleted.id).is_none());
        assert_eq!(catalog["users"].as_array().unwrap().len(), 3);
        println!(
            "import lock + queued favorite/update/create/delete rebuilt from disk; favorite_first={favorite_first}"
        );
    }
}
