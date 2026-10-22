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
            tracing::debug!(path = %path.display(), max_width, "checking");
            let text = read_source(path)?;
            Ok(Outcome::Check {
                path: path.clone(),
                max_width: *max_width,
                findings: check(&text, *max_width),
            })
        }
    }
}
