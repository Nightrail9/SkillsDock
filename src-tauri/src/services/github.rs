//! GitHub 下载与 commits API
//!
//! - 仓库 ZIP 下载（60s 超时、≤128MiB 压缩体上限、分支回退 main/master）
//! - `GET /repos/{owner}/{name}/commits?sha={branch}&per_page=1` 取短 SHA

use anyhow::{anyhow, Result};
use std::path::Path;
use std::sync::OnceLock;
use tokio::time::timeout;

use crate::error::format_skill_error;
use crate::services::skill_service::{SkillService, MAX_ARCHIVE_DOWNLOAD_BYTES};
use crate::types::SkillRepo;

/// 自建 HTTP 客户端（不依赖 proxy 层），带 User-Agent（GitHub API 必需）
pub fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("skilldock/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("failed to build reqwest client")
    })
}

/// 下载并解压仓库 ZIP 到临时目录
///
/// 分支回退策略：指定分支失败时依次尝试 main / master。
/// 返回 (TempDir 守卫, 实际使用的分支)。
pub async fn download_repo(repo: &SkillRepo) -> Result<(tempfile::TempDir, String)> {
    SkillService::validate_repo_ref(&repo.owner, &repo.name, &repo.branch)?;

    let temp_dir = tempfile::tempdir()?;
    let temp_path = temp_dir.path().to_path_buf();

    let mut branches = Vec::new();
    if !repo.branch.is_empty() && !repo.branch.eq_ignore_ascii_case("HEAD") {
        branches.push(repo.branch.as_str());
    }
    if !branches.contains(&"main") {
        branches.push("main");
    }
    if !branches.contains(&"master") {
        branches.push("master");
    }

    let mut last_error = None;
    for branch in branches {
        let url = format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.zip",
            repo.owner, repo.name, branch
        );
        SkillService::assert_github_archive_url(&url, &repo.owner, &repo.name)?;

        match download_and_extract(&url, &temp_path).await {
            Ok(()) => return Ok((temp_dir, branch.to_string())),
            Err(e) => {
                // 每个分支各自重算预算，失败后清掉残留再试下一个
                let _ = std::fs::remove_dir_all(&temp_path);
                let _ = std::fs::create_dir_all(&temp_path);
                last_error = Some(e);
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("所有分支下载失败")))
}

/// 带 60s 超时包装的仓库下载
pub async fn download_repo_with_timeout(repo: &SkillRepo) -> Result<(tempfile::TempDir, String)> {
    timeout(std::time::Duration::from_secs(60), download_repo(repo))
        .await
        .map_err(|_| {
            anyhow!(format_skill_error(
                "DOWNLOAD_TIMEOUT",
                &[
                    ("owner", &repo.owner),
                    ("name", &repo.name),
                    ("timeout", "60")
                ],
                Some("checkNetwork"),
            ))
        })?
}

/// 下载 ZIP 并解压（剥离 GitHub 归档自带的一层根目录）
pub async fn download_and_extract(url: &str, dest: &Path) -> Result<()> {
    let body = download_bytes_capped(url).await?;
    let cursor = std::io::Cursor::new(body);
    let archive = zip::ZipArchive::new(cursor)?;
    SkillService::extract_repo_archive(archive, dest)
}

/// 逐块下载并卡住压缩体大小上限（不信任 Content-Length）
async fn download_bytes_capped(url: &str) -> Result<Vec<u8>> {
    let response = http_client().get(url).send().await?;
    if !response.status().is_success() {
        let status = response.status().as_u16().to_string();
        return Err(anyhow!(format_skill_error(
            "DOWNLOAD_FAILED",
            &[("status", &status)],
            match status.as_str() {
                "403" => Some("http403"),
                "404" => Some("http404"),
                "429" => Some("http429"),
                _ => Some("checkNetwork"),
            },
        )));
    }

    let mut response = response;
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len().saturating_add(chunk.len()) as u64 > MAX_ARCHIVE_DOWNLOAD_BYTES {
            let limit_mb = (MAX_ARCHIVE_DOWNLOAD_BYTES / 1024 / 1024).to_string();
            return Err(anyhow!(format_skill_error(
                "ARCHIVE_TOO_LARGE",
                &[("limit_mb", &limit_mb)],
                Some("checkZipContent"),
            )));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// 获取仓库分支最新提交的短 SHA（未认证限流 60 次/小时/IP，调用方按仓库分组去重）
pub async fn fetch_latest_commit(owner: &str, name: &str, branch: &str) -> Option<String> {
    let url = format!(
        "https://api.github.com/repos/{}/{}/commits?sha={}&per_page=1",
        owner, name, branch
    );
    let response = http_client()
        .get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        log::warn!(
            "获取 {}/{}/{} 最新 commit 失败: HTTP {}",
            owner,
            name,
            branch,
            response.status()
        );
        return None;
    }
    let payload: serde_json::Value = response.json().await.ok()?;
    let sha = payload
        .as_array()?
        .first()?
        .get("sha")?
        .as_str()?
        .to_string();
    Some(sha.chars().take(7).collect())
}

/// 构建仓库内文档 URL（坐标非法时返回 None，避免产出可打开任意路径的链接）
pub fn build_skill_doc_url(owner: &str, repo: &str, branch: &str, doc_path: &str) -> Option<String> {
    if SkillService::validate_repo_ref(owner, repo, branch).is_err() {
        log::warn!("跳过非法仓库坐标的文档链接: {owner}/{repo}@{branch}");
        return None;
    }
    Some(format!(
        "https://github.com/{owner}/{repo}/blob/{branch}/{doc_path}"
    ))
}

/// 从既有 URL 中提取仓库内文档路径（兼容 blob/tree 两种格式）
pub fn extract_doc_path_from_url(url: &str) -> Option<String> {
    let marker = if url.contains("/blob/") {
        "/blob/"
    } else if url.contains("/tree/") {
        "/tree/"
    } else {
        return None;
    };
    let (_, tail) = url.split_once(marker)?;
    let (_, path) = tail.split_once('/')?;
    if path.is_empty() {
        return None;
    }
    Some(path.to_string())
}

/// 由真实解析出的源目录推导 SKILL.md 在仓库内的相对文档路径
pub fn doc_path_for_source(repo_root: &Path, source: &Path) -> Option<String> {
    let rel = source.strip_prefix(repo_root).ok()?;
    let mut parts: Vec<String> = rel
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    parts.push("SKILL.md".to_string());
    Some(parts.join("/"))
}

/// 选择文档路径：真实源目录优先，其次旧 URL 中的路径，最后按 directory 拼接
pub fn choose_doc_path(
    resolved_source_doc_path: Option<String>,
    readme_url: Option<&str>,
    directory: &str,
) -> String {
    if let Some(path) = resolved_source_doc_path {
        return path;
    }
    if let Some(path) = readme_url.and_then(extract_doc_path_from_url) {
        if path.ends_with("/SKILL.md") || path == "SKILL.md" {
            return path;
        }
        return format!("{}/SKILL.md", path.trim_end_matches('/'));
    }
    format!("{}/SKILL.md", directory.trim_end_matches('/'))
}

