//! AIVDM payload decoding.
//!
//! The first implementation will cover message types 1, 2, 3, 5, 18, 19 and
//! 24 and convert them into protocol-independent domain events.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportedMessageType {
    ClassAPosition1,
    ClassAPosition2,
    ClassAPosition3,
    ClassAStaticAndVoyage,
    ClassBPosition,
    ClassBExtendedPosition,
    ClassBStaticData,
}
