//! Bounded reassembly of multi-fragment AIVDM payloads.

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FragmentKey {
    pub sequence_id: Option<String>,
    pub channel: Option<char>,
}
