use std::fs::{File, Metadata};
use std::io::{self, Read};
use std::path::Path;

pub(super) fn open_file(path: &Path, max_bytes: u64) -> io::Result<(File, Metadata)> {
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    if metadata.len() > max_bytes {
        return Err(size_limit_error());
    }
    Ok((file, metadata))
}

pub(super) fn read_chunks(
    reader: &mut impl Read,
    max_bytes: u64,
    mut consume: impl FnMut(&[u8]),
) -> io::Result<u64> {
    let mut buffer = [0_u8; 8192];
    let mut total = 0_u64;
    loop {
        let read_len = max_bytes
            .saturating_sub(total)
            .saturating_add(1)
            .min(buffer.len() as u64) as usize;
        let count = match reader.read(&mut buffer[..read_len]) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if count == 0 {
            return Ok(total);
        }
        if count as u64 > max_bytes.saturating_sub(total) {
            return Err(size_limit_error());
        }
        total += count as u64;
        consume(&buffer[..count]);
    }
}

fn size_limit_error() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "文件大小超出上限")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct CountingReader {
        file: File,
        bytes_read: u64,
    }

    impl Read for CountingReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let count = self.file.read(buffer)?;
            self.bytes_read += count as u64;
            Ok(count)
        }
    }

    #[test]
    fn task20_bounded_reader_accepts_empty_short_and_exact_limit() {
        for (bytes, limit) in [(vec![], 0), (vec![1, 2, 3], 8), (vec![7; 8192], 8192)] {
            let mut output = Vec::new();
            let count = read_chunks(&mut std::io::Cursor::new(&bytes), limit, |chunk| {
                output.extend_from_slice(chunk);
            })
            .unwrap();
            assert_eq!(count, bytes.len() as u64);
            assert_eq!(output, bytes);
        }
    }

    #[test]
    fn task20_bounded_reader_rejects_first_byte_at_zero_limit() {
        let mut reader = std::io::Cursor::new([1, 2, 3]);
        let mut consumed = 0;
        let error = read_chunks(&mut reader, 0, |chunk| consumed += chunk.len()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(reader.position(), 1);
        assert_eq!(consumed, 0);
    }

    #[test]
    fn task20_read_time_growth_stops_after_limit_plus_one() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("growing.linglight");
        let limit = 8192;
        std::fs::write(&path, vec![7; limit as usize]).unwrap();
        let (file, metadata) = open_file(&path, limit).unwrap();
        assert_eq!(metadata.len(), limit);
        let mut reader = CountingReader {
            file,
            bytes_read: 0,
        };
        let mut consumed = 0;
        let mut grown = false;
        let mut hasher = sha2::Sha256::new();
        use sha2::Digest;
        let result = read_chunks(&mut reader, limit, |chunk| {
            consumed += chunk.len() as u64;
            hasher.update(chunk);
            // Grow the real file only after its metadata was accepted and the
            // first chunk was read, without a race or a synthetic limit model.
            if !grown {
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .unwrap()
                    .write_all(&[9; 32])
                    .unwrap();
                grown = true;
            }
        });
        let error = result.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("大小超出上限"));
        assert_eq!(reader.bytes_read, limit + 1);
        assert_eq!(consumed, limit);
    }
}
