"""The CLI contract, and the only module that prints.

- **stdout** carries the result: text, or with `--json` exactly one JSON
  document, `{"ok": true, "data": ...}` or `{"ok": false, "error": ...}`, even
  when the arguments don't parse. `--help` and `--version` print text.
- **stderr** carries logs, and errors in text mode.
- **Exit codes**: 0 clean, 1 findings reported, 2 usage or input error. An
  unexpected exception logs its traceback and exits 70; it is a bug.
- **Error codes** (`error.code`) come from `replace_me.Error.code`, plus
  `usage.invalid` for arguments that don't parse, and never change meaning.
- **Human output escapes control characters** in anything that came from
  input, such as a file name, so it can't drive the terminal. JSON escapes
  them itself.
- **Paths that aren't valid UTF-8** appear with U+FFFD in place of the bad
  bytes, in both formats, so `--json` always prints its document.
"""

import json
import os
import sys
import unicodedata
from dataclasses import dataclass
from enum import Enum, IntEnum
from pathlib import Path

from replace_me import Error, Finding
from replace_me._paths import lossy

USAGE_INVALID = "usage.invalid"
"""`error.code` for arguments that don't parse. Core errors bring their own
codes; this one belongs to the CLI."""


class Format(Enum):
    """What the caller asked to read."""

    HUMAN = "human"
    JSON = "json"


class Exit(IntEnum):
    """The process's exit status."""

    CLEAN = 0
    FINDINGS = 1
    ERROR = 2
    BUG = 70
    """sysexits.h's EX_SOFTWARE. Python's own 1 for an uncaught exception
    would read as findings."""


class UsageError(Exception):
    """Arguments that don't parse, raised instead of argparse's print-and-exit."""

    def __init__(self, message: str, *, prog: str, usage: str) -> None:
        """Records argparse's message and the usage of the parser that failed."""
        super().__init__(message)
        self.message = message
        self.prog = prog
        self.usage = usage


@dataclass(frozen=True, slots=True)
class CheckOutcome:
    """What `check` found."""

    path: Path
    max_width: int
    findings: tuple[Finding, ...]

    @property
    def exit(self) -> Exit:
        """Findings exit 1, so a script can branch without parsing stdout."""
        return Exit.FINDINGS if self.findings else Exit.CLEAN

    def to_json(self) -> dict[str, object]:
        """The `data` member of the JSON document."""
        return {
            "command": "check",
            "path": lossy(self.path),
            "max_width": self.max_width,
            "findings": [{"line": f.line, "width": f.width} for f in self.findings],
        }

    def to_human(self) -> str:
        """The text output, one line per finding and a summary."""
        path = terminal_safe(lossy(self.path))
        lines = [
            f"{path}:{f.line}: {f.width} characters, limit {self.max_width}" for f in self.findings
        ]
        match len(self.findings):
            case 0:
                lines.append(f"no lines over {self.max_width} characters")
            case 1:
                lines.append(f"1 line over {self.max_width} characters")
            case n:
                lines.append(f"{n} lines over {self.max_width} characters")
        return "\n".join(lines) + "\n"


# A new subcommand adds its outcome class here.
type Outcome = CheckOutcome


def emit(output: Format, outcome: Outcome) -> int:
    """Prints the result in the requested format and returns the exit code."""
    if output is Format.JSON:
        return _write(_json({"ok": True, "data": outcome.to_json()}), outcome.exit)
    return _write(outcome.to_human(), outcome.exit)


def emit_error(output: Format, error: Error) -> int:
    """Reports an error the caller can fix and returns exit code 2."""
    if output is Format.JSON:
        body = {
            "code": error.code,
            "message": str(error),
            "hint": error.hint,
            "causes": causes(error),
        }
        return _write(_json({"ok": False, "error": body}), Exit.ERROR)
    report = [f"error: {terminal_safe(str(error))}"]
    report += [f"  caused by: {terminal_safe(cause)}" for cause in causes(error)]
    report.append(f"  hint: {error.hint}")
    print("\n".join(report), file=sys.stderr)
    return Exit.ERROR


def emit_usage_error(output: Format, error: UsageError) -> int:
    """Reports arguments that don't parse, as argparse would, or as a document with `--json`."""
    if output is Format.JSON:
        body = {
            "code": USAGE_INVALID,
            "message": error.message,
            "hint": f"{error.usage.strip()}\nrun with --help to see the arguments",
            "causes": [],
        }
        return _write(_json({"ok": False, "error": body}), Exit.ERROR)
    print(f"{error.usage.rstrip()}\n{error.prog}: error: {error.message}", file=sys.stderr)
    return Exit.ERROR


def causes(error: BaseException) -> list[str]:
    """The error's `__cause__` chain, outermost first, without the error itself."""
    found: list[str] = []
    cause = error.__cause__
    while cause is not None:
        # An OSError's str() repeats the file name the message already gives.
        found.append(
            cause.strerror if isinstance(cause, OSError) and cause.strerror else str(cause)
        )
        cause = cause.__cause__
    return found


def terminal_safe(text: str) -> str:
    r"""`text` with control characters escaped (ESC becomes `\x1b`).

    A crafted file name can then neither move the cursor, recolor the terminal
    nor write to the clipboard of whoever reads the output.
    """
    return "".join(
        char.encode("unicode_escape").decode("ascii")
        if unicodedata.category(char) == "Cc"
        else char
        for char in text
    )


def _json(document: dict[str, object]) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def _write(text: str, exit_code: Exit) -> int:
    """Writes the result and returns `exit_code` once it is out.

    A reader that stops early (`| head`) closes the pipe, which isn't an
    error: exit quietly with the result's code. Any other write failure exits
    2, since the caller has no result.
    """
    try:
        sys.stdout.write(text)
        sys.stdout.flush()
    except BrokenPipeError:
        # Python flushes stdout again on exit, which would raise again and
        # print a traceback; point it at /dev/null first.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return exit_code
    except OSError as error:
        print(f"error: could not write the result: {error}", file=sys.stderr)
        return Exit.ERROR
    return exit_code
