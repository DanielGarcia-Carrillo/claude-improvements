import io
import os
import sys
from pathlib import Path

import pytest

from replace_me import Finding
from replace_me._output import CheckOutcome, Exit, _write, terminal_safe


def test_control_characters_reach_the_terminal_escaped() -> None:
    assert terminal_safe("notes\x1b]52;c;aGk=\x07.txt") == r"notes\x1b]52;c;aGk=\x07.txt"


def test_ordinary_text_is_unchanged() -> None:
    assert terminal_safe("dir/é file.txt") == "dir/é file.txt"


class _ClosedPipe(io.StringIO):
    def __init__(self, fileno: int) -> None:
        super().__init__()
        self._fileno = fileno

    def write(self, _text: str) -> int:
        raise BrokenPipeError

    def fileno(self) -> int:
        return self._fileno


def test_a_reader_that_stops_early_keeps_the_result_s_exit_code(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # _write points the closed stdout's descriptor at /dev/null, so give it a
    # descriptor of its own rather than the test's real stdout.
    fd = os.open(tmp_path / "stdout", os.O_WRONLY | os.O_CREAT)
    try:
        monkeypatch.setattr(sys, "stdout", _ClosedPipe(fd))
        assert _write("result\n", Exit.FINDINGS) == Exit.FINDINGS
    finally:
        os.close(fd)


class _FullDisk(io.StringIO):
    def write(self, _text: str) -> int:
        raise OSError(28, "No space left on device")


def test_any_other_write_failure_exits_2(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "stdout", _FullDisk())
    assert _write("result\n", Exit.CLEAN) == Exit.ERROR


@pytest.mark.skipif(sys.platform == "win32", reason="Windows paths are Unicode")
def test_a_path_that_is_not_utf8_still_encodes() -> None:
    outcome = CheckOutcome(path=Path(os.fsdecode(b"bad\xff.txt")), max_width=100, findings=())
    assert outcome.to_json()["path"] == "bad�.txt"
    assert outcome.to_human() == "no lines over 100 characters\n"


def test_one_finding_reads_as_one_line() -> None:
    outcome = CheckOutcome(path=Path("a.txt"), max_width=3, findings=(Finding(line=2, width=4),))
    assert outcome.to_human() == "a.txt:2: 4 characters, limit 3\n1 line over 3 characters\n"
