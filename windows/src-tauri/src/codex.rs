//! Coucou's built-in chat, backed by the user's signed-in Codex CLI session.
//!
//! Each chat turn gets a short-lived app-server process and resumes the same
//! Codex thread. The app-server owns authentication and conversation history;
//! Coucou only forwards text and displays the final assistant message.

use std::io::ErrorKind;
use std::os::windows::process::CommandExt;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};

use crate::claude::{Chat, ChatContext, ChatReply};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const TURN_TIMEOUT: Duration = Duration::from_secs(300);

pub async fn send(
    chat: &Chat,
    query: String,
    context: Option<ChatContext>,
    project_cwd: Option<String>,
) -> Result<ChatReply, String> {
    let fallback_cwd = std::env::current_dir().unwrap_or_else(|_| "D:\\".into());
    let cwd = project_cwd
        .filter(|path| std::path::Path::new(path).is_dir())
        .unwrap_or_else(|| fallback_cwd.to_string_lossy().to_string());
    let (cwd, text) = prepare_input(query, context, &cwd);
    let result = tokio::time::timeout(TURN_TIMEOUT, run_turn(chat, &cwd, &text))
        .await
        .map_err(|_| "Codex took too long to answer. Please try again.".to_string())??;
    Ok(ChatReply { text: result })
}

fn prepare_input(query: String, context: Option<ChatContext>, project_cwd: &str) -> (String, String) {
    match context {
        Some(ChatContext::File { name, path }) => {
            let path = std::path::PathBuf::from(path);
            let cwd = path.parent().unwrap_or(std::path::Path::new("D:\\")).to_string_lossy().to_string();
            let text = format!(
                "You are Coucou's assistant. Answer in the user's language. Do not modify files.\n\nThe user attached a file named {name} at {}. Read it if useful.\n\nUser: {query}",
                path.display()
            );
            (cwd, text)
        }
        Some(ChatContext::Window { app_name, title, url }) => {
            let url = url.map(|u| format!("\nURL: {u}")).unwrap_or_default();
            (
                project_cwd.to_string(),
                format!("You are Coucou's assistant. Answer in the user's language. Do not modify files.\n\nWindow context: {app_name} — {title}{url}\n\nUser: {query}"),
            )
        }
        None => (
            project_cwd.to_string(),
            format!("You are Coucou's assistant. Answer in the user's language. Do not modify files.\n\nUser: {query}"),
        ),
    }
}

async fn run_turn(chat: &Chat, cwd: &str, text: &str) -> Result<String, String> {
    let mut child = Command::new("codex")
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| {
            if err.kind() == ErrorKind::NotFound {
                "Codex CLI was not found. Restart Coucou after installing Codex.".to_string()
            } else {
                format!("Could not start Codex: {err}")
            }
        })?;

    let input = child.stdin.take().ok_or("Could not open Codex input")?;
    let output = child.stdout.take().ok_or("Could not open Codex output")?;
    let mut reader = BufReader::new(output);
    let mut writer = input;

    request(&mut writer, &mut reader, 0, "initialize", json!({
        "clientInfo": {
            "name": "coucou",
            "title": "Coucou",
            "version": env!("CARGO_PKG_VERSION")
        }
    })).await?;
    notify(&mut writer, "initialized", json!({})).await?;

    let thread_id = match chat.thread_id() {
        Some(id) => {
            request(&mut writer, &mut reader, 1, "thread/resume", json!({
                "threadId": id,
                "cwd": cwd,
                "approvalPolicy": "never",
                "sandbox": "read-only"
            })).await?;
            id
        }
        None => {
            let response = request(&mut writer, &mut reader, 1, "thread/start", json!({
                "cwd": cwd,
                "approvalPolicy": "never",
                "sandbox": "read-only"
            })).await?;
            let id = response
                .pointer("/thread/id")
                .and_then(Value::as_str)
                .ok_or("Codex did not return a conversation id")?
                .to_string();
            chat.set_thread_id(id.clone());
            id
        }
    };

    write_message(&mut writer, json!({
        "id": 2,
        "method": "turn/start",
        "params": {
            "threadId": thread_id,
            "input": [{"type": "text", "text": text}],
            "cwd": cwd,
            "approvalPolicy": "never",
            "sandboxPolicy": {"type": "readOnly"}
        }
    })).await?;

    let mut answer = String::new();
    let mut got_turn_response = false;
    loop {
        let message = read_message(&mut reader).await?;

        if message.get("id").and_then(Value::as_i64) == Some(2) {
            if let Some(error) = message.get("error") {
                return Err(rpc_error(error));
            }
            got_turn_response = true;
            continue;
        }

        match message.get("method").and_then(Value::as_str) {
            Some("item/agentMessage/delta") => {
                if let Some(delta) = message.pointer("/params/delta").and_then(Value::as_str) {
                    answer.push_str(delta);
                }
            }
            Some("turn/completed") if got_turn_response => {
                let turn = message.get("params").and_then(|p| p.get("turn")).unwrap_or(&Value::Null);
                let status = turn.get("status").and_then(Value::as_str).unwrap_or("failed");
                if status != "completed" {
                    let reason = turn.pointer("/error/message").and_then(Value::as_str)
                        .unwrap_or("Codex could not complete the response.");
                    return Err(reason.to_string());
                }
                let _ = child.kill().await;
                let _ = child.wait().await;
                let answer = answer.trim().to_string();
                if answer.is_empty() {
                    return Err("Codex finished without a text response.".into());
                }
                return Ok(answer);
            }
            Some("error") => {
                if let Some(message) = message.pointer("/params/error/message").and_then(Value::as_str) {
                    return Err(message.to_string());
                }
            }
            _ => {}
        }
    }
}

async fn request(
    writer: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    id: i64,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    write_message(writer, json!({"id": id, "method": method, "params": params})).await?;
    loop {
        let message = read_message(reader).await?;
        if message.get("id").and_then(Value::as_i64) != Some(id) {
            continue;
        }
        if let Some(error) = message.get("error") {
            return Err(rpc_error(error));
        }
        return Ok(message.get("result").cloned().unwrap_or(Value::Null));
    }
}

async fn notify(writer: &mut ChildStdin, method: &str, params: Value) -> Result<(), String> {
    write_message(writer, json!({"method": method, "params": params})).await
}

async fn write_message(writer: &mut ChildStdin, message: Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
    line.push(b'\n');
    writer.write_all(&line).await.map_err(|e| format!("Could not send request to Codex: {e}"))?;
    writer.flush().await.map_err(|e| format!("Could not send request to Codex: {e}"))
}

async fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut line = String::new();
    let count = reader.read_line(&mut line).await.map_err(|e| format!("Could not read Codex response: {e}"))?;
    if count == 0 {
        return Err("Codex app-server closed the connection.".into());
    }
    serde_json::from_str(&line).map_err(|e| format!("Codex returned an invalid response: {e}"))
}

fn rpc_error(error: &Value) -> String {
    error.get("message").and_then(Value::as_str)
        .unwrap_or("Codex app-server request failed.").to_string()
}
