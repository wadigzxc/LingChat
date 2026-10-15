use super::*;

fn path(root: &std::path::Path) -> std::path::PathBuf {
    root.join("game_data/lighting_presets.json")
}

#[tokio::test]
async fn retrieval_is_read_only_even_for_application_accessors() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let user = store.create(LightingPresetDraft::default()).await.unwrap();
    let before = std::fs::read(path(root.path())).unwrap();
    for id in [user.id.as_str(), "builtin:neutral"] {
        let snapshot = store.get(id).await.unwrap().unwrap();
        assert!(snapshot.last_used_at.is_none());
    }
    store.list(PresetSort::RecentlyUsed).await.unwrap();
    assert_eq!(
        std::fs::read(path(root.path())).unwrap(),
        before,
        "retrieval/preview is not a successful application"
    );
}

async fn service(root: &std::path::Path) -> crate::ai_service::service::AIService {
    crate::ai_service::service::AIService::new(
        sea_orm::DatabaseConnection::default(),
        root.to_path_buf(),
        Default::default(),
        Default::default(),
        None,
        false,
        10,
        10,
        Default::default(),
        false,
    )
    .await
}

#[tokio::test]
async fn successful_manual_and_ai_use_persist_builtin_and_user_metadata_only() {
    use crate::ai_service::game_system::scene_transition::SceneLightingSource;
    use crate::api::scene_lighting::apply_preset_with;
    for source in [
        SceneLightingSource::ManualPreset,
        SceneLightingSource::AiPreset,
    ] {
        let root = tempfile::tempdir().unwrap();
        let store = LightingPresetStore::new(root.path());
        let user = store.create(LightingPresetDraft::default()).await.unwrap();
        let service = service(root.path()).await;
        for id in ["builtin:neutral", user.id.as_str()] {
            let original = store.get(id).await.unwrap().unwrap();
            let payload = apply_preset_with(&service, &store, id, source, |p| {
                assert_eq!(p.preset_id.as_deref(), Some(id));
                Ok(())
            })
            .await
            .unwrap();
            assert_eq!(payload.active_lighting, original.lighting);
            let saved = LightingPresetStore::new(root.path())
                .get(id)
                .await
                .unwrap()
                .unwrap();
            assert!(
                saved.last_used_at.is_some(),
                "successful command must persist usage: {id}"
            );
            let mut expected = original;
            expected.last_used_at = saved.last_used_at.clone();
            assert_eq!(saved, expected);
            assert_eq!(
                store.list(PresetSort::RecentlyUsed).await.unwrap()[0].id,
                id
            );
        }
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path(root.path())).unwrap()).unwrap();
        assert_eq!(
            json["users"].as_array().unwrap().len(),
            1,
            "do not copy builtin effects"
        );
    }
}

#[tokio::test]
async fn repeated_success_is_strictly_ordered_even_when_wall_clock_is_behind() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(path(root.path()).parent().unwrap()).unwrap();
    std::fs::write(path(root.path()), br#"{"version":1,"users":[],"favorites":{},"recent":{"builtin:neutral":"2099-01-01T00:00:00.000Z"}}"#).unwrap();
    let store = LightingPresetStore::new(root.path());
    let mut previous = store
        .get("builtin:neutral")
        .await
        .unwrap()
        .unwrap()
        .last_used_at
        .unwrap();
    for id in ["builtin:neutral", "builtin:moonlight", "builtin:neutral"] {
        store
            .with_successful_use(Some(id), |_| async { Ok(()) })
            .await
            .unwrap();
        let reopened = LightingPresetStore::new(root.path());
        let current = reopened
            .get(id)
            .await
            .unwrap()
            .unwrap()
            .last_used_at
            .unwrap();
        assert!(
            current > previous,
            "same-ms/backward clock cannot undo success order: {previous} -> {current}"
        );
        assert_eq!(
            chrono::DateTime::parse_from_rfc3339(&current)
                .unwrap()
                .timestamp_millis()
                - chrono::DateTime::parse_from_rfc3339(&previous)
                    .unwrap()
                    .timestamp_millis(),
            1,
            "a tied/older wall clock advances the durable logical clock by one millisecond"
        );
        assert_eq!(
            reopened.list(PresetSort::RecentlyUsed).await.unwrap()[0].id,
            id
        );
        previous = current;
    }
}

