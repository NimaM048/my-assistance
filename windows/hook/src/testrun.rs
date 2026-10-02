//! Spots a test run in a finished Bash/PowerShell call and keeps only its
//! verdict. The island cheers on green and faints on red, but it never needs —
//! and never receives — the output itself: `tool_response` is still dropped.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Pass,
    Fail,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Pass => "pass",
            Verdict::Fail => "fail",
        }
    }
}

/// Test summaries are printed last, so only the tail of a long log is read.
const SCAN_TAIL: usize = 32 * 1024;

/// Runners that are a test run on their own, whatever follows them.
const RUNNERS: &[&str] = &[
    "pytest", "vitest", "jest", "rspec", "phpunit", "ctest", "tox", "mocha", "nextest", "karma", "ava",
];

/// `<tool> <word>` pairs that start a test run.
const PAIRS: &[(&str, &str)] = &[
    ("npm", "test"), ("npm", "t"), ("yarn", "test"), ("pnpm", "test"), ("bun", "test"),
    ("cargo", "test"), ("go", "test"), ("dotnet", "test"), ("mvn", "test"), ("mvn", "verify"),
    ("gradle", "test"), ("gradlew", "test"), ("make", "test"), ("make", "check"), ("rake", "test"),
    ("mix", "test"), ("deno", "test"), ("swift", "test"), ("playwright", "test"), ("cypress", "run"),
    ("-m", "unittest"), ("-m", "pytest"),
];

/// Package managers whose `run test…` script is a test run.
const SCRIPT_RUNNERS: &[&str] = &["npm", "yarn", "pnpm", "bun"];

/// `C:\x\node_modules\.bin\jest.cmd` → `jest`.
fn base(token: &str) -> String {
    let token = token.trim_matches(|c| c == '"' || c == '\'');
    let name = token.rsplit(['/', '\\']).next().unwrap_or(token).to_ascii_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".ps1"] {
        if let Some(stem) = name.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    name
}

/// True when any part of a (possibly chained) shell command runs tests.
pub fn is_test_command(command: &str) -> bool {
    let lowered = command.to_ascii_lowercase();
    let segments = lowered.split(['\n', ';', '&', '|']);
    for segment in segments {
        let tokens: Vec<String> = segment.split_whitespace().map(base).collect();
        for (i, token) in tokens.iter().enumerate() {
            if RUNNERS.contains(&token.as_str()) {
                return true;
            }
            let Some(next) = tokens.get(i + 1) else { continue };
            if PAIRS.iter().any(|(a, b)| a == token && b == next) {
                return true;
            }
            if SCRIPT_RUNNERS.contains(&token.as_str())
                && next == "run"
                && tokens.get(i + 2).is_some_and(|script| script.starts_with("test"))
            {
                return true;
            }
        }
    }
    false
}

/// Pass/fail counts read off a test log, whichever runner printed it.
#[derive(Debug, Default, PartialEq, Eq)]
struct Counts {
    passed: u64,
    failed: u64,
    /// A runner said FAILED in so many words (cargo, go, unittest).
    failed_flag: bool,
}

const PASS_WORDS: &[&str] = &["passed", "passing", "pass"];
const FAIL_WORDS: &[&str] = &["failed", "failing", "failures", "failure", "errors", "error"];

fn read_counts(text: &str) -> Counts {
    let tail = if text.len() > SCAN_TAIL {
        let mut start = text.len() - SCAN_TAIL;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        &text[start..]
    } else {
        text
    };
    let lowered = tail.to_lowercase();
    let mut counts = Counts {
        failed_flag: lowered.contains("test result: failed")
            || lowered.contains("--- fail")
            || lowered.contains("\nfail\t")
            || lowered.contains("failed!")
            || lowered.contains("failed (failures="),
        ..Counts::default()
    };
    // Words, numbers, and the `:`/`=` that make "Failures: 1" a label and its
    // value — a plain comma ("2 failed, 10 passed") must not.
    let mut tokens: Vec<&str> = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in lowered.char_indices() {
        if c.is_alphanumeric() {
            start.get_or_insert(i);
            continue;
        }
        if let Some(s) = start.take() {
            tokens.push(&lowered[s..i]);
        }
        if c == ':' || c == '=' {
            tokens.push(if c == ':' { ":" } else { "=" });
        } else if !c.is_whitespace() {
            tokens.push(",");
        }
    }
    if let Some(s) = start {
        tokens.push(&lowered[s..]);
    }
    for (i, a) in tokens.iter().enumerate() {
        let b = tokens.get(i + 1).copied().unwrap_or_default();
        // "5 passed", "1 failing"
        if let Ok(n) = a.parse::<u64>() {
            if PASS_WORDS.contains(&b) {
                counts.passed = counts.passed.max(n);
            } else if FAIL_WORDS.contains(&b) {
                counts.failed = counts.failed.max(n);
            }
        }
        // "Passed: 10", "Failures: 1", "failures=2"
        if b == ":" || b == "=" {
            if let Some(Ok(n)) = tokens.get(i + 2).map(|v| v.parse::<u64>()) {
                if PASS_WORDS.contains(a) {
                    counts.passed = counts.passed.max(n);
                } else if FAIL_WORDS.contains(a) {
                    counts.failed = counts.failed.max(n);
                }
            }
        }
    }
    counts
}

