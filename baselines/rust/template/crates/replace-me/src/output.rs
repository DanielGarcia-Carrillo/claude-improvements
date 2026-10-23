//! The CLI contract, and the only module that prints.
//!
//! - **stdout** carries the result: text, or with `--json` exactly one JSON
//!   document, `{"ok": true, "data": …}` or `{"ok": false, "error": …}`.
//! - **stderr** carries logs, and errors in text mode.
//! - **Exit codes**: 0 clean, 1 findings reported, 2 usage or input error
//!   (clap also exits 2 on bad arguments). A panic exits 101 and is a bug.
//! - **Error codes** (`error.code`) come from `replace_me_core::Error::code` and
//!   never change meaning.
//! - **Human output escapes control characters** in anything that came from
//!   input, such as a file name, so it can't drive the terminal. JSON needs
//!   nothing extra: `serde_json` escapes them.
//! - **Paths that aren't valid Unicode** appear with U+FFFD in place of the
//!   bad bytes, in both formats, so `--json` always prints its document.
#![expect(clippy::print_stderr, reason = "the CLI's one output module")]

use std::error::Error as _;
use std::io::{self, Write};
use std::iter;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use replace_me_core::{Error, Finding};
use serde::{Serialize, Serializer};

#[derive(Debug, Clone, Copy)]
pub(crate) enum Format {
    Human,
    Json,
}

/// What a successful command produced.
#[derive(Debug, Serialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub(crate) enum Outcome {
    Check {
        #[serde(serialize_with = "lossy_path")]
        path: PathBuf,
        max_width: usize,
        findings: Vec<Finding>,
    },
}

#[derive(Debug, Clone, Copy)]
enum Exit {
    Clean,
    Findings,
    Error,
}

impl From<Exit> for ExitCode {
    fn from(exit: Exit) -> Self {
        match exit {
            Exit::Clean => Self::SUCCESS,
            Exit::Findings => Self::from(1),
            Exit::Error => Self::from(2),
        }
    }
}

impl Outcome {
    fn exit(&self) -> Exit {
        match self {
            Self::Check { findings, .. } if findings.is_empty() => Exit::Clean,
            Self::Check { .. } => Exit::Findings,
        }
    }

    fn write_human(&self, out: &mut impl Write) -> io::Result<()> {
        match self {
            Self::Check {
                path,
                max_width,
                findings,
            } => {
                let path = terminal_safe(&path.display().to_string());
                for Finding { line, width } in findings {
                    writeln!(out, "{path}:{line}: {width} characters, limit {max_width}")?;
                }
                match findings.len() {
                    0 => writeln!(out, "no lines over {max_width} characters")?,
                    1 => writeln!(out, "1 line over {max_width} characters")?,
                    n => writeln!(out, "{n} lines over {max_width} characters")?,
                }
                out.flush()
            }
        }
    }
}

#[derive(Serialize)]
struct Success<'a> {
    ok: bool,
    data: &'a Outcome,
}

#[derive(Serialize)]
struct Failure<'a> {
    ok: bool,
    error: ErrorBody<'a>,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: String,
    hint: &'a str,
    causes: Vec<String>,
}

/// Prints the result in the requested format and returns the exit code.
pub(crate) fn emit(format: Format, result: Result<Outcome, Error>) -> ExitCode {
    match (format, result) {
        (Format::Human, Ok(outcome)) => finish(
            outcome.write_human(&mut io::stdout().lock()),
            outcome.exit(),
        ),
        (Format::Json, Ok(outcome)) => print_json(
            &Success {
                ok: true,
                data: &outcome,
            },
            outcome.exit(),
        ),
        (Format::Human, Err(error)) => {
            eprintln!("error: {}", terminal_safe(&error.to_string()));
            for cause in causes(&error) {
                eprintln!("  caused by: {}", terminal_safe(&cause));
            }
            eprintln!("  hint: {}", error.hint());
            Exit::Error.into()
        }
        (Format::Json, Err(error)) => {
            let body = ErrorBody {
                code: error.code(),
                message: error.to_string(),
                hint: error.hint(),
                causes: causes(&error),
            };
            print_json(
                &Failure {
                    ok: false,
                    error: body,
                },
                Exit::Error,
            )
        }
    }
}

/// Serialises a path as a string, lossily, so a path that isn't valid
/// Unicode can't fail the whole document.
fn lossy_path<S: Serializer>(path: &Path, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&path.to_string_lossy())
}

/// The error's source chain, outermost first, without the error itself.
fn causes(error: &Error) -> Vec<String> {
    iter::successors(error.source(), |&cause| cause.source())
        .map(ToString::to_string)
        .collect()
}

/// `text` with control characters escaped (ESC becomes `\u{1b}`), so a
/// crafted file name can't move the cursor, recolour the terminal or write to
/// the clipboard of whoever reads the output.
fn terminal_safe(text: &str) -> String {
    let mut safe = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_control() {
            safe.extend(c.escape_default());
        } else {
            safe.push(c);
        }
    }
    safe
}

/// Prints `value` and returns `exit`, or exits 2 if it can't be encoded: a
/// caller must never see a clean exit with no document.
fn print_json(value: &impl Serialize, exit: Exit) -> ExitCode {
    match serde_json::to_string_pretty(value) {
        Ok(json) => finish(writeln!(io::stdout().lock(), "{json}"), exit),
        Err(error) => {
            eprintln!("error: could not encode the result as JSON: {error}");
            Exit::Error.into()
        }
    }
}

/// `exit` once the result is written. A reader that stops early (`| head`)
/// closes the pipe, which isn't an error: exit quietly with the result's
/// code. Any other write failure exits 2, since the caller has no result.
fn finish(written: io::Result<()>, exit: Exit) -> ExitCode {
    match written {
        Err(error) if error.kind() != io::ErrorKind::BrokenPipe => {
            eprintln!("error: could not write the result: {error}");
            Exit::Error.into()
        }
        _ => exit.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_characters_reach_the_terminal_escaped() {
        assert_eq!(
            terminal_safe("notes\u{1b}]52;c;aGk=\u{7}.txt"),
            "notes\\u{1b}]52;c;aGk=\\u{7}.txt"
        );
    }

    #[test]
    fn ordinary_text_is_unchanged() {
        assert_eq!(terminal_safe("dir/é file.txt"), "dir/é file.txt");
    }

    #[test]
    fn a_reader_that_stops_early_keeps_the_result_s_exit_code() {
        let closed = io::Error::from(io::ErrorKind::BrokenPipe);
        assert_eq!(finish(Err(closed), Exit::Findings), Exit::Findings.into());
    }

    #[test]
    fn any_other_write_failure_exits_2() {
        let full = io::Error::from(io::ErrorKind::StorageFull);
        assert_eq!(finish(Err(full), Exit::Clean), Exit::Error.into());
    }

    #[cfg(unix)]
    #[test]
    fn a_path_that_isnt_unicode_still_encodes() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt as _;

        let outcome = Outcome::Check {
            path: PathBuf::from(OsStr::from_bytes(b"bad\xff.txt")),
            max_width: 100,
            findings: Vec::new(),
        };
        let json = serde_json::to_string(&Success {
            ok: true,
            data: &outcome,
        })
        .expect("a lossy path always encodes");
        assert!(json.contains("\"path\":\"bad\u{fffd}.txt\""), "{json}");
    }
}
