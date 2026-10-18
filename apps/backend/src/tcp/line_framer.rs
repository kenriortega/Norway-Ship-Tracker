const DEFAULT_MAX_LINE_LENGTH: usize = 4_096;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct FrameBatch {
    pub lines: Vec<String>,
    pub dropped_oversized: usize,
    pub invalid_utf8: usize,
}

#[derive(Debug)]
pub struct LineFramer {
    buffer: Vec<u8>,
    max_line_length: usize,
    discarding_oversized: bool,
}

impl Default for LineFramer {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_LINE_LENGTH)
    }
}

impl LineFramer {
    pub fn new(max_line_length: usize) -> Self {
        assert!(max_line_length > 0, "maximum line length must be positive");
        Self {
            buffer: Vec::with_capacity(max_line_length.min(512)),
            max_line_length,
            discarding_oversized: false,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> FrameBatch {
        let mut batch = FrameBatch::default();

        for &byte in chunk {
            if self.discarding_oversized {
                if byte == b'\n' {
                    self.discarding_oversized = false;
                }
                continue;
            }

            if byte == b'\n' {
                self.emit_buffered_line(&mut batch);
                continue;
            }

            if self.buffer.len() == self.max_line_length {
                self.buffer.clear();
                self.discarding_oversized = true;
                batch.dropped_oversized += 1;
                continue;
            }

            self.buffer.push(byte);
        }

        batch
    }

    pub fn finish(&mut self) -> FrameBatch {
        let mut batch = FrameBatch::default();
        if self.discarding_oversized {
            self.discarding_oversized = false;
        } else if !self.buffer.is_empty() {
            self.emit_buffered_line(&mut batch);
        }
        batch
    }

    fn emit_buffered_line(&mut self, batch: &mut FrameBatch) {
        if self.buffer.last() == Some(&b'\r') {
            self.buffer.pop();
        }

        if self.buffer.is_empty() {
            return;
        }

        match String::from_utf8(std::mem::take(&mut self.buffer)) {
            Ok(line) => batch.lines.push(line),
            Err(_) => batch.invalid_utf8 += 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_lines_split_across_chunks() {
        let mut framer = LineFramer::default();

        assert!(framer.push(b"!AIVDM,1").lines.is_empty());
        assert_eq!(
            framer.push(b",1\r\n!AIVDO,1,1\n").lines,
            vec!["!AIVDM,1,1", "!AIVDO,1,1"]
        );
    }

    #[test]
    fn returns_unterminated_final_line() {
        let mut framer = LineFramer::default();
        framer.push(b"!AIVDM,1,1");

        assert_eq!(framer.finish().lines, vec!["!AIVDM,1,1"]);
    }

    #[test]
    fn drops_oversized_line_and_resynchronizes() {
        let mut framer = LineFramer::new(4);

        let batch = framer.push(b"12345 discarded\nok\n");

        assert_eq!(batch.dropped_oversized, 1);
        assert_eq!(batch.lines, vec!["ok"]);
    }

    #[test]
    fn counts_invalid_utf8() {
        let mut framer = LineFramer::default();

        let batch = framer.push(&[0xff, b'\n']);

        assert_eq!(batch.invalid_utf8, 1);
        assert!(batch.lines.is_empty());
    }
}
