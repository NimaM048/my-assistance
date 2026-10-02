//! Watch local Codex rollout files so VS Code app-server sessions can notify
//! Coucou even when Codex's CLI-only `notify` callback is not invoked.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

const POLL_EVERY: Duration = Duration::from_secs(2);
const INITIAL_TAIL_BYTES: u64 = 256 * 1024;
const MAX_ROLLOUTS: usize = 50;
const MAX_FILE_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Default)]
struct Rollout {
    offset: u64,
    pending: Vec<u8>,
    cwd: Option<String>,
    session_id: Option<String>,
    in_progress: bool,
    last_user_prompt: Option<String>,
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Some(root) = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .map(|home| home.join(".codex").join("sessions"))
        else {
            return;
        };

        let mut rollouts = HashMap::<PathBuf, Rollout>::new();
        loop {
            tokio::time::sleep(POLL_EVERY).await;
            let files = recent_rollouts(&root);
            let mut restored_active_session = false;
            let mut reported_project = false;
            for path in files {
                if !rollouts.contains_key(&path) {
                    let mut rollout = Rollout::default();
                    seed_rollout(&path, &mut rollout);
                    if !reported_project && rollout.cwd.is_some() {
                        emit_project(&app, &rollout);
                        reported_project = true;
                    }
                    if rollout.in_progress && !restored_active_session {
                        emit_started(&app, &rollout);
                        restored_active_session = true;
                    }
                    rollouts.insert(path.clone(), rollout);
                    continue;
                }
                if let Some(rollout) = rollouts.get_mut(&path) {
                    read_appended(&path, rollout, &app);
                }
            }
        }
    });
}

fn recent_rollouts(root: &Path) -> Vec<PathBuf> {
    let cutoff = SystemTime::now().checked_sub(MAX_FILE_AGE).unwrap_or(SystemTime::UNIX_EPOCH);
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut found = Vec::<(SystemTime, PathBuf)>::new();
    while let Some((directory, depth)) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = entry.metadata() else { continue };
            if metadata.is_dir() && depth < 4 {
                pending.push((path, depth + 1));
            } else if metadata.is_file()
                && path.extension().is_some_and(|extension| extension == "jsonl")
            {
                let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                if modified >= cutoff {
                    found.push((modified, path));
                }
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().take(MAX_ROLLOUTS).map(|(_, path)| path).collect()
}

fn seed_rollout(path: &Path, rollout: &mut Rollout) {
    let Ok(mut file) = File::open(path) else { return };
    let Ok(metadata) = file.metadata() else { return };
    let length = metadata.len();
    rollout.session_id = path
        .file_stem()
        .and_then(|name| name.to_str())
        .and_then(|name| name.get(name.len().saturating_sub(36)..))
        .map(str::to_string);
    let start = length.saturating_sub(INITIAL_TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return;
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return;
    }
    rollout.offset = start + bytes.len() as u64;
    if start > 0 {
        if let Some(first_line_end) = bytes.iter().position(|byte| *byte == b'\n') {
            bytes.drain(..=first_line_end);
        } else {
            return;
        }
    }
    for line in bytes.split(|byte| *byte == b'\n').filter(|line| !line.is_empty()) {
        read_record(line, rollout, None);
    }
}

fn read_appended(path: &Path, rollout: &mut Rollout, app: &AppHandle) {
    let Ok(mut file) = File::open(path) else { return };
    let Ok(metadata) = file.metadata() else { return };
    let length = metadata.len();
    if length < rollout.offset {
        *rollout = Rollout::default();
    }
    if length == rollout.offset || file.seek(SeekFrom::Start(rollout.offset)).is_err() {
        return;
    }
    let mut appended = Vec::new();
    if file.read_to_end(&mut appended).is_err() {
        return;
    }
    rollout.offset = file.stream_position().unwrap_or(length);
    rollout.pending.extend_from_slice(&appended);

    while let Some(end) = rollout.pending.iter().position(|byte| *byte == b'\n') {
        let line: Vec<u8> = rollout.pending.drain(..=end).collect();
        read_record(&line[..line.len() - 1], rollout, Some(app));
    }
}

fn read_record(line: &[u8], rollout: &mut Rollout, app: Option<&AppHandle>) {
    let Ok(record) = serde_json::from_slice::<Value>(line) else { return };
    let payload = record.get("payload").unwrap_or(&Value::Null);

    if record.get("type").and_then(Value::as_str) == Some("session_meta") {
        if let Some(id) = payload.get("id").and_then(Value::as_str) {
            rollout.session_id = Some(id.to_string());
        }
        if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
            rollout.cwd = Some(cwd.to_string());
        }
    }

    if record.get("type").and_then(Value::as_str) == Some("turn_context") {
        rollout.in_progress = true;
        if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
            rollout.cwd = Some(cwd.to_string());
        }
        if let Some(app) = app {
            let _ = app.emit_to(WINDOW_LABEL, "hook", json!({
                "hook_event_name": "CodexSessionStarted",
                "agent_source": "codex",
                "cwd": rollout.cwd.as_deref().unwrap_or_default(),
            }));
        }
    }

    if record.get("type").and_then(Value::as_str) == Some("response_item")
        && payload.get("type").and_then(Value::as_str) == Some("message")
        && payload.get("role").and_then(Value::as_str) == Some("user")
    {
        let text = payload
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n");
        if !text.trim().is_empty() {
            rollout.last_user_prompt = Some(text.chars().take(6_000).collect());
        }
    }

    let completed = record.get("type").and_then(Value::as_str) == Some("event_msg")
        && payload.get("type").and_then(Value::as_str) == Some("task_complete");
    if record.get("type").and_then(Value::as_str) == Some("event_msg")
        && payload.get("type").and_then(Value::as_str) == Some("task_started")
    {
        rollout.in_progress = true;
    }
    if !completed {
        return;
    }
    rollout.in_progress = false;
    let Some(app) = app else { return };

    let mut event = json!({
        "hook_event_name": "CodexTurnComplete",
        "agent_source": "codex",
        "cwd": rollout.cwd.as_deref().unwrap_or_default(),
        "session_id": rollout.session_id.as_deref().unwrap_or_default(),
        "turn_id": payload.get("turn_id").cloned().unwrap_or(Value::Null),
    });
    if let Some(message) = payload.get("last_agent_message").and_then(Value::as_str) {
        event["last_assistant_message"] = json!(message);
    }
    if let Some(prompt) = rollout.last_user_prompt.take() {
        event["prompt"] = json!(prompt);
    }
    let project = rollout
        .cwd
        .as_deref()
        .and_then(|cwd| Path::new(cwd).file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown project".into());
    crate::log::line(format!("Codex session completed: {project}"));
    crate::hub_events::publish_hook_event(&app, &event);
    let _ = app.emit_to(WINDOW_LABEL, "hook", event);
}

fn emit_started(app: &AppHandle, rollout: &Rollout) {
    let _ = app.emit_to(WINDOW_LABEL, "hook", json!({
        "hook_event_name": "CodexSessionStarted",
        "agent_source": "codex",
        "cwd": rollout.cwd.as_deref().unwrap_or_default(),
    }));
}

fn emit_project(app: &AppHandle, rollout: &Rollout) {
    let _ = app.emit_to(WINDOW_LABEL, "hook", json!({
        "hook_event_name": "CodexProjectDetected",
        "agent_source": "codex",
        "cwd": rollout.cwd.as_deref().unwrap_or_default(),
    }));
}
