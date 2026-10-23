//! The logic behind the `replace-me` CLI: finding lines wider than a limit.
//!
//! Everything here is pure or takes its input as an argument, so it is tested
//! without spawning the binary. The CLI crate owns argument parsing, output
//! and exit codes. Each public item is reachable at exactly one path: the
//! modules are private and re-exported here.

// Doctests are compiled outside the crate and don't inherit its lints; this
// holds their code to the same no-warnings bar.
#![doc(test(attr(deny(warnings))))]

mod error;
mod width;

pub use error::Error;
pub use width::{Finding, check, read_source};
