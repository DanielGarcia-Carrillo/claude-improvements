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
