# /// script
# requires-python = ">=3.15"
# dependencies = ["diff-cover==11.0.0"]
# ///
"""Check a Cobertura report locally or in CI, without a hosted service.

Run with `uv run --script --locked scripts/check-coverage.py REPORT`.
The script lock pins diff-cover and its dependencies independently of the
application's dependencies. The report must describe the current checkout.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib
import xml.etree.ElementTree as ET
from pathlib import Path


def git(root: Path, *args: str, required: bool = True) -> bytes:
    """Run Git without a shell; a failed required inspection fails the gate."""
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=False)
    if required and result.returncode:
        msg = result.stderr.decode(errors="replace").strip()
        raise ValueError(msg)
    return result.stdout if result.returncode == 0 else b""


def comparison_base(root: Path, explicit: str | None) -> str | None:
    """Resolve a merge base, or compare all files for a new repository."""
    if explicit and set(explicit) == {"0"}:
        # GitHub's `before` value on a branch's first push.
        return None
    if explicit:
        # An invalid explicit base must never become a successful empty diff.
        commit = git(root, "rev-parse", "--verify", f"{explicit}^{{commit}}").strip()
        return git(root, "merge-base", "HEAD", commit.decode()).decode().strip()
    if not git(root, "rev-parse", "--verify", "HEAD", required=False):
        return None
    parent = (
        subprocess.run(["gt", "parent"], cwd=root, capture_output=True, check=False)
        if shutil.which("gt")
        else None
    )
    candidates = [
        parent.stdout.decode().strip().splitlines()[-1]
        if parent and parent.returncode == 0 and parent.stdout.strip()
        else "",
        "origin/main",
        "main",
    ]
    for candidate in candidates:
        if candidate and git(
            root, "rev-parse", "--verify", f"{candidate}^{{commit}}", required=False
        ):
            return git(root, "merge-base", "HEAD", candidate).decode().strip()
    # A just-created project or a checkout without its main ref: count all
    # source as new, rather than silently skipping the changed-line rule.
    return None


def normalize_report(
    report: Path, project: Path, root: Path
) -> tuple[ET.ElementTree[ET.Element[str]], int, int]:
    """Normalize source paths and count executable lines, merging duplicates."""
    tree = ET.parse(report)
    if tree.getroot().tag != "coverage":
        msg = "Expected a Cobertura XML coverage report."
        raise ValueError(msg)
    sources = [Path(node.text) for node in tree.findall("./sources/source") if node.text]
    files: dict[str, dict[int, bool]] = {}
    for item in tree.findall(".//class"):
        filename = item.get("filename")
        if not filename:
            msg = "Coverage report contains a class without a filename."
            raise ValueError(msg)
        candidates = [
            project / filename,
            *(project / source / filename for source in sources),
        ]
        source_file = next((path.resolve() for path in candidates if path.is_file()), None)
        if source_file is None or not source_file.is_relative_to(root):
            msg = f"Coverage source is missing or outside the checkout: {filename}"
            raise ValueError(msg)
        name = source_file.relative_to(root).as_posix()
        item.set("filename", name)
        lines = files.setdefault(name, {})
        for line in item.findall("./lines/line"):
            number, hits = int(line.attrib["number"]), int(line.attrib["hits"])
            if number < 1 or hits < 0:
                msg = f"Invalid coverage counts for {name}."
                raise ValueError(msg)
            lines[number] = lines.get(number, False) or hits > 0
    total = sum(len(lines) for lines in files.values())
    if total == 0:
        msg = "Coverage report contains no executable lines."
        raise ValueError(msg)
    covered = sum(sum(lines.values()) for lines in files.values())
    sources_node = tree.find("sources")
    if sources_node is not None:
        tree.getroot().remove(sources_node)
    ET.SubElement(ET.SubElement(tree.getroot(), "sources"), "source").text = str(root)
    return tree, covered, total


def checkout_diff(root: Path, base: str | None) -> bytes:
    """Include committed, staged, unstaged and untracked changes in the diff."""
    diff = (
        git(
            root,
            "-c",
            "core.quotePath=false",
            "diff",
            "--no-color",
            "--no-textconv",
            "--no-ext-diff",
            "--no-renames",
            base,
            "--",
        )
        if base
        else b""
    )
    args = ["ls-files", "-z", "--others", "--exclude-standard"]
    if base is None:
        args.append("--cached")
    paths = set(git(root, *args).split(b"\0")) - {b""}
    for raw in sorted(paths):
        name = os.fsdecode(raw)
        path = root / name
        if path.is_symlink() or not path.is_file():
            continue
        # Git emits quoted paths for non-ASCII names. Let it own the diff
        # format rather than constructing headers or parsing source ourselves.
        result = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "-c",
                "core.quotePath=false",
                "diff",
                "--no-color",
                "--no-textconv",
                "--no-ext-diff",
                "--no-index",
                "--",
                "/dev/null",
                name,
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode not in (0, 1):
            msg = f"Could not diff untracked file {name}."
            raise ValueError(msg)
        diff += result.stdout
    return diff


def coverage_policy(project: Path) -> tuple[float, float]:
    """Read the project's reviewed floors and reject invalid values."""
    with (project / "coverage-policy.toml").open("rb") as file:
        policy = tomllib.load(file)["coverage"]
    overall, changed = float(policy["overall"]), float(policy["changed"])
    if not (0 <= overall <= 100 and 0 <= changed <= 100):
        msg = "Coverage floors must be between 0 and 100."
        raise ValueError(msg)
    return overall, changed


