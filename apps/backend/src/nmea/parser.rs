use std::{error::Error, fmt, str::FromStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SentenceKind {
    Aivdm,
    Aivdo,
}

impl fmt::Display for SentenceKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Aivdm => formatter.write_str("AIVDM"),
            Self::Aivdo => formatter.write_str("AIVDO"),
        }
    }
}

impl FromStr for SentenceKind {
    type Err = ParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "AIVDM" => Ok(Self::Aivdm),
            "AIVDO" => Ok(Self::Aivdo),
            other => Err(ParseError::UnsupportedSentence(other.to_owned())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NmeaSentence {
    pub kind: SentenceKind,
    pub fragment_count: u8,
    pub fragment_number: u8,
    pub sequence_id: Option<String>,
    pub channel: Option<char>,
    pub payload: String,
    pub fill_bits: u8,
    pub checksum: u8,
    pub raw: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    Empty,
    MissingStartDelimiter,
    MissingChecksum,
    InvalidChecksum(String),
    ChecksumMismatch { provided: u8, calculated: u8 },
    InvalidFieldCount { actual: usize },
    UnsupportedSentence(String),
    InvalidNumber { field: &'static str, value: String },
    InvalidFragmentRange { number: u8, count: u8 },
    InvalidChannel(String),
    EmptyPayload,
    InvalidFillBits(u8),
}

impl fmt::Display for ParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("empty NMEA sentence"),
            Self::MissingStartDelimiter => formatter.write_str("NMEA sentence must start with '!'"),
            Self::MissingChecksum => formatter.write_str("NMEA sentence is missing '*HH' checksum"),
            Self::InvalidChecksum(value) => write!(formatter, "invalid checksum '{value}'"),
            Self::ChecksumMismatch {
                provided,
                calculated,
            } => write!(
                formatter,
                "checksum mismatch: provided {provided:02X}, calculated {calculated:02X}"
            ),
            Self::InvalidFieldCount { actual } => {
                write!(formatter, "expected 7 NMEA fields, received {actual}")
            }
            Self::UnsupportedSentence(value) => {
                write!(formatter, "unsupported NMEA sentence '{value}'")
            }
            Self::InvalidNumber { field, value } => {
                write!(formatter, "invalid {field} value '{value}'")
            }
            Self::InvalidFragmentRange { number, count } => write!(
                formatter,
                "fragment number {number} is outside fragment count {count}"
            ),
            Self::InvalidChannel(value) => write!(formatter, "invalid radio channel '{value}'"),
            Self::EmptyPayload => formatter.write_str("AIS payload cannot be empty"),
            Self::InvalidFillBits(value) => {
                write!(
                    formatter,
                    "fill bits must be between 0 and 5, received {value}"
                )
            }
        }
    }
}

impl Error for ParseError {}

pub fn parse_sentence(input: &str) -> Result<NmeaSentence, ParseError> {
    let raw = input.trim_end_matches(&['\r', '\n'][..]);
    if raw.is_empty() {
        return Err(ParseError::Empty);
    }

    let without_start = raw
        .strip_prefix('!')
        .ok_or(ParseError::MissingStartDelimiter)?;
    let (body, checksum_text) = without_start
        .rsplit_once('*')
        .ok_or(ParseError::MissingChecksum)?;

    if checksum_text.len() != 2 || !checksum_text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ParseError::InvalidChecksum(checksum_text.to_owned()));
    }

    let provided = u8::from_str_radix(checksum_text, 16)
        .map_err(|_| ParseError::InvalidChecksum(checksum_text.to_owned()))?;
    let calculated = calculate_checksum(body);
    if provided != calculated {
        return Err(ParseError::ChecksumMismatch {
            provided,
            calculated,
        });
    }

    let fields: Vec<&str> = body.split(',').collect();
    if fields.len() != 7 {
        return Err(ParseError::InvalidFieldCount {
            actual: fields.len(),
        });
    }

    let kind = fields[0].parse()?;
    let fragment_count = parse_u8("fragment count", fields[1])?;
    let fragment_number = parse_u8("fragment number", fields[2])?;
    if fragment_count == 0 || fragment_number == 0 || fragment_number > fragment_count {
        return Err(ParseError::InvalidFragmentRange {
            number: fragment_number,
            count: fragment_count,
        });
    }

    let sequence_id = optional_string(fields[3]);
    let channel = parse_channel(fields[4])?;
    let payload = fields[5];
    if payload.is_empty() {
        return Err(ParseError::EmptyPayload);
    }

    let fill_bits = parse_u8("fill bits", fields[6])?;
    if fill_bits > 5 {
        return Err(ParseError::InvalidFillBits(fill_bits));
    }

    Ok(NmeaSentence {
        kind,
        fragment_count,
        fragment_number,
        sequence_id,
        channel,
        payload: payload.to_owned(),
        fill_bits,
        checksum: provided,
        raw: raw.to_owned(),
    })
}

