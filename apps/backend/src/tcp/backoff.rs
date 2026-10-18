use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct Backoff {
    initial: Duration,
    maximum: Duration,
    jitter_percent: u8,
    attempt: u32,
    random_state: u64,
}

impl Backoff {
    pub fn new(initial: Duration, maximum: Duration, jitter_percent: u8) -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(1, |duration| duration.as_nanos() as u64);
        Self::with_seed(initial, maximum, jitter_percent, seed)
    }

    pub fn with_seed(initial: Duration, maximum: Duration, jitter_percent: u8, seed: u64) -> Self {
        assert!(initial > Duration::ZERO, "initial backoff must be positive");
        assert!(
            maximum >= initial,
            "maximum backoff must not be smaller than initial"
        );
        assert!(jitter_percent <= 100, "jitter percentage cannot exceed 100");

        Self {
            initial,
            maximum,
            jitter_percent,
            attempt: 0,
            random_state: seed.max(1),
        }
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    pub fn next_delay(&mut self) -> Duration {
        let multiplier = 1_u32.checked_shl(self.attempt.min(31)).unwrap_or(u32::MAX);
        let base = self.initial.saturating_mul(multiplier).min(self.maximum);
        self.attempt = self.attempt.saturating_add(1);

        if self.jitter_percent == 0 {
            return base;
        }

        let base_millis = base.as_millis().min(u128::from(u64::MAX)) as u64;
        let jitter = base_millis.saturating_mul(u64::from(self.jitter_percent)) / 100;
        if jitter == 0 {
            return base;
        }

        let spread = jitter.saturating_mul(2).saturating_add(1);
        let sampled = self.next_random() % spread;
        let adjusted = base_millis
            .saturating_sub(jitter)
            .saturating_add(sampled)
            .min(self.maximum.as_millis().min(u128::from(u64::MAX)) as u64);

        Duration::from_millis(adjusted)
    }

    fn next_random(&mut self) -> u64 {
        let mut value = self.random_state;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.random_state = value;
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grows_exponentially_and_caps_at_maximum() {
        let mut backoff =
            Backoff::with_seed(Duration::from_millis(100), Duration::from_millis(350), 0, 1);

        assert_eq!(backoff.next_delay(), Duration::from_millis(100));
        assert_eq!(backoff.next_delay(), Duration::from_millis(200));
        assert_eq!(backoff.next_delay(), Duration::from_millis(350));
        assert_eq!(backoff.next_delay(), Duration::from_millis(350));
    }

    #[test]
    fn reset_returns_to_initial_delay() {
        let mut backoff =
            Backoff::with_seed(Duration::from_millis(100), Duration::from_secs(1), 0, 1);
        backoff.next_delay();
        backoff.next_delay();

        backoff.reset();

        assert_eq!(backoff.next_delay(), Duration::from_millis(100));
    }

    #[test]
    fn jitter_stays_inside_configured_range() {
        let mut backoff = Backoff::with_seed(
            Duration::from_millis(1_000),
            Duration::from_secs(10),
            20,
            42,
        );

        let delay = backoff.next_delay();

        assert!((Duration::from_millis(800)..=Duration::from_millis(1_200)).contains(&delay));
    }
}
