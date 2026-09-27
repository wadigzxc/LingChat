use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use chrono::{DateTime, SecondsFormat, Utc};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::ValidatedLingLight;

const DEFAULT_TTL: Duration = Duration::from_secs(10 * 60);
const DEFAULT_MAX_PENDING: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceFingerprint {
    canonical_path: PathBuf,
    size: u64,
    modified_nanos: u128,
    sha256: String,
}

impl SourceFingerprint {
    pub(crate) fn capture(path: &std::path::Path) -> Result<Self, ImportStateError> {
        let canonical_path = std::fs::canonicalize(path)
            .map_err(|error| ImportStateError::SourceUnavailable(error.to_string()))?;
        let metadata = std::fs::metadata(&canonical_path)
            .map_err(|error| ImportStateError::SourceUnavailable(error.to_string()))?;
        let modified_nanos = metadata
            .modified()
            .map_err(|error| ImportStateError::SourceUnavailable(error.to_string()))?
            .duration_since(SystemTime::UNIX_EPOCH)
            .map_err(|_| {
                ImportStateError::SourceUnavailable("source mtime is before epoch".into())
            })?
            .as_nanos();
        let bytes = std::fs::read(&canonical_path)
            .map_err(|error| ImportStateError::SourceUnavailable(error.to_string()))?;
        Ok(Self {
            canonical_path,
            size: metadata.len(),
            modified_nanos,
            sha256: format!("{:x}", Sha256::digest(bytes)),
        })
    }

    pub(crate) fn verify_unchanged(&self) -> Result<(), ImportStateError> {
        let current = Self::capture(&self.canonical_path)?;
        if current == *self {
            Ok(())
        } else {
            Err(ImportStateError::SourceChanged)
        }
    }
}

#[derive(Debug)]
pub(crate) struct PendingImport {
    pub(crate) validated: ValidatedLingLight,
    pub(crate) fingerprint: SourceFingerprint,
}

#[derive(Debug)]
struct Session {
    pending: PendingImport,
    expires_at: Instant,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ImportStateError {
    #[error("导入会话无效、已取消或已被使用")]
    InvalidToken,
    #[error("导入会话已过期，请重新检查文件")]
    Expired,
    #[error("待确认的导入会话过多，请先完成或取消已有会话")]
    CapacityReached,
    #[error("源文件在检查后已发生变化，请重新检查")]
    SourceChanged,
    #[error("无法读取导入源文件: {0}")]
    SourceUnavailable(String),
}

/// Owns validated staging directories between inspect and commit.
///
/// Lock order rule: callers may take this state lock first, but must release it
/// before awaiting `LightingPresetStore`. No code holds both locks at once.
#[derive(Debug)]
pub struct LingLightImportState {
    sessions: Mutex<HashMap<String, Session>>,
    ttl: Duration,
    max_pending: usize,
}

impl Default for LingLightImportState {
    fn default() -> Self {
        Self::new(DEFAULT_TTL, DEFAULT_MAX_PENDING)
    }
}

impl LingLightImportState {
    pub(crate) fn new(ttl: Duration, max_pending: usize) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            ttl,
            max_pending,
        }
    }

    pub(crate) fn insert(
        &self,
        validated: ValidatedLingLight,
        fingerprint: SourceFingerprint,
    ) -> Result<(String, String), ImportStateError> {
        let mut sessions = self.sessions.lock().expect("linglight state poisoned");
        cleanup_locked(&mut sessions);
        if sessions.len() >= self.max_pending {
            return Err(ImportStateError::CapacityReached);
        }
        let token = Uuid::new_v4().as_simple().to_string();
        let expires_at = Instant::now() + self.ttl;
        let expires_at_wall = SystemTime::now() + self.ttl;
        sessions.insert(
            token.clone(),
            Session {
                pending: PendingImport {
                    validated,
                    fingerprint,
                },
                expires_at,
            },
        );
        let expires_at: DateTime<Utc> = expires_at_wall.into();
        Ok((
            token,
            expires_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        ))
    }

    pub(crate) fn consume(&self, token: &str) -> Result<PendingImport, ImportStateError> {
        let mut sessions = self.sessions.lock().expect("linglight state poisoned");
        let Some(session) = sessions.remove(token) else {
            cleanup_locked(&mut sessions);
            return Err(ImportStateError::InvalidToken);
        };
        if session.expires_at <= Instant::now() {
            return Err(ImportStateError::Expired);
        }
        Ok(session.pending)
    }

    pub fn cancel(&self, token: &str) -> Result<(), ImportStateError> {
        let mut sessions = self.sessions.lock().expect("linglight state poisoned");
        cleanup_locked(&mut sessions);
        sessions
            .remove(token)
            .map(drop)
            .ok_or(ImportStateError::InvalidToken)
    }

    pub fn cleanup_expired(&self) -> usize {
        let mut sessions = self.sessions.lock().expect("linglight state poisoned");
        cleanup_locked(&mut sessions)
    }

    #[cfg(test)]
    fn pending_count(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}