def main() -> int:
    """Apply overall and changed-line floors, retaining reviewable reports."""
    parser = argparse.ArgumentParser(description=__doc__, color=False)
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "--base",
        default=os.environ.get("COVERAGE_BASE") or os.environ.get("VERIFY_BASE"),
    )
    args = parser.parse_args()
    project = Path.cwd().resolve()
    try:
        root = Path(git(project, "rev-parse", "--show-toplevel").decode().strip()).resolve()
        overall, changed = coverage_policy(project)
        tree, covered, total = normalize_report(args.report, project, root)
        base = comparison_base(root, args.base)
        diff = checkout_diff(root, base)
        output = project / "coverage" / "checks" / f"{args.report.parent.name}-{args.report.stem}"
        output.mkdir(parents=True, exist_ok=True)
        normalized = output / "normalized.xml"
        tree.write(normalized, encoding="utf-8", xml_declaration=True)
        percent = 100 * covered / total
        print(
            f"Line coverage: {covered}/{total} = {percent:.2f}% (minimum {overall:g}%).",
            flush=True,
        )
        print(
            f"Changed lines: merge base {base or 'new repository (all files)'}, minimum {changed:g}%.",
            flush=True,
        )
        with tempfile.NamedTemporaryFile(suffix=".diff") as patch:
            patch.write(diff)
            patch.flush()
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "diff_cover.diff_cover_tool",
                    str(normalized),
                    "--diff-file",
                    patch.name,
                    "--fail-under",
                    str(changed),
                    "--format",
                    f"markdown:{output / 'changed.md'},html:{output / 'changed.html'}",
                ],
                cwd=root,
                check=False,
            )
        # Preserve the unrounded comparison; 79.999% must not pass an 80% floor.
        if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
            with Path(summary).open("a") as file:
                file.write(
                    f"\n### Coverage: {args.report}\n\nOverall: **{percent:.2f}%**, minimum {overall:g}%.\n\n"
                )
                file.write((output / "changed.md").read_text())
        if covered * 100 < overall * total:
            print(
                f"Coverage failed: overall line coverage is below {overall:g}%.",
                file=sys.stderr,
            )
        return 1 if covered * 100 < overall * total else result.returncode
    except (OSError, ValueError, KeyError, ET.ParseError) as error:
        print(f"Coverage check failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
