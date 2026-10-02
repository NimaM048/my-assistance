//! How much of their usage limits Claude Code and Codex have used — read from
//! their own local logs, never from the network.
//!
//! * Claude Code writes every reply, with its token counts, to
//!   `~/.claude/projects/<project>/<session>.jsonl`. Claude's limits run in
//!   5-hour windows, so replies are grouped into 5-hour blocks the way the
//!   community tools (ccusage) do; the limit itself is unknown, so the busiest
//!   block of the last week stands in for it — an estimate, and labelled one.
//! * Codex writes `token_count` events to `~/.codex/sessions/**.jsonl`, and those
//!   carry the real numbers: the percentage used of each window and when it resets.
//!
//! Files are read incrementally — only what was appended since the last look —
//! and only when the island asks, so a hidden island costs nothing here.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

/// How far back to look: a week of blocks is enough to guess the limit.
const HISTORY: Duration = Duration::from_secs(8 * 24 * 60 * 60);
/// Claude's usage windows are five hours long.
const BLOCK_MS: i64 = 5 * 60 * 60 * 1000;
/// A first look at a huge file starts this far from its end.
const MAX_FIRST_READ: u64 = 24 * 1024 * 1024;

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub claude: Option<ClaudeUsage>,
    pub codex: Option<CodexUsage>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsage {
    /// Tokens since local midnight (input + output + cache writes).
    pub today_tokens: u64,
    pub today_replies: u64,
    /// The current 5-hour block, if one is running.
    pub block_start: Option<i64>,
    pub block_resets_at: Option<i64>,
    pub block_tokens: u64,
    /// The busiest finished block of the last week — the best guess at the limit.
    pub block_peak: u64,
    /// A "usage limit reached" message in the current block, and its reset hint
    /// as Claude Code wrote it ("3pm", "3:30pm (Europe/Paris)" or a unix time).
    pub limit_hit_at: Option<i64>,
    pub limit_reset_hint: Option<String>,
    pub last_activity: Option<i64>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsage {
    pub today_tokens: u64,
    pub primary: Option<CodexWindow>,
    pub secondary: Option<CodexWindow>,
    pub updated_at: Option<i64>,
}

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexWindow {
    pub used_percent: f64,
    pub window_minutes: u64,
    pub resets_at: Option<i64>,
}

/// One Claude reply.
#[derive(Clone)]
struct Reply {
    at: i64,
    tokens: u64,
}

/// One Codex `token_count` event.
#[derive(Clone)]
struct CodexTick {
    at: i64,
    tokens: u64,
    primary: Option<CodexWindow>,
    secondary: Option<CodexWindow>,
}

#[derive(Default)]
struct FileCursor {
    offset: u64,
    pending: Vec<u8>,
}

#[derive(Default)]
struct Cache {
    cursors: HashMap<PathBuf, FileCursor>,
    replies: Vec<Reply>,
    seen: HashSet<String>,
    limit: Option<(i64, String)>,
    codex: Vec<CodexTick>,
}

static CACHE: std::sync::LazyLock<Mutex<Cache>> = std::sync::LazyLock::new(|| Mutex::new(Cache::default()));

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Claude Code honours CLAUDE_CONFIG_DIR; otherwise it is ~/.claude.
fn claude_projects() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join("projects"));
    }
    home().map(|h| h.join(".claude").join("projects"))
}

fn codex_sessions() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CODEX_HOME") {
        return Some(PathBuf::from(dir).join("sessions"));
    }
    home().map(|h| h.join(".codex").join("sessions"))
}

/// Every .jsonl under `root` (to a small depth) modified within the history window.
fn recent_jsonl(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    let cutoff = SystemTime::now().checked_sub(HISTORY).unwrap_or(UNIX_EPOCH);
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if depth < max_depth {
                    stack.push((path, depth + 1));
                }
            } else if path.extension().is_some_and(|e| e == "jsonl")
                && meta.modified().map(|m| m >= cutoff).unwrap_or(false)
            {
                out.push(path);
            }
        }
    }
    out
}

