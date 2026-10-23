//! The CLI contract: stdout, stderr and exit code for each case, snapshotted.
//! A changed snapshot is a contract change; review it with `just snapshots`.

use std::process::Command;

use insta_cmd::{assert_cmd_snapshot, get_cargo_bin};

/// The binary, run from this crate's directory so fixture paths in the output
/// are the same on every machine.
fn replace_me() -> Command {
    let mut command = Command::new(get_cargo_bin("replace-me"));
    command
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env_remove("RUST_LOG");
    command
}

#[test]
fn clean_file_exits_0() {
    assert_cmd_snapshot!(replace_me().args([
        "check",
        "tests/fixtures/narrow.txt",
        "--max-width",
        "20"
    ]));
}

#[test]
fn findings_exit_1() {
    assert_cmd_snapshot!(replace_me().args([
        "check",
        "tests/fixtures/wide.txt",
        "--max-width",
        "20"
    ]));
}

#[test]
fn findings_as_json() {
    assert_cmd_snapshot!(replace_me().args([
        "check",
        "tests/fixtures/wide.txt",
        "--max-width",
        "20",
        "--json"
    ]));
}

#[test]
fn missing_file_exits_2_with_a_hint() {
    assert_cmd_snapshot!(replace_me().args(["check", "tests/fixtures/missing.txt"]));
}

#[test]
fn missing_file_as_json() {
    assert_cmd_snapshot!(replace_me().args(["check", "tests/fixtures/missing.txt", "--json"]));
}

#[test]
fn invalid_value_as_json() {
    assert_cmd_snapshot!(replace_me().args([
        "check",
        "tests/fixtures/narrow.txt",
        "--max-width",
        "nope",
        "--json"
    ]));
}

#[test]
fn unknown_option_as_json() {
    assert_cmd_snapshot!(replace_me().args([
        "check",
        "tests/fixtures/narrow.txt",
        "--max-widht",
        "20",
        "--json"
    ]));
}

#[test]
fn missing_argument_as_json() {
    assert_cmd_snapshot!(replace_me().args(["check", "--json"]));
}

/// A file name can't drive the terminal through the logs either. Not
/// snapshotted: the temp path differs between machines.
#[cfg(unix)] // Windows refuses control characters in file names.
#[test]
fn a_file_name_reaches_the_logs_escaped() {
    use std::fs;
    use std::path::Path;

    let path = Path::new(env!("CARGO_TARGET_TMPDIR")).join("red\u{1b}[31m.txt");
    fs::write(&path, "short\n").expect("the test's temp dir is writable");
    let output = replace_me()
        .arg("check")
        .arg(&path)
        .env("RUST_LOG", "debug")
        // The formatter colours its own output even into a pipe. Without
        // colour, any ESC on stderr came from the file name.
        .env("NO_COLOR", "1")
        .output()
        .expect("the binary runs");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains(r"red\u{1b}[31m.txt"), "{stderr}");
    assert!(!output.stderr.contains(&0x1b), "{stderr:?}");
}