fn summary(counts: &Counts) -> Option<String> {
    match (counts.passed, counts.failed) {
        (0, 0) => None,
        (p, 0) => Some(format!("{p} passed")),
        (0, f) => Some(format!("{f} failed")),
        (p, f) => Some(format!("{f} failed, {p} passed")),
    }
}

/// The verdict for a finished tool call, or None when it was not a test run
/// (or was interrupted, which says nothing about the tests).
pub fn verdict(event: &str, tool_input: Option<&Value>, response: Option<&Value>, error: Option<&str>) -> Option<(Verdict, Option<String>)> {
    let command = tool_input?.get("command")?.as_str()?;
    if !is_test_command(command) {
        return None;
    }
    match event {
        "PostToolUseFailure" => {
            let counts = read_counts(error.unwrap_or_default());
            Some((Verdict::Fail, summary(&counts)))
        }
        "PostToolUse" => {
            if response.and_then(|r| r.get("interrupted")).and_then(Value::as_bool) == Some(true) {
                return None;
            }
            let text = match response {
                Some(Value::String(s)) => s.clone(),
                Some(r) => {
                    let part = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
                    format!("{}\n{}\n{}", part("stdout"), part("stderr"), part("output"))
                }
                None => String::new(),
            };
            let counts = read_counts(&text);
            let failed = counts.failed > 0 || counts.failed_flag;
            // Claude Code reports a non-zero exit as PostToolUseFailure, so a
            // PostToolUse with no failure in the log is a green run.
            let verdict = if failed { Verdict::Fail } else { Verdict::Pass };
            Some((verdict, summary(&counts)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn recognises_common_test_commands() {
        for cmd in [
            "npm test", "npm run test:unit", "pnpm test -- --watch=false", "yarn test", "bun test",
            "npx vitest run", "npx jest src", "cargo test -p coucou-hook", "go test ./...", "pytest -q",
            "python -m pytest tests", "python -m unittest discover", "dotnet test", "mvn test",
            "./gradlew test", "cd app && npm test", "C:\\proj\\node_modules\\.bin\\jest.cmd --ci",
            "make test", "deno test -A", "npx playwright test",
        ] {
            assert!(is_test_command(cmd), "{cmd}");
        }
    }

    #[test]
    fn leaves_ordinary_commands_alone() {
        for cmd in [
            "npm install", "npm run build", "cargo build", "git status", "ls tests", "cat jest.config.js",
            "echo testing", "go build ./...", "npm run lint",
        ] {
            assert!(!is_test_command(cmd), "{cmd}");
        }
    }

    #[test]
    fn green_runs_pass_with_a_summary() {
        let input = json!({ "command": "npx vitest run" });
        let out = json!({ "stdout": " Test Files  3 passed (3)\n      Tests  12 passed (12)\n", "stderr": "" });
        assert_eq!(verdict("PostToolUse", Some(&input), Some(&out), None), Some((Verdict::Pass, Some("12 passed".into()))));
        let cargo = json!({ "stdout": "test result: ok. 5 passed; 0 failed; 0 ignored" });
        let input = json!({ "command": "cargo test" });
        assert_eq!(verdict("PostToolUse", Some(&input), Some(&cargo), None), Some((Verdict::Pass, Some("5 passed".into()))));
    }

    #[test]
    fn red_runs_fail() {
        let input = json!({ "command": "npm test" });
        let jest = json!({ "stdout": "Tests:       2 failed, 10 passed, 12 total" });
        assert_eq!(verdict("PostToolUse", Some(&input), Some(&jest), None), Some((Verdict::Fail, Some("2 failed, 10 passed".into()))));
        let failure = verdict("PostToolUseFailure", Some(&input), None, Some("Exit code 1\n  3 failing\n  9 passing"));
        assert_eq!(failure, Some((Verdict::Fail, Some("3 failed, 9 passed".into()))));
        let unittest = json!({ "stderr": "Ran 4 tests in 0.01s\n\nFAILED (failures=1)" });
        let input = json!({ "command": "python -m unittest" });
        assert_eq!(verdict("PostToolUse", Some(&input), Some(&unittest), None).map(|v| v.0), Some(Verdict::Fail));
    }

    #[test]
    fn labelled_counts_are_read_too() {
        let input = json!({ "command": "dotnet test" });
        let out = json!({ "stdout": "Failed!  - Failed:     1, Passed:    10, Skipped: 0, Total: 11" });
        assert_eq!(verdict("PostToolUse", Some(&input), Some(&out), None), Some((Verdict::Fail, Some("1 failed, 10 passed".into()))));
    }

    #[test]
    fn interrupted_or_unrelated_says_nothing() {
        let input = json!({ "command": "npm test" });
        assert_eq!(verdict("PostToolUse", Some(&input), Some(&json!({ "interrupted": true })), None), None);
        let build = json!({ "command": "npm run build" });
        assert_eq!(verdict("PostToolUse", Some(&build), Some(&json!({ "stdout": "1 error" })), None), None);
        assert_eq!(verdict("PreToolUse", Some(&input), None, None), None);
    }

    #[test]
    fn long_logs_are_cut_on_a_char_boundary() {
        let text = format!("{}\n4 passed", "é".repeat(40_000));
        assert_eq!(read_counts(&text).passed, 4);
    }
}
