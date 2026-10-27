"""Reports lines wider than a limit.

Everything here is pure or takes its input as an argument, so it is tested
without running the CLI. `replace_me.cli` owns argument parsing, and
`_output` the output and exit codes. Each public name is importable from
exactly one place, this package: the modules behind it are private.
"""

from replace_me._errors import Error, NotUtf8Error, UnreadableInputError
from replace_me._width import Finding, check, read_source

__all__ = ["Error", "Finding", "NotUtf8Error", "UnreadableInputError", "check", "read_source"]
