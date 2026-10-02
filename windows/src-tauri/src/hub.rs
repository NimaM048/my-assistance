//! Free GitHub repository catalog and local clone discovery for the Hub window.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::secrets;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubCatalog {
    login: String,
    repositories: Vec<GitHubRepository>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    full_name: String,
    name: String,
    description: Option<String>,
    html_url: String,
    clone_url: String,
    private: bool,
    fork: bool,
    archived: bool,
    language: Option<String>,
    stars: u64,
    forks: u64,
    updated_at: String,
    local_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkQueue {
    items: Vec<GitHubWorkItem>,
    warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubWorkItem {
    id: String,
    number: u64,
    title: String,
    repository: String,
    kind: String,
    html_url: String,
    created_at: String,
    updated_at: String,
    labels: Vec<String>,
    comments: u64,
    draft: bool,
}

pub async fn repositories() -> Result<GitHubCatalog, String> {
    let token = secrets::get("github-token")
        .ok_or_else(|| "Connect your free GitHub account in Coucou Settings first.".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "Could not create a GitHub connection.".to_string())?;
    let user = github_get(&client, &token, "https://api.github.com/user").await?;
    let login = user.get("login").and_then(Value::as_str).unwrap_or_default().to_string();
    let mut records = Vec::<Value>::new();
    for page in 1..=10 {
        let url = format!("https://api.github.com/user/repos?per_page=100&page={page}&sort=updated");
        let page_records = github_get(&client, &token, &url).await?;
        let Some(page_records) = page_records.as_array() else {
            return Err("GitHub returned an invalid repository list.".into());
        };
        let count = page_records.len();
        records.extend(page_records.iter().cloned());
        if count < 100 { break; }
    }

    let local = find_local_repositories();
    let repositories = records
        .into_iter()
        .filter_map(|repo| {
            let full_name = repo.get("full_name")?.as_str()?.to_string();
            Some(GitHubRepository {
                name: repo.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                local_path: local.get(&full_name).cloned(),
                full_name,
                description: repo.get("description").and_then(Value::as_str).map(str::to_string),
                html_url: repo.get("html_url").and_then(Value::as_str).unwrap_or_default().to_string(),
                clone_url: repo.get("clone_url").and_then(Value::as_str).unwrap_or_default().to_string(),
                private: repo.get("private").and_then(Value::as_bool).unwrap_or(false),
                fork: repo.get("fork").and_then(Value::as_bool).unwrap_or(false),
                archived: repo.get("archived").and_then(Value::as_bool).unwrap_or(false),
                language: repo.get("language").and_then(Value::as_str).map(str::to_string),
                stars: repo.get("stargazers_count").and_then(Value::as_u64).unwrap_or(0),
                forks: repo.get("forks_count").and_then(Value::as_u64).unwrap_or(0),
                updated_at: repo.get("updated_at").and_then(Value::as_str).unwrap_or_default().to_string(),
            })
        })
        .collect();
    Ok(GitHubCatalog { login, repositories })
}

pub async fn work_queue() -> Result<GitHubWorkQueue, String> {
    let token = secrets::get("github-token")
        .ok_or_else(|| "Connect your free GitHub account in Coucou Settings first.".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "Could not create a GitHub connection.".to_string())?;

    let assigned = github_get(
        &client,
        &token,
        "https://api.github.com/issues?filter=assigned&state=open&per_page=100&sort=updated&direction=desc",
    )
    .await?;
    let assigned = assigned
        .as_array()
        .ok_or_else(|| "GitHub returned an invalid work list.".to_string())?;
    let mut items = assigned
        .iter()
        .filter_map(|value| parse_work_item(value, false))
        .collect::<Vec<_>>();

    let mut warning = None;
    let reviews = github_get(
        &client,
        &token,
        "https://api.github.com/search/issues?q=is%3Aopen+is%3Apr+review-requested%3A%40me&per_page=100&sort=updated&order=desc",
    )
    .await;
    match reviews {
        Ok(result) => {
            if let Some(reviews) = result.get("items").and_then(Value::as_array) {
                for value in reviews {
                    let Some(item) = parse_work_item(value, true) else { continue };
                    if let Some(existing) = items.iter_mut().find(|existing| existing.id == item.id) {
                        existing.kind = "review".into();
                    } else {
                        items.push(item);
                    }
                }
            } else {
                warning = Some("GitHub returned an invalid review request list.".into());
            }
        }
        Err(error) => warning = Some(format!("Review requests could not be loaded: {error}")),
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(GitHubWorkQueue { items, warning })
}

fn parse_work_item(value: &Value, review_requested: bool) -> Option<GitHubWorkItem> {
    let number = value.get("number")?.as_u64()?;
    let repository_url = value.get("repository_url")?.as_str()?;
    let repository = repository_url.strip_prefix("https://api.github.com/repos/")?.to_string();
    let is_pull_request = value.get("pull_request").is_some();
    let kind = if review_requested { "review" } else if is_pull_request { "pullRequest" } else { "issue" };
    let labels = value
        .get("labels")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|label| label.get("name").and_then(Value::as_str).map(str::to_string))
        .collect();
    Some(GitHubWorkItem {
        id: format!("{repository}#{number}"),
        number,
        title: value.get("title")?.as_str()?.to_string(),
        repository,
        kind: kind.into(),
        html_url: value.get("html_url")?.as_str()?.to_string(),
        created_at: value.get("created_at").and_then(Value::as_str).unwrap_or_default().to_string(),
        updated_at: value.get("updated_at").and_then(Value::as_str).unwrap_or_default().to_string(),
        labels,
        comments: value.get("comments").and_then(Value::as_u64).unwrap_or(0),
        draft: value.get("draft").and_then(Value::as_bool).unwrap_or(false),
    })
}

async fn github_get(client: &reqwest::Client, token: &str, url: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Coucou")
        .send()
        .await
        .map_err(|_| "Could not reach GitHub. Check your connection and try again.".to_string())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => "GitHub rejected this connection. Reconnect the account in Coucou Settings.".into(),
            code => format!("GitHub returned HTTP {code}."),
        });
    }
    response.json().await.map_err(|_| "GitHub returned unreadable data.".to_string())
}

