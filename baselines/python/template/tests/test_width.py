import string
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from replace_me import Finding, NotUtf8Error, UnreadableInputError, check, read_source


def test_counts_characters_not_bytes() -> None:
    assert check("ééé", 2) == [Finding(line=1, width=3)]


def test_a_line_at_the_limit_passes() -> None:
    assert check("abc", 3) == []


def test_a_carriage_return_before_the_newline_does_not_count() -> None:
    assert check("abc\r\nabcd\r\n", 3) == [Finding(line=2, width=4)]


@given(
    lines=st.lists(st.text(alphabet=string.ascii_lowercase, max_size=40), max_size=20),
    max_width=st.integers(min_value=0, max_value=40),
)
def test_reports_exactly_the_lines_over_the_limit(lines: list[str], max_width: int) -> None:
    reported = [finding.line for finding in check("\n".join(lines), max_width)]
    expected = [number for number, text in enumerate(lines, start=1) if len(text) > max_width]
    assert reported == expected


def test_a_missing_file_says_to_check_the_path(tmp_path: Path) -> None:
    with pytest.raises(UnreadableInputError) as raised:
        read_source(tmp_path / "missing.txt")
    assert raised.value.code == "input.unreadable"
    assert raised.value.hint.startswith("check the path")


def test_bytes_that_are_not_utf8_are_an_error(tmp_path: Path) -> None:
    path = tmp_path / "latin1.txt"
    path.write_bytes("café".encode("latin-1"))
    with pytest.raises(NotUtf8Error) as raised:
        read_source(path)
    assert raised.value.code == "input.not_utf8"
    assert isinstance(raised.value.__cause__, UnicodeDecodeError)
