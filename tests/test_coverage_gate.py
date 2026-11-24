"""Exercise the real coverage gate against disposable Git histories."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = (
    Path(__file__).resolve().parents[1]
    / "baselines/general/files/scripts/check-coverage.py"
)


class CoverageGateTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "tests@example.invalid")
        self.git("config", "user.name", "Tests")
        (self.root / "coverage-policy.toml").write_text(
            "[coverage]\noverall=80\nchanged=90\n"
        )
        (self.root / ".gitignore").write_text("coverage/\nreport.xml\n")
        self.source = self.root / "source.py"
        self.source.write_text("first = 1\n")

    def git(self, *args):
        return (
            subprocess.run(
                ["git", "-C", str(self.root), *args], check=True, capture_output=True
            )
            .stdout.decode()
            .strip()
        )

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "example")
        return self.git("rev-parse", "HEAD")

    def report(self, hits, filename="source.py"):
        lines = "".join(
            f'<line number="{number}" hits="{hit}"/>'
            for number, hit in enumerate(hits, 1)
        )
        (self.root / "report.xml").write_text(
            f"<coverage><sources><source>{self.root}</source></sources><packages><package><classes>"
            f'<class filename="{filename}"><lines>{lines}</lines></class>'
            "</classes></package></packages></coverage>"
        )

    def gate(self, *args, base=None, cwd=None):
        env = {
            key: value
            for key, value in os.environ.items()
            if key not in ("COVERAGE_BASE", "VERIFY_BASE", "GITHUB_STEP_SUMMARY")
        }
        if base is not None:
            env["COVERAGE_BASE"] = base
        return subprocess.run(
            ["uv", "run", "--script", "--locked", str(SOURCE), "report.xml", *args],
            cwd=cwd or self.root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_bootstrap_includes_untracked_lines(self):
        self.report([0])
        result = self.gate()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("0/1", result.stdout)
        self.report([1])
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_changed_line_can_fail_even_when_overall_passes(self):
        self.source.write_text("".join(f"line{n} = {n}\n" for n in range(10)))
        base = self.commit()
        self.source.write_text(
            self.source.read_text().replace("line9 = 9", "line9 = 99")
        )
        self.report([1] * 9 + [0])
        result = self.gate(base=base)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("90.00%", result.stdout)
        self.assertIn("source.py", result.stdout)

    def test_overall_can_fail_when_changed_lines_pass(self):
        self.source.write_text("one = 1\ntwo = 2\n")
        base = self.commit()
        self.source.write_text("one = 99\ntwo = 2\n")
        self.report([1, 0])
        self.assertNotEqual(self.gate(base=base).returncode, 0)

    def test_staged_and_new_files_are_checked(self):
        base = self.commit()
        self.source.write_text("one = 1\ntwo = 2\n")
        self.git("add", "source.py")
        self.report([1, 0])
        (self.root / "coverage-policy.toml").write_text(
            "[coverage]\noverall=0\nchanged=90\n"
        )
        self.assertNotEqual(self.gate(base=base).returncode, 0)
        self.git("reset", "--hard", base)
        self.source = self.root / "new.py"
        self.source.write_text("one = 1\n")
        self.report([0], "new.py")
        (self.root / "coverage-policy.toml").write_text(
            "[coverage]\noverall=0\nchanged=90\n"
        )
        self.assertNotEqual(self.gate(base=base).returncode, 0)

    def test_uses_merge_base_for_diverged_target(self):
        self.commit()
        self.git("checkout", "-qb", "feature")
        self.source.write_text("first = 99\n")
        self.commit()
        self.git("checkout", "main")
        (self.root / "target-only.py").write_text("other = 1\n")
        target = self.commit()
        self.git("checkout", "feature")
        self.report([1])
        result = self.gate(base=target)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_invalid_base_and_missing_or_empty_reports_fail(self):
        self.commit()
        self.report([1])
        self.assertNotEqual(self.gate(base="missing-ref").returncode, 0)
        self.report([])
        self.assertNotEqual(self.gate().returncode, 0)
        (self.root / "report.xml").unlink()
        self.assertNotEqual(self.gate().returncode, 0)

    def test_missing_report_source_fails(self):
        self.report([1], "not-here.py")
        self.assertNotEqual(self.gate().returncode, 0)

    def test_untracked_unicode_path_with_spaces(self):
        self.commit()
        self.source = self.root / "new café.py"
        self.source.write_text("one = 1\n")
        self.report([1], self.source.name)
        result = self.gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.report([0], self.source.name)
        self.assertNotEqual(self.gate().returncode, 0)

    def test_project_in_subfolder_resolves_source_paths(self):
        project = self.root / "nested"
        (project / "src").mkdir(parents=True)
        (project / "src/module.py").write_text("one = 1\n")
        (project / "coverage-policy.toml").write_text(
            "[coverage]\noverall=80\nchanged=90\n"
        )
        (project / "report.xml").write_text(
            "<coverage><sources><source>src</source></sources><packages><package><classes>"
            '<class filename="module.py"><lines><line number="1" hits="1"/></lines></class>'
            "</classes></package></packages></coverage>"
        )
        result = self.gate(cwd=project)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_unrounded_overall_floor(self):
        self.commit()
        self.source.write_text("".join(f"line{n} = 1\n" for n in range(101)))
        (self.root / "coverage-policy.toml").write_text(
            "[coverage]\noverall=80\nchanged=0\n"
        )
        self.report([1] * 80 + [0] * 21)
        self.assertNotEqual(self.gate().returncode, 0)


if __name__ == "__main__":
    unittest.main()