#[tokio::test]
async fn manager_writes_cannot_forge_erase_or_resurrect_authoritative_usage() {
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let user = store.create(LightingPresetDraft::default()).await.unwrap();
    store
        .with_successful_use(Some(&user.id), |_| async { Ok(()) })
        .await
        .unwrap();
    let used = store.get(&user.id).await.unwrap().unwrap().last_used_at;
    for stale in [None, Some("2000-01-01T00:00:00.000Z".into())] {
        let updated = store
            .update(
                &user.id,
                LightingPresetUpdate {
                    name: Some("Old editor draft".into()),
                    last_used_at: Some(stale),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            updated.last_used_at, used,
            "old manager draft must not erase usage"
        );
        assert_eq!(
            LightingPresetStore::new(root.path())
                .get(&user.id)
                .await
                .unwrap()
                .unwrap()
                .last_used_at,
            used
        );
    }
    let forged = store
        .create(LightingPresetDraft {
            last_used_at: Some("2099-01-01T00:00:00.000Z".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(forged.last_used_at.is_none(), "CRUD is not successful use");
    let replaced = store
        .import_transaction(|users, _| {
            let mut old = users.iter().find(|p| p.id == user.id).unwrap().clone();
            old.last_used_at = None;
            *users.iter_mut().find(|p| p.id == user.id).unwrap() = old.clone();
            Ok(old)
        })
        .await
        .unwrap();
    assert_eq!(
        replaced.last_used_at, used,
        "import return value must project canonical usage"
    );
    store.set_favorite(&user.id, true).await.unwrap();
    assert_eq!(
        store.get(&user.id).await.unwrap().unwrap().last_used_at,
        used
    );
    store.delete(&user.id).await.unwrap();
    let json: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path(root.path())).unwrap()).unwrap();
    assert!(
        json["recent"].get(&user.id).is_none(),
        "deleted sources cannot leave resurrectable usage"
    );
}

#[tokio::test]
async fn legacy_array_and_v1_catalog_reads_do_not_migrate_but_next_write_projects_usage() {
    for array in [true, false] {
        let root = tempfile::tempdir().unwrap();
        let user = LightingPreset {
            id: "user:legacy".into(),
            favorite: true,
            last_used_at: Some("2026-01-01T00:00:00.000Z".into()),
            ..Default::default()
        };
        let json = if array {
            serde_json::json!([user])
        } else {
            serde_json::json!({"version":1,"users":[user],"favorites":{"user:legacy":true}})
        };
        let before = serde_json::to_vec(&json).unwrap();
        std::fs::create_dir_all(path(root.path()).parent().unwrap()).unwrap();
        std::fs::write(path(root.path()), &before).unwrap();
        let store = LightingPresetStore::new(root.path());
        assert_eq!(store.get(&user.id).await.unwrap(), Some(user.clone()));
        store.list(PresetSort::RecentlyUsed).await.unwrap();
        store.get(&user.id).await.unwrap();
        assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
        store.set_favorite("builtin:neutral", true).await.unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path(root.path())).unwrap()).unwrap();
        assert_eq!(json["recent"][&user.id], user.last_used_at.clone().unwrap());
        assert!(json["users"][0].get("last_used_at").is_none());
        assert_eq!(
            LightingPresetStore::new(root.path())
                .get(&user.id)
                .await
                .unwrap(),
            Some(user)
        );
    }
}

#[tokio::test]
async fn failed_application_publication_keeps_runtime_but_never_usage() {
    use crate::ai_service::game_system::scene_transition::SceneLightingSource;
    use crate::api::scene_lighting::apply_preset_with;
    for source in [
        SceneLightingSource::ManualPreset,
        SceneLightingSource::AiPreset,
    ] {
        let root = tempfile::tempdir().unwrap();
        let store = LightingPresetStore::new(root.path());
        let user = store.create(LightingPresetDraft::default()).await.unwrap();
        let service = service(root.path()).await;
        for id in [user.id.as_str(), "builtin:moonlight"] {
            let before = std::fs::read(path(root.path())).unwrap();
            let error = apply_preset_with(&service, &store, id, source, |_| {
                Err("publication failure".into())
            })
            .await
            .unwrap_err();
            assert_eq!(error, "publication failure");
            assert_eq!(
                service
                    .game_status
                    .lock()
                    .await
                    .active_lighting_preset_id
                    .as_deref(),
                Some(id)
            );
            assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
            assert!(
                LightingPresetStore::new(root.path())
                    .get(id)
                    .await
                    .unwrap()
                    .unwrap()
                    .last_used_at
                    .is_none()
            );
        }
    }
}