fn calculate_checksum(body: &str) -> u8 {
    body.bytes().fold(0, |checksum, byte| checksum ^ byte)
}

fn parse_u8(field: &'static str, value: &str) -> Result<u8, ParseError> {
    value.parse().map_err(|_| ParseError::InvalidNumber {
        field,
        value: value.to_owned(),
    })
}

fn optional_string(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

fn parse_channel(value: &str) -> Result<Option<char>, ParseError> {
    if value.is_empty() {
        return Ok(None);
    }

    let mut characters = value.chars();
    let channel = characters
        .next()
        .ok_or_else(|| ParseError::InvalidChannel(value.to_owned()))?;
    if characters.next().is_some() || !channel.is_ascii_alphanumeric() {
        return Err(ParseError::InvalidChannel(value.to_owned()));
    }

    Ok(Some(channel))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SINGLE_FRAGMENT: &str = "!AIVDM,1,1,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,0*49";

    #[test]
    fn parses_valid_aivdm_sentence() {
        let sentence = parse_sentence(SINGLE_FRAGMENT).expect("sentence should be valid");

        assert_eq!(sentence.kind, SentenceKind::Aivdm);
        assert_eq!(sentence.fragment_count, 1);
        assert_eq!(sentence.fragment_number, 1);
        assert_eq!(sentence.sequence_id, None);
        assert_eq!(sentence.channel, Some('A'));
        assert_eq!(sentence.fill_bits, 0);
        assert_eq!(sentence.checksum, 0x49);
    }

    #[test]
    fn accepts_crlf_terminated_sentence() {
        assert!(parse_sentence(&format!("{SINGLE_FRAGMENT}\r\n")).is_ok());
    }

    #[test]
    fn parses_valid_aivdo_sentence() {
        let sentence = parse_sentence("!AIVDO,1,1,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,0*4B")
            .expect("sentence should be valid");

        assert_eq!(sentence.kind, SentenceKind::Aivdo);
    }

    #[test]
    fn rejects_checksum_mismatch() {
        assert_eq!(
            parse_sentence("!AIVDM,1,1,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,0*00"),
            Err(ParseError::ChecksumMismatch {
                provided: 0x00,
                calculated: 0x49,
            })
        );
    }

    #[test]
    fn rejects_fragment_number_outside_count() {
        let body = "AIVDM,1,2,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,0";
        let sentence = format!("!{body}*{:02X}", calculate_checksum(body));

        assert_eq!(
            parse_sentence(&sentence),
            Err(ParseError::InvalidFragmentRange {
                number: 2,
                count: 1,
            })
        );
    }

    #[test]
    fn rejects_invalid_fill_bits() {
        let body = "AIVDM,1,1,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,6";
        let sentence = format!("!{body}*{:02X}", calculate_checksum(body));

        assert_eq!(
            parse_sentence(&sentence),
            Err(ParseError::InvalidFillBits(6))
        );
    }
}
