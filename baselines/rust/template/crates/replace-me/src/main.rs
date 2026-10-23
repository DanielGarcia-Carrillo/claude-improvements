//! `replace-me`: reports lines wider than a limit.
//!
//! A thin shell around `replace-me-core`: parse arguments, run the command,
//! hand the result to [`output::emit`]. The CLI contract (stdout shape, error
//! codes, exit codes) is documented and enforced in `output`, the only module
//! that prints.

use std::env;
use std::process::ExitCode;

use clap::Parser;

mod cli;
mod output;

fn main() -> ExitCode {
    // Not `parse()`, which prints clap's text and exits before `--json` can
    // put the error in a document.
    let cli = match cli::Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            return output::emit_parse_error(cli::requested_format(env::args_os()), &error);
        }
    };
    init_tracing();
    output::emit(cli.format(), cli::run(&cli.command))
}

/// Logs go to stderr, filtered by `RUST_LOG`, so stdout carries only the result.
fn init_tracing() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
}
