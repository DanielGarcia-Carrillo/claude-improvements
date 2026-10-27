from pathlib import Path
from typing import ClassVar

from replace_me._paths import lossy


class Error(Exception):
    """Everything that can go wrong reading input.

    Each subclass has a stable `code` that scripts and agents can match on, and
    a `hint` that says what to do about it. The underlying exception is kept as
    `__cause__` (`raise ... from error`), never folded into the message, so a
    report prints each cause exactly once.
    """

    code: ClassVar[str]
    """A stable identifier, part of the CLI's JSON contract. Never change or
    reuse one; add a new code instead."""

    @property
    def hint(self) -> str:
        """What the caller can do to fix it."""
        raise NotImplementedError


class UnreadableInputError(Error):
    """The input file could not be read."""

    code = "input.unreadable"

    def __init__(self, path: Path) -> None:
        """Records the file that could not be read."""
        super().__init__(f"cannot read {lossy(path)}")
        self.path = path

    @property
    def hint(self) -> str:
        """What the caller can do to fix it."""
        if isinstance(self.__cause__, FileNotFoundError):
            return "check the path; a relative path is resolved from the current directory"
        return "check that the file exists and is readable by this user"


class NotUtf8Error(Error):
    """The input file is not UTF-8 text."""

    code = "input.not_utf8"

    def __init__(self, path: Path) -> None:
        """Records the file that is not UTF-8."""
        super().__init__(f"{lossy(path)} is not UTF-8 text")
        self.path = path

    @property
    def hint(self) -> str:
        """What the caller can do to fix it."""
        return "pass a UTF-8 text file, or convert this one first"
