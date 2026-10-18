use std::{
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use tokio::{
    fs::{self, File, OpenOptions},
    io::AsyncWriteExt,
};

const FILE_PREFIX: &str = "ais-";
const FILE_SUFFIX: &str = ".nmea";

pub struct RotatingCapture {
    directory: PathBuf,
    maximum_file_bytes: u64,
    maximum_files: usize,
    current_file: Option<File>,
    current_bytes: u64,
    sequence: u64,
}

impl RotatingCapture {
    pub async fn new(
        directory: impl Into<PathBuf>,
        maximum_file_bytes: u64,
        maximum_files: usize,
    ) -> Result<Self> {
        if maximum_file_bytes == 0 {
            bail!("capture maximum file size must be positive");
        }
        if maximum_files == 0 {
            bail!("capture must retain at least one file");
        }

        let directory = directory.into();
        fs::create_dir_all(&directory)
            .await
            .with_context(|| format!("failed to create {}", directory.display()))?;

        let capture = Self {
            directory,
            maximum_file_bytes,
            maximum_files,
            current_file: None,
            current_bytes: 0,
            sequence: 0,
        };
        capture.prune().await?;
        Ok(capture)
    }

    pub async fn write_sentence(&mut self, sentence: &str) -> Result<()> {
        let bytes_to_write = sentence.len() as u64 + 1;
        if self.current_file.is_some()
            && self.current_bytes > 0
            && self.current_bytes.saturating_add(bytes_to_write) > self.maximum_file_bytes
        {
            self.rotate().await?;
        }

        if self.current_file.is_none() {
            self.open_next_file().await?;
        }

        let file = self
            .current_file
            .as_mut()
            .context("capture file should be open")?;
        file.write_all(sentence.as_bytes()).await?;
        file.write_all(b"\n").await?;
        self.current_bytes = self.current_bytes.saturating_add(bytes_to_write);
        Ok(())
    }

    pub async fn flush(&mut self) -> Result<()> {
        if let Some(file) = self.current_file.as_mut() {
            file.flush().await.context("failed to flush capture file")?;
        }
        Ok(())
    }

    async fn rotate(&mut self) -> Result<()> {
        self.flush().await?;
        self.current_file = None;
        self.current_bytes = 0;
        Ok(())
    }

    async fn open_next_file(&mut self) -> Result<()> {
        loop {
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .context("system clock is before the Unix epoch")?
                .as_millis();
            let path = self.directory.join(format!(
                "{FILE_PREFIX}{timestamp}-{:06}{FILE_SUFFIX}",
                self.sequence
            ));
            self.sequence = self.sequence.saturating_add(1);

            match OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .await
            {
                Ok(file) => {
                    self.current_file = Some(file);
                    self.prune().await?;
                    return Ok(());
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("failed to create {}", path.display()));
                }
            }
        }
    }

    async fn prune(&self) -> Result<()> {
        let mut directory = fs::read_dir(&self.directory).await?;
        let mut captures = Vec::new();

        while let Some(entry) = directory.next_entry().await? {
            let file_type = entry.file_type().await?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if file_type.is_file() && is_capture_filename(&name) {
                captures.push(entry.path());
            }
        }

        captures.sort();
        let remove_count = captures.len().saturating_sub(self.maximum_files);
        for path in captures.into_iter().take(remove_count) {
            fs::remove_file(&path)
                .await
                .with_context(|| format!("failed to remove old capture {}", path.display()))?;
        }
        Ok(())
    }
}

fn is_capture_filename(name: &str) -> bool {
    name.starts_with(FILE_PREFIX) && name.ends_with(FILE_SUFFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rotates_and_only_prunes_owned_capture_files() {
        let directory = temporary_directory();
        fs::create_dir_all(&directory)
            .await
            .expect("temporary directory should be created");
        let unrelated = directory.join("keep.txt");
        fs::write(&unrelated, b"keep")
            .await
            .expect("unrelated file should be created");

        let mut capture = RotatingCapture::new(&directory, 12, 2)
            .await
            .expect("capture should initialize");
        capture
            .write_sentence("sentence-01")
            .await
            .expect("first sentence should be written");
        capture
            .write_sentence("sentence-02")
            .await
            .expect("second sentence should be written");
        capture
            .write_sentence("sentence-03")
            .await
            .expect("third sentence should be written");
        capture.flush().await.expect("capture should flush");

        let mut entries = fs::read_dir(&directory)
            .await
            .expect("temporary directory should be readable");
        let mut capture_count = 0;
        while let Some(entry) = entries
            .next_entry()
            .await
            .expect("directory entry should be readable")
        {
            if is_capture_filename(&entry.file_name().to_string_lossy()) {
                capture_count += 1;
            }
        }

        assert_eq!(capture_count, 2);
        assert!(unrelated.exists());
        fs::remove_dir_all(&directory)
            .await
            .expect("temporary directory should be removed");
    }

    fn temporary_directory() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("norway-ship-tracker-capture-{unique}"))
    }
}
