use std::{
    env,
    error::Error,
    fs::File,
    io::{self, Read},
    process::ExitCode,
};

use norway_ship_tracker_backend::{
    nmea::{SentenceKind, parse_sentence},
    tcp::{FrameBatch, LineFramer},
};

const READ_BUFFER_SIZE: usize = 8 * 1024;
const MAX_REPORTED_ERRORS: usize = 10;

#[derive(Debug, Default, PartialEq, Eq)]
struct Metrics {
    lines: usize,
    valid: usize,
    invalid: usize,
    aivdm: usize,
    aivdo: usize,
    dropped_oversized: usize,
    invalid_utf8: usize,
}

#[derive(Debug)]
struct Options {
    path: String,
    strict: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(has_invalid) if has_invalid => ExitCode::from(2),
        Ok(_) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("ais-replay: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<bool, Box<dyn Error>> {
    let options = parse_options(env::args().skip(1))?;
    let metrics = if options.path == "-" {
        let stdin = io::stdin();
        process_reader(stdin.lock())?
    } else {
        let file = File::open(&options.path)?;
        process_reader(file)?
    };

    println!(
        "lines={} valid={} invalid={} aivdm={} aivdo={} dropped_oversized={} invalid_utf8={}",
        metrics.lines,
        metrics.valid,
        metrics.invalid,
        metrics.aivdm,
        metrics.aivdo,
        metrics.dropped_oversized,
        metrics.invalid_utf8
    );

    Ok(options.strict
        && (metrics.invalid > 0 || metrics.dropped_oversized > 0 || metrics.invalid_utf8 > 0))
}

fn parse_options(arguments: impl Iterator<Item = String>) -> Result<Options, &'static str> {
    let mut path = None;
    let mut strict = false;

    for argument in arguments {
        match argument.as_str() {
            "--strict" => strict = true,
            "-h" | "--help" => return Err("usage: ais-replay [--strict] <capture.nmea|->"),
            _ if path.is_none() => path = Some(argument),
            _ => return Err("usage: ais-replay [--strict] <capture.nmea|->"),
        }
    }

    Ok(Options {
        path: path.ok_or("usage: ais-replay [--strict] <capture.nmea|->")?,
        strict,
    })
}

fn process_reader(mut reader: impl Read) -> io::Result<Metrics> {
    let mut metrics = Metrics::default();
    let mut framer = LineFramer::default();
    let mut buffer = [0_u8; READ_BUFFER_SIZE];
    let mut reported_errors = 0;

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }

        process_batch(
            framer.push(&buffer[..read]),
            &mut metrics,
            &mut reported_errors,
        );
    }

    process_batch(framer.finish(), &mut metrics, &mut reported_errors);
    Ok(metrics)
}

fn process_batch(batch: FrameBatch, metrics: &mut Metrics, reported_errors: &mut usize) {
    metrics.dropped_oversized += batch.dropped_oversized;
    metrics.invalid_utf8 += batch.invalid_utf8;

    for line in batch.lines {
        metrics.lines += 1;
        match parse_sentence(&line) {
            Ok(sentence) => {
                metrics.valid += 1;
                match sentence.kind {
                    SentenceKind::Aivdm => metrics.aivdm += 1,
                    SentenceKind::Aivdo => metrics.aivdo += 1,
                }
            }
            Err(error) => {
                metrics.invalid += 1;
                if *reported_errors < MAX_REPORTED_ERRORS {
                    eprintln!("line {}: {error}", metrics.lines);
                    *reported_errors += 1;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn reports_valid_and_invalid_sentences() {
        let input = concat!(
            "!AIVDM,1,1,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,0*49\r\n",
            "!AIVDM,1,1,,A,15Muq?P0000G?t@E>4p@0?vN0<0u,0*00\n",
        );

        let metrics = process_reader(Cursor::new(input)).expect("replay should succeed");

        assert_eq!(
            metrics,
            Metrics {
                lines: 2,
                valid: 1,
                invalid: 1,
                aivdm: 1,
                ..Metrics::default()
            }
        );
    }
}
