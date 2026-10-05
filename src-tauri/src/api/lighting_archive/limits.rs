#[derive(Debug, Clone, Copy)]
pub struct ArchiveLimits {
    pub max_archive_bytes: u64,
    pub max_total_uncompressed_bytes: u64,
    pub max_compression_ratio: u64,
    pub max_manifest_bytes: u64,
    pub max_png_bytes: u64,
    pub max_png_edge: u32,
    pub max_layers: usize,
    pub max_entries: usize,
    pub max_text_bytes: usize,
    pub max_metadata_items: usize,
}

impl Default for ArchiveLimits {
    fn default() -> Self {
        Self {
            max_archive_bytes: 100 * 1024 * 1024,
            max_total_uncompressed_bytes: 100 * 1024 * 1024,
            max_compression_ratio: 100,
            max_manifest_bytes: 1024 * 1024,
            max_png_bytes: 20 * 1024 * 1024,
            max_png_edge: 4096,
            max_layers: 8,
            max_entries: 10,
            max_text_bytes: 16 * 1024,
            max_metadata_items: 64,
        }
    }
}