fn find_local_repositories() -> HashMap<String, String> {
    let mut roots = Vec::<PathBuf>::new();
    if let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        roots.push(profile.join("source").join("repos"));
        roots.push(profile.join("Documents").join("GitHub"));
    }
    roots.push(PathBuf::from(r"D:\PycharmProjects"));
    roots.push(PathBuf::from(r"D:\Projects"));
    let mut found = HashMap::new();
    for root in roots {
        if root.is_dir() { scan_repositories(&root, 0, &mut found); }
    }
    found
}

fn scan_repositories(directory: &Path, depth: usize, found: &mut HashMap<String, String>) {
    if depth > 5 { return; }
    let Ok(entries) = fs::read_dir(directory) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) { continue; }
        if name == ".git" || name == "node_modules" || name == ".venv" || name == "venv" || name == "target" { continue; }
        let git_dir = path.join(".git");
        if git_dir.is_dir() {
            if let Some(remote) = fs::read_to_string(git_dir.join("config")).ok().and_then(|config| origin_url(&config)) {
                if let Some(repo) = github_name(&remote) {
                    found.entry(repo).or_insert_with(|| path.to_string_lossy().to_string());
                }
            }
            continue;
        }
        scan_repositories(&path, depth + 1, found);
    }
}

fn origin_url(config: &str) -> Option<String> {
    let mut origin = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            origin = line == "[remote \"origin\"]";
        } else if origin {
            if let Some(url) = line.strip_prefix("url = ") { return Some(url.trim().to_string()); }
        }
    }
    None
}

fn github_name(remote: &str) -> Option<String> {
    let value = remote.trim_end_matches(".git");
    let path = if let Some((_, rest)) = value.split_once("github.com/") {
        rest
    } else if let Some(rest) = value.strip_prefix("git@github.com:") {
        rest
    } else {
        return None;
    };
    let mut parts = path.trim_end_matches('/').split('/');
    Some(format!("{}/{}", parts.next()?, parts.next()?))
}
