use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::Error;

/// A line wider than the limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Finding {
    /// One-based line number.
    pub line: usize,
    /// Width in characters (Unicode scalar values), not bytes.
    pub width: usize,
}

/// Every line in `text` wider than `max_width` characters, in order.
///
/// ```
/// use replace_me_core::{Finding, check};
///
/// let findings = check("short\nthis line is too long\n", 10);
/// assert_eq!(findings, [Finding { line: 2, width: 21 }]);
/// ```
pub fn check(text: &str, max_width: usize) -> Vec<Finding> {
    text.lines()
        .zip(1..)
        .filter_map(|(line_text, line)| {
            let width = line_text.chars().count();
            (width > max_width).then_some(Finding { line, width })
        })
        .collect()
}

/// Reads `path` as UTF-8 text.
///
/// # Errors
///
/// [`Error::Read`] if the file can't be read, [`Error::NotUtf8`] if its
/// contents aren't UTF-8.
pub fn read_source(path: &Path) -> Result<String, Error> {
    let bytes = fs::read(path).map_err(|source| Error::Read {
        path: path.to_owned(),
        source,
    })?;
    String::from_utf8(bytes).map_err(|source| Error::NotUtf8 {
        path: path.to_owned(),
        source,
    })
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::*;

    #[test]
    fn counts_characters_not_bytes() {
        assert_eq!(check("ééé", 2), [Finding { line: 1, width: 3 }]);
    }

    #[test]
    fn a_line_at_the_limit_passes() {
        assert_eq!(check("abc", 3), []);
    }

    proptest! {
        #[test]
        fn reports_exactly_the_lines_over_the_limit(
            lines in prop::collection::vec("[a-z]{0,40}", 0..20),
            max_width in 0_usize..40,
        ) {
            let reported: Vec<usize> = check(&lines.join("\n"), max_width).iter().map(|f| f.line).collect();
            let expected: Vec<usize> = lines
                .iter()
                .zip(1..)
                .filter(|(text, _)| text.len() > max_width)
                .map(|(_, line)| line)
                .collect();
            prop_assert_eq!(reported, expected);
        }
    }
}
