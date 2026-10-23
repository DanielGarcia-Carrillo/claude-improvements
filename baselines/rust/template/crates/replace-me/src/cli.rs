use std::ffi::OsString;
use std::path::PathBuf;

use clap::{Parser, Subcommand};
use replace_me_core::{Error, check, read_source};

use crate::output::{Format, Outcome};

/// Reports lines wider than a limit.
#[derive(Debug, Parser)]
#[command(version, about)]
pub(crate) struct Cli {
    /// Print exactly one JSON document on stdout instead of text.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    pub(crate) command: Command,
}

impl Cli {
    pub(crate) fn format(&self) -> Format {
        if self.json {
            Format::Json
        } else {
            Format::Human
        }
    }
}

/// The format a command line asks for, program name first, for an error
/// clap raises before there is a [`Cli`] to ask. Anything after `--` is a
/// value, so a file named `--json` doesn't count.
pub(crate) fn requested_format(args: impl IntoIterator<Item = OsString>) -> Format {
    let mut args = args.into_iter().skip(1).take_while(|arg| arg != "--");
    if args.any(|arg| arg == "--json") {
        Format::Json
    } else {
        Format::Human
    }
}

#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Report every line wider than `--max-width`.
    Check {
        /// The file to check.
        path: PathBuf,
        /// The widest a line may be, in characters.
        #[arg(long, default_value_t = 100)]
        max_width: usize,
    },
}

/// Adding a subcommand: a variant above, an arm here, an `Outcome` variant
/// with its exit status and human rendering in `output`, and a CLI test.
pub(crate) fn run(command: &Command) -> Result<Outcome, Error> {
    match command {
        Command::Check { path, max_width } => {
            // Debug (`?`) escapes control characters; the formatter writes a
            // Display field (`%`) as is, so a file name could drive the terminal.
            tracing::debug!(path = ?path, max_width, "checking");
            let text = read_source(path)?;
            Ok(Outcome::Check {
                path: path.clone(),
                max_width: *max_width,
                findings: check(&text, *max_width),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn requested(args: &[&str]) -> Format {
        requested_format(args.iter().map(OsString::from))
    }

    #[test]
    fn json_counts_anywhere_before_the_terminator() {
        assert_eq!(requested(&["replace-me", "check", "--json"]), Format::Json);
        assert_eq!(requested(&["replace-me", "--json", "check"]), Format::Json);
    }

    #[test]
    fn json_after_the_terminator_is_a_file_name() {
        assert_eq!(
            requested(&["replace-me", "check", "--", "--json"]),
            Format::Human
        );
    }
}