#[tokio::test]
async fn failed_application_resolution_or_conversion_never_updates_runtime_or_usage() {
    use crate::ai_service::game_system::scene_transition::SceneLightingSource;
    use crate::api::scene_lighting::apply_preset_with;
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let user = store.create(LightingPresetDraft::default()).await.unwrap();
    let service = service(root.path()).await;
    let before = std::fs::read(path(root.path())).unwrap();
    for id in ["", "builtin:missing", "user:missing"] {
        assert!(
            apply_preset_with(
                &service,
                &store,
                id,
                SceneLightingSource::ManualPreset,
                |_| panic!("must not publish")
            )
            .await
            .is_err()
        );
    }
    {
        service.game_status.lock().await.current_scene_id = Some("missing".into());
    }
    assert!(
        apply_preset_with(
            &service,
            &store,
            &user.id,
            SceneLightingSource::AiPreset,
            |_| panic!("must not publish")
        )
        .await
        .unwrap_err()
        .contains("当前场景不存在")
    );
    {
        let mut gs = service.game_status.lock().await;
        gs.current_scene_id = None;
        gs.lighting_revision = u64::MAX;
    }
    assert!(
        apply_preset_with(
            &service,
            &store,
            "builtin:neutral",
            SceneLightingSource::ManualPreset,
            |_| panic!("must not publish")
        )
        .await
        .unwrap_err()
        .contains("revision 已达到上限")
    );
    assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
    assert!(
        service
            .game_status
            .lock()
            .await
            .active_lighting_preset_id
            .is_none()
    );
}

#[tokio::test]
async fn application_snapshot_operation_publication_and_usage_block_all_catalog_mutators() {
    use crate::ai_service::game_system::scene_transition::SceneLightingSource;
    use crate::api::scene_lighting::apply_preset_with;
    use futures_util::poll;
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let user = store.create(LightingPresetDraft::default()).await.unwrap();
    let removed = store.create(LightingPresetDraft::default()).await.unwrap();
    let service = service(root.path()).await;
    let held = service.game_status.lock().await;
    let before = std::fs::read(path(root.path())).unwrap();
    let mut application = Box::pin(apply_preset_with(
        &service,
        &store,
        &user.id,
        SceneLightingSource::ManualPreset,
        |p| {
            assert_eq!(p.preset_revision, Some(1));
            assert_eq!(
                std::fs::read(path(root.path())).unwrap(),
                before,
                "usage is after publication"
            );
            Ok(())
        },
    ));
    assert!(poll!(application.as_mut()).is_pending());
    let mut update = Box::pin(store.update(
        &user.id,
        LightingPresetUpdate {
            name: Some("Queued".into()),
            ..Default::default()
        },
    ));
    let mut import = Box::pin(store.import_transaction(|users, _| {
        let mut replaced = users.iter().find(|p| p.id == user.id).unwrap().clone();
        replaced.last_used_at = None;
        *users.iter_mut().find(|p| p.id == user.id).unwrap() = replaced.clone();
        Ok(replaced)
    }));
    let mut favorite = Box::pin(store.set_favorite("builtin:neutral", true));
    let mut create = Box::pin(store.create(LightingPresetDraft::default()));
    let mut delete = Box::pin(store.delete(&removed.id));
    let mut read = Box::pin(store.list(PresetSort::RecentlyUsed));
    assert!(poll!(update.as_mut()).is_pending());
    assert!(poll!(import.as_mut()).is_pending());
    assert!(poll!(favorite.as_mut()).is_pending());
    assert!(poll!(create.as_mut()).is_pending());
    assert!(poll!(delete.as_mut()).is_pending());
    assert!(poll!(read.as_mut()).is_pending());
    assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
    drop(held);
    application.await.unwrap();
    let (updated, imported, favorite, created, deleted, listed) =
        tokio::join!(update, import, favorite, create, delete, read);
    assert_eq!(updated.unwrap().revision, 2);
    assert!(imported.unwrap().last_used_at.is_some());
    assert!(favorite.unwrap().favorite);
    assert!(created.unwrap().last_used_at.is_none());
    assert!(deleted.unwrap().is_some());
    assert_eq!(listed.unwrap()[0].id, user.id);
    let reopened = LightingPresetStore::new(root.path());
    let latest = reopened.get(&user.id).await.unwrap().unwrap();
    assert_eq!(latest.name, "Queued");
    assert!(latest.last_used_at.is_some());
    assert_eq!(
        service
            .game_status
            .lock()
            .await
            .active_lighting_preset_revision,
        Some(1),
        "queued CRUD cannot replace the applied snapshot"
    );
    assert!(reopened.get(&removed.id).await.unwrap().is_none());
}

