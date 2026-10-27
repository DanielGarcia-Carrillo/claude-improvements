"""The CLI contract: stdout, stderr and exit code for each case, snapshotted.

A changed snapshot is a contract change. `just snapshots` rewrites them in
place, so the diff is the review.
"""

import os
import subprocess
import sys
from pathlib import Path
from typing import TypedDict

import pytest
from inline_snapshot import snapshot

from replace_me import Finding, cli

HERE = Path(__file__).parent


class Run(TypedDict):
    exit: int
    stdout: str
    stderr: str


def replace_me(*args: str, env: dict[str, str] | None = None) -> Run:
    """The CLI, run from this folder so fixture paths in the output are the same everywhere."""
    environ = {key: value for key, value in os.environ.items() if key != "LOG_LEVEL"} | (env or {})
    done = subprocess.run(
        [sys.executable, "-m", "replace_me", *args],
        cwd=HERE,
        env=environ,
        capture_output=True,
        text=True,
        check=False,
    )
    return {"exit": done.returncode, "stdout": done.stdout, "stderr": done.stderr}


def test_clean_file_exits_0() -> None:
    assert replace_me("check", "fixtures/narrow.txt", "--max-width", "20") == snapshot(
        {"exit": 0, "stdout": "no lines over 20 characters\n", "stderr": ""}
    )


def test_findings_exit_1() -> None:
    assert replace_me("check", "fixtures/wide.txt", "--max-width", "20") == snapshot(
        {
            "exit": 1,
            "stdout": """\
fixtures/wide.txt:2: 31 characters, limit 20
fixtures/wide.txt:4: 38 characters, limit 20
2 lines over 20 characters
""",
            "stderr": "",
        }
    )


def test_findings_as_json() -> None:
    assert replace_me("check", "fixtures/wide.txt", "--max-width", "20", "--json") == snapshot(
        {
            "exit": 1,
            "stdout": """\
{
  "ok": true,
  "data": {
    "command": "check",
    "path": "fixtures/wide.txt",
    "max_width": 20,
    "findings": [
      {
        "line": 2,
        "width": 31
      },
      {
        "line": 4,
        "width": 38
      }
    ]
  }
}
""",
            "stderr": "",
        }
    )


def test_missing_file_exits_2_with_a_hint() -> None:
    assert replace_me("check", "fixtures/missing.txt") == snapshot(
        {
            "exit": 2,
            "stdout": "",
            "stderr": """\
error: cannot read fixtures/missing.txt
  caused by: No such file or directory
  hint: check the path; a relative path is resolved from the current directory
""",
        }
    )


def test_missing_file_as_json() -> None:
    assert replace_me("check", "fixtures/missing.txt", "--json") == snapshot(
        {
            "exit": 2,
            "stdout": """\
{
  "ok": false,
  "error": {
    "code": "input.unreadable",
    "message": "cannot read fixtures/missing.txt",
    "hint": "check the path; a relative path is resolved from the current directory",
    "causes": [
      "No such file or directory"
    ]
  }
}
""",
            "stderr": "",
        }
    )


def test_invalid_value_as_json() -> None:
    assert replace_me("check", "fixtures/narrow.txt", "--max-width", "nope", "--json") == snapshot(
        {
            "exit": 2,
            "stdout": """\
{
  "ok": false,
  "error": {
    "code": "usage.invalid",
    "message": "argument --max-width: 'nope' is not a whole number",
    "hint": "usage: replace-me check [-h] [--max-width MAX_WIDTH] path\\nrun with --help to see the arguments",
    "causes": []
  }
}
""",
            "stderr": "",
        }
    )


def test_unknown_option_as_json() -> None:
    assert replace_me("check", "fixtures/narrow.txt", "--max-widht", "20", "--json") == snapshot(
        {
            "exit": 2,
            "stdout": """\
{
  "ok": false,
  "error": {
    "code": "usage.invalid",
    "message": "unrecognized arguments: --max-widht 20",
    "hint": "usage: replace-me [-h] [--version] [--json] {check} ...\\nrun with --help to see the arguments",
    "causes": []
  }
}
""",
            "stderr": "",
        }
    )


def test_missing_argument_as_json() -> None:
    assert replace_me("check", "--json") == snapshot(
        {
            "exit": 2,
            "stdout": """\
{
  "ok": false,
  "error": {
    "code": "usage.invalid",
    "message": "the following arguments are required: path",
    "hint": "usage: replace-me check [-h] [--max-width MAX_WIDTH] path\\nrun with --help to see the arguments",
    "causes": []
  }
}
""",
            "stderr": "",
        }
    )


def test_json_before_the_subcommand_counts_too() -> None:
    assert replace_me("--json", "check", "fixtures/narrow.txt")["stdout"].startswith(
        '{\n  "ok": true'
    )


def test_json_after_the_terminator_is_a_file_name() -> None:
    assert replace_me("check", "--", "--json")["stderr"] == snapshot("""\
error: cannot read --json
  caused by: No such file or directory
  hint: check the path; a relative path is resolved from the current directory
""")


@pytest.mark.skipif(
    sys.platform == "win32", reason="Windows refuses control characters in file names"
)
def test_a_file_name_reaches_the_logs_escaped(tmp_path: Path) -> None:
    # Not snapshotted: the temporary path differs between machines.
    path = tmp_path / "red\x1b[31m.txt"
    path.write_text("short\n")
    result = replace_me("check", str(path), env={"LOG_LEVEL": "debug"})
    assert r"red\x1b[31m.txt" in result["stderr"]
    assert "\x1b" not in result["stderr"]


def test_an_unexpected_exception_exits_70_with_its_traceback(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(_text: str, _max_width: int) -> list[Finding]:
        msg = "a bug"
        raise RuntimeError(msg)

    monkeypatch.setattr(cli, "check", broken)
    assert cli.main(["check", str(HERE / "fixtures/narrow.txt")]) == 70
    assert "RuntimeError: a bug" in caplog.text
