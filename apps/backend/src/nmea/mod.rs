//! NMEA sentence parsing and checksum validation.

mod parser;

pub use parser::{NmeaSentence, ParseError, SentenceKind, parse_sentence};
