//! Free project overview built from local Git data and GitHub's public REST API.
//! No hosted AI or paid service is involved.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;

use crate::secrets;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    project_name: String,
    path: String,
    branch: Option<String>,
    changed_files: usize,
    changed_paths: Vec<String>,
    staged_files: usize,
    unstaged_files: usize,
    untracked_files: usize,
    last_commit: Option<String>,
    last_commit_at: Option<i64>,
    github_repo: Option<String>,
    issues: Vec<ProjectItem>,
    pull_requests: Vec<ProjectItem>,
    github_error: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItem {
    number: u64,
    title: String,
    url: String,
    state: String,
}

pub async fn load(path: String) -> Result<ProjectStatus, String> {
    load_with_github(path, true).await
}

/// Local-only variant for the Hub: it can refresh several projects without
/// spending GitHub API requests for each repository.
pub async fn load_local(path: String) -> Result<ProjectStatus, String> {
    load_with_github(path, false).await
}

async fn load_with_github(path: String, include_github: bool) -> Result<ProjectStatus, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("Project folder is unavailable. Open a project in VS Code and run a Codex prompt first.".into());
    }
    let project_name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
    let git_root = git(&root, &["rev-parse", "--show-toplevel"]).await;
    let Some(git_root) = git_root.filter(|s| !s.is_empty()).map(PathBuf::from) else {
        return Ok(ProjectStatus {
            project_name,
            path,
            branch: None,
            changed_files: 0,
            changed_paths: Vec::new(),
            staged_files: 0,
            unstaged_files: 0,
            untracked_files: 0,
            last_commit: None,
            last_commit_at: None,
            github_repo: None,
            issues: Vec::new(),
            pull_requests: Vec::new(),
            github_error: None,
            error: Some("This folder is not a Git repository.".into()),
        });
    };

    let branch = git(&git_root, &["branch", "--show-current"]).await.filter(|s| !s.is_empty());
    let porcelain = git(&git_root, &["status", "--short", "--untracked-files=all"]).await.unwrap_or_default();
    let mut changed_files = 0;
    let mut changed_paths = Vec::new();
    let mut staged_files = 0;
    let mut unstaged_files = 0;
    let mut untracked_files = 0;
    for line in porcelain.lines() {
        let status = line.get(..2).unwrap_or("");
        changed_paths.push(line.get(3..).unwrap_or(line).to_string());
        changed_files += 1;
        if status == "??" {
            untracked_files += 1;
        } else {
            if status.chars().next().is_some_and(|c| c != ' ') { staged_files += 1; }
            if status.chars().nth(1).is_some_and(|c| c != ' ') { unstaged_files += 1; }
        }
    }
    let last_commit = git(&git_root, &["log", "-1", "--format=%h %s"]).await.filter(|s| !s.is_empty());
    let last_commit_at = git(&git_root, &["log", "-1", "--format=%ct"]).await.and_then(|s| s.parse().ok());
    let remote = git(&git_root, &["remote", "get-url", "origin"]).await;
    let repo = remote.as_deref().and_then(parse_github_repo);
    let (issues, pull_requests, github_error) = if include_github {
        if let Some((owner, name)) = &repo {
            match github_items(owner, name).await {
                Ok((issues, pulls)) => (issues, pulls, None),
                Err(error) => (Vec::new(), Vec::new(), Some(error)),
            }
        } else {
            (Vec::new(), Vec::new(), None)
        }
    } else {
        (Vec::new(), Vec::new(), None)
    };

    Ok(ProjectStatus {
        project_name,
        path: git_root.to_string_lossy().to_string(),
        branch,
        changed_files,
        changed_paths,
        staged_files,
        unstaged_files,
        untracked_files,
        last_commit,
        last_commit_at,
        github_repo: repo.map(|(owner, name)| format!("{owner}/{name}")),
        issues,
        pull_requests,
        github_error,
        error: None,
    })
}

async fn git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .output()
        .await
        .ok()?;
    if !output.status.success() { return None; }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(windows)]
trait NoConsole {
    fn creation_flags(&mut self, flags: u32) -> &mut Self;
}

#[cfg(windows)]
impl NoConsole for Command {
    fn creation_flags(&mut self, flags: u32) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.as_std_mut().creation_flags(flags);
        self
    }
}

fn parse_github_repo(remote: &str) -> Option<(String, String)> {
    let value = remote.trim_end_matches(".git");
    let path = if let Some((_, rest)) = value.split_once("github.com/") {
        rest
    } else if let Some(rest) = value.strip_prefix("git@github.com:") {
        rest
    } else {
        return None;
    };
    let mut parts = path.split('/');
    Some((parts.next()?.to_string(), parts.next()?.to_string()))
}

async fn github_items(owner: &str, repo: &str) -> Result<(Vec<ProjectItem>, Vec<ProjectItem>), String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().map_err(|e| e.to_string())?;
    let url = format!("https://api.github.com/repos/{owner}/{repo}/issues?state=open&per_page=20&sort=updated");
    let mut request = client.get(url).header("User-Agent", "Coucou").header("Accept", "application/vnd.github+json");
    if let Some(token) = secrets::get("github-token") {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|_| "Could not reach GitHub; local Git status is still available.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub returned HTTP {}. Local Git status is still available.", response.status().as_u16()));
    }
    let records = response.json::<Vec<Value>>().await.map_err(|_| "GitHub returned unreadable project data.".to_string())?;
    let mut issues = Vec::new();
    let mut pulls = Vec::new();
    for record in records {
        let Some(number) = record.get("number").and_then(Value::as_u64) else { continue };
        let item = ProjectItem {
            number,
            title: record.get("title").and_then(Value::as_str).unwrap_or("Untitled").to_string(),
            url: record.get("html_url").and_then(Value::as_str).unwrap_or_default().to_string(),
            state: record.get("state").and_then(Value::as_str).unwrap_or("open").to_string(),
        };
        if record.get("pull_request").is_some() {
            if pulls.len() < 3 { pulls.push(item); }
        } else if issues.len() < 3 {
            issues.push(item);
        }
    }
    Ok((issues, pulls))
}