/// Reads whatever was appended to `path` since last time, line by line.
fn read_new_lines(path: &Path, cursor: &mut FileCursor, mut on_line: impl FnMut(&[u8])) {
    let Ok(mut file) = File::open(path) else { return };
    let Ok(meta) = file.metadata() else { return };
    let len = meta.len();
    if len < cursor.offset {
        // Rewritten or truncated: start over.
        *cursor = FileCursor::default();
    }
    if cursor.offset == 0 && len > MAX_FIRST_READ {
        cursor.offset = len - MAX_FIRST_READ;
        cursor.pending.clear();
        // The first (partial) line is dropped below by skipping to a newline.
        if file.seek(SeekFrom::Start(cursor.offset)).is_err() {
            return;
        }
        let mut skip = [0u8; 1];
        while let Ok(1) = file.read(&mut skip) {
            cursor.offset += 1;
            if skip[0] == b'\n' {
                break;
            }
        }
    }
    if len == cursor.offset || file.seek(SeekFrom::Start(cursor.offset)).is_err() {
        return;
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return;
    }
    cursor.offset += bytes.len() as u64;
    cursor.pending.extend_from_slice(&bytes);
    while let Some(end) = cursor.pending.iter().position(|b| *b == b'\n') {
        let line: Vec<u8> = cursor.pending.drain(..=end).collect();
        on_line(&line[..line.len() - 1]);
    }
}

/// `2025-06-01T12:34:56.789Z` (or with a `+02:00` offset) → unix milliseconds.
pub fn parse_rfc3339_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, se) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let mut i = 19;
    let mut ms = 0i64;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = &s[start..i];
        let digits: String = frac.chars().chain("000".chars()).take(3).collect();
        ms = digits.parse().unwrap_or(0);
    }
    let offset_min = match b.get(i) {
        Some(b'Z') | Some(b'z') | None => 0,
        Some(sign @ (b'+' | b'-')) => {
            let oh = num(i + 1..i + 3)?;
            let om = num(i + 4..i + 6).unwrap_or(0);
            let m = oh * 60 + om;
            if *sign == b'+' { m } else { -m }
        }
        _ => return None,
    };
    // Days from civil (Howard Hinnant).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + h) * 60 + mi - offset_min) * 60_000 + se * 1000 + ms)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// "Claude AI usage limit reached|1717000000" or "…limit reached ∙ resets 3pm".
fn limit_hint(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let hit = lower.contains("usage limit") || lower.contains("limit reached") || lower.contains("hit your limit");
    if !hit {
        return None;
    }
    if let Some((_, tail)) = text.rsplit_once('|') {
        let digits: String = tail.trim().chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 9 {
            return Some(digits);
        }
    }
    if let Some(pos) = lower.find("resets") {
        let rest = text[pos + "resets".len()..].trim_start();
        let rest = rest.strip_prefix("at ").unwrap_or(rest);
        let hint: String = rest.chars().take_while(|c| *c != '\n').take(48).collect();
        return Some(hint.trim().trim_end_matches('.').to_string());
    }
    Some(String::new())
}

/// Text of a Claude message, whether `content` is a string or a list of parts.
fn message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn read_claude_line(line: &[u8], cache: &mut Cache) {
    // Cheap filter before parsing: only assistant lines carry usage.
    if !line.windows(11).any(|w| w == b"\"assistant\"") {
        return;
    }
    let Ok(v) = serde_json::from_slice::<Value>(line) else { return };
    if v.get("type").and_then(Value::as_str) != Some("assistant") {
        return;
    }
    let Some(at) = v.get("timestamp").and_then(Value::as_str).and_then(parse_rfc3339_ms) else { return };
    let Some(message) = v.get("message") else { return };

    if v.get("isApiErrorMessage").and_then(Value::as_bool) == Some(true) || message.get("model").and_then(Value::as_str) == Some("<synthetic>") {
        if let Some(hint) = limit_hint(&message_text(message)) {
            if cache.limit.as_ref().is_none_or(|(t, _)| at > *t) {
                cache.limit = Some((at, hint));
            }
        }
        return;
    }

    let Some(usage) = message.get("usage") else { return };
    // The same reply can be written more than once while it streams.
    let key = format!(
        "{}:{}",
        message.get("id").and_then(Value::as_str).unwrap_or_default(),
        v.get("requestId").and_then(Value::as_str).unwrap_or_default()
    );
    if key != ":" && !cache.seen.insert(key) {
        return;
    }
    let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
    let tokens = n("input_tokens") + n("output_tokens") + n("cache_creation_input_tokens");
    if tokens > 0 {
        cache.replies.push(Reply { at, tokens });
    }
}

