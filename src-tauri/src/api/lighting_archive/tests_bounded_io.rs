//! Real-file read observation; thread-local and RAII-scoped to isolated fixtures.
use std::cell::RefCell;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

#[derive(Default)]
struct Observation {
    path: PathBuf,
    grow_to: Option<u64>,
    bytes_read: u64,
    opened_size: Option<u64>,
}

thread_local! {
    static OBSERVATION: RefCell<Option<Observation>> = const { RefCell::new(None) };
}

pub(in crate::api::lighting_archive) struct ReadProbe;

impl ReadProbe {
    pub(in crate::api::lighting_archive) fn new(path: &Path, grow_to: Option<u64>) -> Self {
        OBSERVATION.with(|slot| {
            assert!(slot.borrow().is_none());
            *slot.borrow_mut() = Some(Observation {
                path: path.to_path_buf(),
                grow_to,
                ..Default::default()
            });
        });
        Self
    }

    pub(in crate::api::lighting_archive) fn bytes_read(&self) -> u64 {
        OBSERVATION.with(|slot| slot.borrow().as_ref().unwrap().bytes_read)
    }

    pub(in crate::api::lighting_archive) fn opened_size(&self) -> Option<u64> {
        OBSERVATION.with(|slot| slot.borrow().as_ref().unwrap().opened_size)
    }
}

impl Drop for ReadProbe {
    fn drop(&mut self) {
        OBSERVATION.with(|slot| *slot.borrow_mut() = None);
    }
}

pub(crate) struct ObservedFile {
    file: File,
    path: PathBuf,
}

pub(crate) fn observe(file: File, path: &Path) -> ObservedFile {
    OBSERVATION.with(|slot| {
        if let Some(observation) = slot.borrow_mut().as_mut() {
            if observation.path == path {
                observation.opened_size = Some(file.metadata().unwrap().len());
            }
        }
    });
    ObservedFile {
        file,
        path: path.to_path_buf(),
    }
}

impl Read for ObservedFile {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        // Keep the unbounded RED finite and grow once, after a real read.
        let read_len = buffer.len().min(8192);
        let count = self.file.read(&mut buffer[..read_len])?;
        OBSERVATION.with(|slot| -> io::Result<()> {
            if let Some(observation) = slot.borrow_mut().as_mut() {
                if observation.path == self.path {
                    observation.bytes_read += count as u64;
                    if count != 0 {
                        if let Some(size) = observation.grow_to.take() {
                            File::options()
                                .write(true)
                                .open(&self.path)?
                                .set_len(size)?;
                        }
                    }
                }
            }
            Ok(())
        })?;
        Ok(count)
    }
}