fn cleanup_locked(sessions: &mut HashMap<String, Session>) -> usize {
    let before = sessions.len();
    let now = Instant::now();
    sessions.retain(|_, session| session.expires_at > now);
    before - sessions.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_service::game_system::lighting::LightingParams;
    use crate::api::lighting_archive::{
        LingLightManifest, OriginMetadata, PresetSnapshot, ValidatedLingLight,
    };

    fn pending(marker: &std::path::Path) -> PendingImportFixture {
        std::fs::write(marker, b"package").unwrap();
        let fingerprint = SourceFingerprint::capture(marker).unwrap();
        let staging = tempfile::tempdir().unwrap();
        let staging_path = staging.path().to_path_buf();
        PendingImportFixture {
            validated: ValidatedLingLight {
                manifest: LingLightManifest {
                    format: "linglight".into(),
                    version: 1,
                    required_capabilities: vec![],
                    optional_capabilities: vec![],
                    preset: PresetSnapshot {
                        name: "test".into(),
                        description: String::new(),
                        aliases: vec![],
                        tags: vec![],
                        category: String::new(),
                        lighting: LightingParams::default(),
                    },
                    origin: OriginMetadata {
                        id: "origin".into(),
                        revision: 1,
                        created_by: None,
                    },
                    assets: vec![],
                },
                assets: vec![],
                warnings: vec![],
                staging,
            },
            fingerprint,
            staging_path,
        }
    }

    struct PendingImportFixture {
        validated: ValidatedLingLight,
        fingerprint: SourceFingerprint,
        staging_path: PathBuf,
    }

    #[test]
    fn token_is_single_use() {
        let temp = tempfile::tempdir().unwrap();
        let state = LingLightImportState::default();
        let fixture = pending(&temp.path().join("source.linglight"));
        let (token, _) = state
            .insert(fixture.validated, fixture.fingerprint)
            .unwrap();
        assert!(state.consume(&token).is_ok());
        assert_eq!(
            state.consume(&token).unwrap_err(),
            ImportStateError::InvalidToken
        );
    }

    #[test]
    fn cancel_and_drop_release_staging() {
        let temp = tempfile::tempdir().unwrap();
        let state = LingLightImportState::default();
        let fixture = pending(&temp.path().join("source.linglight"));
        let staging = fixture.staging_path.clone();
        let (token, _) = state
            .insert(fixture.validated, fixture.fingerprint)
            .unwrap();
        state.cancel(&token).unwrap();
        assert!(!staging.exists());

        let fixture = pending(&temp.path().join("source-2.linglight"));
        let staging = fixture.staging_path.clone();
        state
            .insert(fixture.validated, fixture.fingerprint)
            .unwrap();
        drop(state);
        assert!(!staging.exists());
    }

    #[test]
    fn expired_sessions_are_rejected_and_cleaned() {
        let temp = tempfile::tempdir().unwrap();
        let state = LingLightImportState::new(Duration::ZERO, 4);
        let fixture = pending(&temp.path().join("source.linglight"));
        let (token, _) = state
            .insert(fixture.validated, fixture.fingerprint)
            .unwrap();
        assert_eq!(
            state.consume(&token).unwrap_err(),
            ImportStateError::Expired
        );
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn explicit_cleanup_releases_expired_staging() {
        let temp = tempfile::tempdir().unwrap();
        let state = LingLightImportState::new(Duration::ZERO, 4);
        let fixture = pending(&temp.path().join("source.linglight"));
        let staging = fixture.staging_path.clone();
        state
            .insert(fixture.validated, fixture.fingerprint)
            .unwrap();
        assert_eq!(state.cleanup_expired(), 1);
        assert!(!staging.exists());
    }

    #[test]
    fn concurrent_cancel_and_consume_have_one_winner() {
        let temp = tempfile::tempdir().unwrap();
        let state = std::sync::Arc::new(LingLightImportState::default());
        let fixture = pending(&temp.path().join("source.linglight"));
        let (token, _) = state
            .insert(fixture.validated, fixture.fingerprint)
            .unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let cancel = {
            let state = state.clone();
            let token = token.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                state.cancel(&token).is_ok()
            })
        };
        barrier.wait();
        let consumed = state.consume(&token).is_ok();
        assert_ne!(cancel.join().unwrap(), consumed);
        assert_eq!(state.pending_count(), 0);
    }

    #[test]
    fn pending_sessions_are_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let state = LingLightImportState::new(Duration::from_secs(60), 1);
        let first = pending(&temp.path().join("first.linglight"));
        state.insert(first.validated, first.fingerprint).unwrap();
        let second = pending(&temp.path().join("second.linglight"));
        assert_eq!(
            state
                .insert(second.validated, second.fingerprint)
                .unwrap_err(),
            ImportStateError::CapacityReached
        );
    }
}
