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
#![expect(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "the CLI's one output module"
)]

use std::error::Error as _;
use std::iter;
use std::path::PathBuf;
use std::process::ExitCode;

use replace_me_core::{Error, Finding};
use serde::Serialize;

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

    fn print_human(&self) {
        match self {
            Self::Check {
                path,
                max_width,
                findings,
            } => {
                let path = terminal_safe(&path.display().to_string());
                for Finding { line, width } in findings {
                    println!("{path}:{line}: {width} characters, limit {max_width}");
                }
                match findings.len() {
                    0 => println!("no lines over {max_width} characters"),
                    1 => println!("1 line over {max_width} characters"),
                    n => println!("{n} lines over {max_width} characters"),
                }
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
        (Format::Human, Ok(outcome)) => {
            outcome.print_human();
            outcome.exit().into()
        }
        (Format::Json, Ok(outcome)) => {
            print_json(&Success {
                ok: true,
                data: &outcome,
            });
            outcome.exit().into()
        }
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
            print_json(&Failure {
                ok: false,
                error: body,
            });
            Exit::Error.into()
        }
    }
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

fn print_json(value: &impl Serialize) {
    match serde_json::to_string_pretty(value) {
        Ok(json) => println!("{json}"),
        // Only a path that isn't valid Unicode can get here.
        Err(error) => eprintln!("error: could not encode the result as JSON: {error}"),
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
}
