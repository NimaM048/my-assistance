//! Read-only, bounded search across locally available project folders.

use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

const MAX_PROJECTS: usize = 40;
const MAX_FILES_PER_PROJECT: usize = 12_000;
const MAX_FILES_TOTAL: usize = 20_000;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_RESULTS: usize = 100;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProject {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    project: String,
    path: String,
    relative_path: String,
    line: usize,
    preview: String,
    kind: &'static str,
}

pub fn search(projects: Vec<SearchProject>, query: String) -> Result<Vec<SearchHit>, String> {
    let term = query.trim();
    if term.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let needle = term.to_lowercase();
    let mut hits = Vec::new();
    let mut total_files = 0usize;
    let mut total_bytes = 0u64;

    for project in projects.into_iter().take(MAX_PROJECTS) {
        if total_files >= MAX_FILES_TOTAL || total_bytes >= MAX_TOTAL_BYTES {
            break;
        }
        let root = match fs::canonicalize(&project.path) {
            Ok(root) if root.is_dir() => root,
            _ => continue,
        };
        let mut visited = 0usize;
        walk(
            &root,
            &root,
            &project.name,
            &needle,
            0,
            &mut visited,
            &mut total_files,
            &mut total_bytes,
            &mut hits,
        );
        if hits.len() >= MAX_RESULTS {
            break;
        }
    }
    Ok(hits)
}

fn walk(
    root: &Path,
    dir: &Path,
    project: &str,
    needle: &str,
    depth: usize,
    visited: &mut usize,
    total_files: &mut usize,
    total_bytes: &mut u64,
    hits: &mut Vec<SearchHit>,
) {
    if depth >= 24
        || *visited >= MAX_FILES_PER_PROJECT
        || *total_files >= MAX_FILES_TOTAL
        || *total_bytes >= MAX_TOTAL_BYTES
        || hits.len() >= MAX_RESULTS
    {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if *visited >= MAX_FILES_PER_PROJECT
            || *total_files >= MAX_FILES_TOTAL
            || *total_bytes >= MAX_TOTAL_BYTES
            || hits.len() >= MAX_RESULTS
        {
            break;
        }
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if matches!(
                name.as_str(),
                ".git"
                    | "node_modules"
                    | "target"
                    | "dist"
                    | "build"
                    | ".next"
                    | ".venv"
                    | "venv"
                    | "vendor"
                    | "coverage"
                    | "__pycache__"
                    | ".idea"
            ) {
                continue;
            }
            walk(
                root,
                &path,
                project,
                needle,
                depth + 1,
                visited,
                total_files,
                total_bytes,
                hits,
            );
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        *visited += 1;
        *total_files += 1;
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if name == ".env"
            || name.starts_with(".env.")
            || matches!(
                name.as_str(),
                "id_rsa" | "id_ed25519" | "credentials" | "secrets.json"
            )
            || matches!(ext.as_str(), "pem" | "key" | "p12" | "pfx" | "kdbx")
        {
            continue;
        }
        let name_match = relative.to_lowercase().contains(needle);
        if name_match {
            hits.push(SearchHit {
                project: project.to_string(),
                path: path.to_string_lossy().into_owned(),
                relative_path: relative.clone(),
                line: 1,
                preview: "File name matches".into(),
                kind: "file",
            });
            if hits.len() >= MAX_RESULTS {
                break;
            }
        }
        if !is_text_file(&path, &name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > MAX_FILE_BYTES || *total_bytes + metadata.len() > MAX_TOTAL_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        *total_bytes += bytes.len() as u64;
        if bytes.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (index, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(needle) {
                let preview: String = line.trim().chars().take(240).collect();
                hits.push(SearchHit {
                    project: project.to_string(),
                    path: path.to_string_lossy().into_owned(),
                    relative_path: relative.clone(),
                    line: index + 1,
                    preview,
                    kind: "content",
                });
                if hits.len() >= MAX_RESULTS {
                    break;
                }
            }
        }
    }
}

fn is_text_file(path: &Path, name: &str) -> bool {
    if matches!(
        name,
        "dockerfile" | "makefile" | "license" | ".gitignore" | ".editorconfig"
    ) {
        return true;
    }
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "txt"
            | "md"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "css"
            | "html"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "py"
            | "go"
            | "java"
            | "cs"
            | "cpp"
            | "h"
            | "c"
            | "sh"
            | "ps1"
            | "sql"
            | "xml"
            | "svg"
            | "vue"
            | "svelte"
            | "php"
            | "rb"
            | "dart"
            | "swift"
            | "kt"
            | "gradle"
            | "properties"
            | "ini"
            | "conf"
            | "env.example"
    )
}

pub fn open_file(path: String, line: usize) -> bool {
    let Ok(file) = fs::canonicalize(&path) else {
        return false;
    };
    if !file.is_file() {
        return false;
    }
    let goto = format!("{}:{}", file.display(), line.max(1));
    if let Some(code) = find_code() {
        if Command::new(code)
            .args(["--goto", &goto])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .is_ok()
        {
            return true;
        }
    }
    let _ = Command::new("explorer").arg(file).spawn();
    false
}

fn find_code() -> Option<PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    for dir in std::env::split_paths(&std::env::var_os("PATH")?) {
        for ext in exts.split(';').filter(|ext| !ext.is_empty()) {
            let candidate = dir.join(format!("code{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}
