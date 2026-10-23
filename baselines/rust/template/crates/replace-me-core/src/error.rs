use std::io;
use std::path::PathBuf;
use std::string::FromUtf8Error;

/// Everything that can go wrong reading input.
///
/// Each variant has a stable [`code`](Error::code) that scripts and agents
/// can match on, and a [`hint`](Error::hint) that says what to do about it.
/// The underlying cause is kept as the error's `source`, never folded into
/// the message, so a report prints each cause exactly once.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The input file could not be read.
    #[error("cannot read {}", path.display())]
    Read {
        /// The file that could not be read.
        path: PathBuf,
        /// Why the operating system refused.
        #[source]
        source: io::Error,
    },
    /// The input file is not UTF-8 text.
    #[error("{} is not UTF-8 text", path.display())]
    NotUtf8 {
        /// The file that is not UTF-8.
        path: PathBuf,
        /// Where decoding failed.
        #[source]
        source: FromUtf8Error,
    },
}

impl Error {
    /// A stable identifier, part of the CLI's JSON contract. Never change or
    /// reuse one; add a new code instead.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Read { .. } => "input.unreadable",
            Self::NotUtf8 { .. } => "input.not_utf8",
        }
    }

    /// What the caller can do to fix it.
    pub fn hint(&self) -> &'static str {
        match self {
            Self::Read { source, .. } if source.kind() == io::ErrorKind::NotFound => {
                "check the path; a relative path is resolved from the current directory"
            }
            Self::Read { .. } => "check that the file exists and is readable by this user",
            Self::NotUtf8 { .. } => "pass a UTF-8 text file, or convert this one first",
        }
    }
}
