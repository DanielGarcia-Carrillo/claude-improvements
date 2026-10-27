import os
from pathlib import Path


def lossy(path: Path) -> str:
    """`path` as text, with U+FFFD for bytes that aren't UTF-8.

    Python keeps such bytes as lone surrogates, which no UTF-8 stream can
    write, so printing the path as is would fail the whole output.
    """
    return os.fsencode(path).decode("utf-8", errors="replace")
