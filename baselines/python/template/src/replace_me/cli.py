"""`replace-me`: reports lines wider than a limit.

A thin shell around the `replace_me` package: parse arguments, run the
command, hand the result to `_output`, which documents and enforces the CLI
contract and is the only module that prints.
"""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from importlib.metadata import version
from pathlib import Path
from typing import NoReturn, override

from replace_me import Error, check, read_source
from replace_me._output import (
    CheckOutcome,
    Format,
    Outcome,
    UsageError,
    emit,
    emit_bug,
    emit_error,
    emit_usage_error,
)

logger = logging.getLogger(__name__)


class _Args(argparse.Namespace):
    """The parsed arguments, typed. argparse sets each attribute its parsers define."""

    command: str
    json: bool
    path: Path
    max_width: int


class _Parser(argparse.ArgumentParser):
    """An `ArgumentParser` that raises on bad arguments instead of printing and exiting.

    `--json` can then put the error in a document. Subcommand parsers are
    created from the same class.
    """

    @override
    def error(self, message: str) -> NoReturn:
        raise UsageError(message, prog=self.prog, usage=self.format_usage())


def _width_limit(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        msg = f"{text!r} is not a whole number"
        raise argparse.ArgumentTypeError(msg) from None
    if value < 0:
        msg = f"{value} is negative"
        raise argparse.ArgumentTypeError(msg)
    return value


def _parser() -> _Parser:
    # Abbreviations off: `--max` working today would break the day another
    # option starts with it.
    parser = _Parser(
        prog="replace-me", description="Reports lines wider than a limit.", allow_abbrev=False
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {version('replace-me')}")
    parser.add_argument(
        "--json",
        action="store_true",
        help="print exactly one JSON document on stdout instead of text",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    check_command = commands.add_parser(
        "check", help="report every line wider than --max-width", allow_abbrev=False
    )
    check_command.add_argument("path", type=Path, help="the file to check")
    check_command.add_argument(
        "--max-width",
        type=_width_limit,
        default=100,
        help="the widest a line may be, in characters (default: %(default)s)",
    )
    # `--json` after the subcommand too. SUPPRESS keeps one given before it.
    check_command.add_argument(
        "--json", action="store_true", default=argparse.SUPPRESS, help=argparse.SUPPRESS
    )
    return parser


def requested_format(args: Sequence[str]) -> Format:
    """The format a command line asks for, for an error raised before parsing finishes.

    Anything after `--` is a value, so a file named `--json` doesn't count.
    """
    options = args[: args.index("--")] if "--" in args else args
    return Format.JSON if "--json" in options else Format.HUMAN


def run(args: _Args) -> Outcome:
    """Runs the parsed command.

    Adding a subcommand: a parser in `_parser`, a case here, an outcome class
    in `_output`, and a CLI test.
    """
    match args.command:
        case "check":
            path, max_width = args.path, args.max_width
            # %r escapes control characters, so a file name can't drive the
            # terminal through the logs either.
            logger.debug("checking %r with max width %d", path, max_width)
            findings = check(read_source(path), max_width)
            return CheckOutcome(path=path, max_width=max_width, findings=tuple(findings))
        case command:
            msg = f"no handler for the {command!r} command"
            raise NotImplementedError(msg)


def main(argv: Sequence[str] | None = None) -> int:
    """Runs the CLI on `argv` (default: the process's arguments) and returns its exit code."""
    args = sys.argv[1:] if argv is None else list(argv)
    output = requested_format(args)
    try:
        parsed = _parser().parse_args(args, namespace=_Args())
    except UsageError as error:
        return emit_usage_error(output, error)

    # Logs go to stderr, filtered by LOG_LEVEL, so stdout carries only the result.
    level = os.environ.get("LOG_LEVEL", "WARNING").upper()
    logging.basicConfig(
        level=logging.getLevelNamesMapping().get(level, logging.WARNING),
        format="%(levelname)s %(name)s: %(message)s",
    )
    try:
        outcome = run(parsed)
    except Error as error:
        return emit_error(output, error)
    except Exception:
        # A bug. Python's own exit status for it, 1, would read as findings.
        logger.exception("unexpected error")
        return emit_bug(output)
    return emit(output, outcome)