fn codex_window(v: Option<&Value>, at: i64) -> Option<CodexWindow> {
    let v = v?;
    let used_percent = v.get("used_percent").and_then(Value::as_f64)?;
    let window_minutes = v.get("window_minutes").and_then(Value::as_u64).unwrap_or(0);
    let resets_at = v
        .get("resets_at")
        .and_then(Value::as_i64)
        .map(|s| if s < 100_000_000_000 { s * 1000 } else { s })
        .or_else(|| v.get("resets_in_seconds").and_then(Value::as_i64).map(|s| at + s * 1000));
    Some(CodexWindow { used_percent, window_minutes, resets_at })
}

fn read_codex_line(line: &[u8], cache: &mut Cache) {
    if !line.windows(13).any(|w| w == b"\"token_count\"") {
        return;
    }
    let Ok(v) = serde_json::from_slice::<Value>(line) else { return };
    let payload = v.get("payload").unwrap_or(&Value::Null);
    if payload.get("type").and_then(Value::as_str) != Some("token_count") {
        return;
    }
    let Some(at) = v.get("timestamp").and_then(Value::as_str).and_then(parse_rfc3339_ms) else { return };
    let tokens = payload
        .pointer("/info/last_token_usage/total_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let limits = payload.get("rate_limits");
    cache.codex.push(CodexTick {
        at,
        tokens,
        primary: codex_window(limits.and_then(|l| l.get("primary")), at),
        secondary: codex_window(limits.and_then(|l| l.get("secondary")), at),
    });
}

/// Groups replies into 5-hour blocks: a block starts at the hour of its first
/// reply and a reply after it ends (or after a 5-hour gap) starts the next.
fn blocks(replies: &[Reply]) -> Vec<(i64, u64, i64)> {
    let mut out: Vec<(i64, u64, i64)> = Vec::new(); // (start, tokens, last reply)
    for r in replies {
        match out.last_mut() {
            Some((start, tokens, last)) if r.at < *start + BLOCK_MS && r.at - *last < BLOCK_MS => {
                *tokens += r.tokens;
                *last = r.at;
            }
            _ => out.push((r.at - r.at.rem_euclid(60 * 60 * 1000), r.tokens, r.at)),
        }
    }
    out
}

fn refresh(cache: &mut Cache) {
    if let Some(root) = claude_projects() {
        for path in recent_jsonl(&root, 2) {
            let mut cursor = cache.cursors.remove(&path).unwrap_or_default();
            read_new_lines(&path, &mut cursor, |line| read_claude_line(line, cache));
            cache.cursors.insert(path, cursor);
        }
    }
    if let Some(root) = codex_sessions() {
        for path in recent_jsonl(&root, 4) {
            let mut cursor = cache.cursors.remove(&path).unwrap_or_default();
            read_new_lines(&path, &mut cursor, |line| read_codex_line(line, cache));
            cache.cursors.insert(path, cursor);
        }
    }
    let cutoff = now_ms() - HISTORY.as_millis() as i64;
    cache.replies.retain(|r| r.at >= cutoff);
    cache.replies.sort_by_key(|r| r.at);
    cache.codex.retain(|c| c.at >= cutoff);
    cache.codex.sort_by_key(|c| c.at);
    if cache.seen.len() > 200_000 {
        cache.seen.clear();
    }
}

/// `since_ms` is local midnight, worked out by the island (it knows the time zone).
pub fn snapshot(since_ms: i64) -> UsageSnapshot {
    let mut cache = CACHE.lock().unwrap();
    refresh(&mut cache);
    let now = now_ms();

    let claude = if cache.replies.is_empty() && cache.limit.is_none() {
        None
    } else {
        let today: Vec<&Reply> = cache.replies.iter().filter(|r| r.at >= since_ms).collect();
        let all = blocks(&cache.replies);
        let current = all.last().filter(|(start, _, _)| now < start + BLOCK_MS).copied();
        let finished = if current.is_some() { &all[..all.len() - 1] } else { &all[..] };
        let block_peak = finished.iter().map(|b| b.1).max().unwrap_or(0);
        let (limit_hit_at, limit_reset_hint) = match &cache.limit {
            Some((at, hint)) if now - at < BLOCK_MS => (Some(*at), Some(hint.clone())),
            _ => (None, None),
        };
        Some(ClaudeUsage {
            today_tokens: today.iter().map(|r| r.tokens).sum(),
            today_replies: today.len() as u64,
            block_start: current.map(|b| b.0),
            block_resets_at: current.map(|b| b.0 + BLOCK_MS),
            block_tokens: current.map(|b| b.1).unwrap_or(0),
            block_peak,
            limit_hit_at,
            limit_reset_hint,
            last_activity: cache.replies.last().map(|r| r.at),
        })
    };

    let codex = cache.codex.last().map(|last| CodexUsage {
        today_tokens: cache.codex.iter().filter(|c| c.at >= since_ms).map(|c| c.tokens).sum(),
        primary: last.primary.clone(),
        secondary: last.secondary.clone(),
        updated_at: Some(last.at),
    });

    UsageSnapshot { claude, codex }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_timestamps_parse_to_unix_ms() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("2024-02-29T12:00:00.5Z"), Some(1_709_208_000_500));
        assert_eq!(parse_rfc3339_ms("2024-02-29T14:00:00+02:00"), Some(1_709_208_000_000));
        assert_eq!(parse_rfc3339_ms("nope"), None);
    }

    #[test]
    fn replies_group_into_five_hour_blocks() {
        let h = 60 * 60 * 1000;
        let r = |at: i64, tokens: u64| Reply { at, tokens };
        let b = blocks(&[r(10 * h + 5, 1), r(11 * h, 2), r(14 * h + 59, 3), r(15 * h + 1, 4), r(30 * h, 5)]);
        assert_eq!(b.iter().map(|x| (x.0, x.1)).collect::<Vec<_>>(), vec![(10 * h, 6), (15 * h, 4), (30 * h, 5)]);
    }

    #[test]
    fn limit_messages_keep_their_reset_hint() {
        assert_eq!(limit_hint("Claude AI usage limit reached|1717000000").as_deref(), Some("1717000000"));
        assert_eq!(limit_hint("5-hour limit reached ∙ resets 3pm").as_deref(), Some("3pm"));
        assert_eq!(limit_hint("You've hit your limit · resets at 3:30pm (Europe/Paris)").as_deref(), Some("3:30pm (Europe/Paris)"));
        assert_eq!(limit_hint("All good"), None);
    }

    #[test]
    fn codex_windows_accept_both_reset_shapes() {
        let at = 1_000_000;
        let v = serde_json::json!({ "used_percent": 42.5, "window_minutes": 300, "resets_in_seconds": 60 });
        let w = codex_window(Some(&v), at).unwrap();
        assert_eq!((w.used_percent, w.window_minutes, w.resets_at), (42.5, 300, Some(at + 60_000)));
        let v = serde_json::json!({ "used_percent": 1.0, "window_minutes": 10080, "resets_at": 1_717_000_000 });
        assert_eq!(codex_window(Some(&v), at).unwrap().resets_at, Some(1_717_000_000_000));
    }

    #[test]
    fn replies_are_deduplicated_and_counted() {
        let mut cache = Cache::default();
        let line = br#"{"type":"assistant","timestamp":"2025-01-01T10:00:00Z","requestId":"r1","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":2,"cache_read_input_tokens":999}}}"#;
        read_claude_line(line, &mut cache);
        read_claude_line(line, &mut cache);
        assert_eq!(cache.replies.len(), 1);
        assert_eq!(cache.replies[0].tokens, 17);
    }
}
