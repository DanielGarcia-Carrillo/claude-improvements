from dataclasses import dataclass
from pathlib import Path

from replace_me._errors import NotUtf8Error, UnreadableInputError


@dataclass(frozen=True, slots=True)
class Finding:
    """A line wider than the limit."""

    line: int
    """One-based line number."""
    width: int
    """Width in characters (code points), not bytes."""


def check(text: str, max_width: int) -> list[Finding]:
    r"""Every line in `text` wider than `max_width` characters, in order.

    Lines end at `\n`, and a `\r` before it doesn't count, as in Rust's
    `str::lines`. `str.splitlines` would also split at form feeds and Unicode
    line separators, which editors show within a line.

    >>> check("short\nthis line is too long\n", 10)
    [Finding(line=2, width=21)]
    """
    lines = text.split("\n")
    # A final newline ends the last line rather than starting an empty one.
    if lines[-1] == "":
        lines.pop()
    return [
        Finding(line=number, width=width)
        for number, line in enumerate(lines, start=1)
        if (width := len(line.removesuffix("\r"))) > max_width
    ]


def read_source(path: Path) -> str:
    """Reads `path` as UTF-8 text.

    Raises:
        UnreadableInputError: The file can't be read.
        NotUtf8Error: Its contents aren't UTF-8.
    """
    try:
        data = path.read_bytes()
    except OSError as error:
        raise UnreadableInputError(path) from error
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise NotUtf8Error(path) from error