#[tokio::test]
async fn real_archive_overwrite_keeps_authoritative_recent_use_and_dto_shape() {
    use crate::api::lighting_archive::export::export_linglight_path;
    use crate::api::lighting_archive::r#import::{
        ImportStrategy, commit_linglight_import_inner, inspect_linglight_path,
    };
    use crate::api::lighting_archive::{ArchiveLimits, LingLightImportState, validate_linglight};
    let root = tempfile::tempdir().unwrap();
    let store = LightingPresetStore::new(root.path());
    let user = store.create(LightingPresetDraft::default()).await.unwrap();
    let archive = root.path().join("old.linglight");
    export_linglight_path(&user.id, &archive, &store, root.path())
        .await
        .unwrap();
    let validated = validate_linglight(&archive, ArchiveLimits::default()).unwrap();
    let metadata = serde_json::to_value(validated.manifest).unwrap();
    assert!(metadata["metadata"].get("last_used_at").is_none());
    let state = LingLightImportState::default();
    let inspection = inspect_linglight_path(&archive, &state, &store)
        .await
        .unwrap();
    store
        .with_successful_use(Some(&user.id), |_| async { Ok(()) })
        .await
        .unwrap();
    let used = store.get(&user.id).await.unwrap().unwrap().last_used_at;
    let imported = commit_linglight_import_inner(
        &inspection.token,
        ImportStrategy::OverwriteSameOrigin,
        false,
        &state,
        &store,
        root.path(),
    )
    .await
    .unwrap()
    .preset;
    assert_eq!(imported.last_used_at, used);
    assert_eq!(
        LightingPresetStore::new(root.path())
            .get(&user.id)
            .await
            .unwrap()
            .unwrap()
            .last_used_at,
        used
    );
}

#[tokio::test]
async fn legacy_timestamp_precision_and_offsets_sort_by_actual_success_time() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(path(root.path()).parent().unwrap()).unwrap();
    std::fs::write(path(root.path()), br#"[{"id":"user:old","last_used_at":"2099-01-01T00:00:00Z"},{"id":"user:older","last_used_at":"2099-01-01T01:00:00+02:00"}]"#).unwrap();
    let store = LightingPresetStore::new(root.path());
    assert_eq!(
        store.list(PresetSort::RecentlyUsed).await.unwrap()[0].id,
        "user:old",
        "legacy offsets are instants, not lexicographic strings"
    );
    store
        .with_successful_use(Some("builtin:neutral"), |_| async { Ok(()) })
        .await
        .unwrap();
    assert_eq!(
        LightingPresetStore::new(root.path())
            .list(PresetSort::RecentlyUsed)
            .await
            .unwrap()[0]
            .id,
        "builtin:neutral",
        "millisecond usage must rank above earlier second-precision history"
    );
}

#[cfg(windows)]
#[tokio::test]
async fn real_windows_usage_replace_failure_keeps_catalog_and_retry_commits_after_publication() {
    use crate::ai_service::game_system::scene_transition::SceneLightingSource;
    use crate::api::scene_lighting::apply_preset_with;
    use std::os::windows::fs::OpenOptionsExt;
    for builtin in [true, false] {
        let root = tempfile::tempdir().unwrap();
        let store = LightingPresetStore::new(root.path());
        let user = store.create(LightingPresetDraft::default()).await.unwrap();
        let id = if builtin {
            "builtin:moonlight"
        } else {
            user.id.as_str()
        };
        let service = service(root.path()).await;
        let before = std::fs::read(path(root.path())).unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(path(root.path()))
            .unwrap();
        let published = std::cell::Cell::new(false);
        let error = apply_preset_with(
            &service,
            &store,
            id,
            SceneLightingSource::ManualPreset,
            |_| {
                published.set(true);
                Ok(())
            },
        )
        .await
        .unwrap_err();
        assert!(error.contains("写入光影预设失败"));
        assert!(
            published.get(),
            "runtime/publication precedes usage replacement failure"
        );
        assert_eq!(
            service
                .game_status
                .lock()
                .await
                .active_lighting_preset_id
                .as_deref(),
            Some(id)
        );
        assert_eq!(std::fs::read(path(root.path())).unwrap(), before);
        assert_eq!(
            std::fs::read_dir(path(root.path()).parent().unwrap())
                .unwrap()
                .count(),
            1,
            "atomic temp files must be cleaned after actual Windows replacement failure"
        );
        assert!(
            LightingPresetStore::new(root.path())
                .get(id)
                .await
                .unwrap()
                .unwrap()
                .last_used_at
                .is_none()
        );
        println!(
            "real Windows usage replacement denied: {error}; builtin={builtin}; bytes={}",
            before.len()
        );
        drop(held);
        apply_preset_with(&service, &store, id, SceneLightingSource::AiPreset, |_| {
            Ok(())
        })
        .await
        .unwrap();
        assert!(
            LightingPresetStore::new(root.path())
                .get(id)
                .await
                .unwrap()
                .unwrap()
                .last_used_at
                .is_some()
        );
    }
}
