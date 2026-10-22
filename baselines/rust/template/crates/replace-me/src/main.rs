//! `replace-me`: reports lines wider than a limit.
//!
//! A thin shell around `replace-me-core`: parse arguments, run the command,
//! hand the result to [`output::emit`]. The CLI contract (stdout shape, error
//! codes, exit codes) is documented and enforced in `output`, the only module
//! that prints.

use std::process::ExitCode;

use clap::Parser;

mod cli;
mod output;

fn main() -> ExitCode {
    let cli = cli::Cli::parse();
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
