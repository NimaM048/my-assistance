//! Small, privacy-safe events consumed by the Hub's local inbox.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

static EVENT_ID: AtomicU64 = AtomicU64::new(1);

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Publish only the event category and safe display fields. Prompt text and
/// command/file contents stay in the island and never enter the notification log.
pub fn publish_hook_event(app: &AppHandle, payload: &Value) {
    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let source = payload
        .get("agent_source")
        .and_then(Value::as_str)
        .unwrap_or("claudeCode");
    let agent = if source == "codex" { "Codex" } else { "Claude Code" };
    let cwd = payload.get("cwd").and_then(Value::as_str).unwrap_or_default();
    let project = Path::new(cwd)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Your workspace".into());

    let (kind, title, detail, request_id) = match event {
        "PermissionRequest" => {
            let request_id = payload
                .get("request_id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let tool = payload
                .get("tool_name")
                .and_then(Value::as_str)
                .unwrap_or("a tool");
            ("approval", "Approval needed", format!("{agent} is waiting to use {tool}. Review the request in Coucou."), Some(request_id))
        }
        "Stop" | "CodexTurnComplete" => (
            "complete",
            "Prompt finished",
            format!("{agent} finished a prompt in {project}."),
            None,
        ),
        "StopFailure" => (
            "error",
            "Prompt stopped with an error",
            format!("{agent} stopped in {project}. Check the session for details."),
            None,
        ),
        _ => return,
    };

    let id = request_id
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("agent-{}-{}", now_ms(), EVENT_ID.fetch_add(1, Ordering::Relaxed)));
    let _ = app.emit(
        "hub-agent-notification",
        json!({
            "id": id,
            "kind": kind,
            "title": title,
            "detail": detail,
            "project": project,
            "at": now_ms(),
            "requestId": request_id,
        }),
    );
}

pub fn resolve_approval(app: &AppHandle, request_id: &str, status: &str) {
    let _ = app.emit(
        "hub-approval-resolved",
        json!({ "id": request_id, "status": status, "at": now_ms() }),
    );
}
