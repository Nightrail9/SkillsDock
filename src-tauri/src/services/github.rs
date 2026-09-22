//! GitHub 下载与 commits API
//!
//! - 仓库 ZIP 下载（60s 超时、≤128MiB 压缩体上限、分支回退 main/master）
//! - `GET /repos/{owner}/{name}/commits?sha={branch}&per_page=1` 取短 SHA
//! - 仓库技能探测：`git/trees` 递归列树找 SKILL.md + raw frontmatter 补名称简介

use anyhow::{anyhow, Result};
use futures::StreamExt;
use std::path::Path;
use std::sync::OnceLock;
use tokio::time::timeout;

use crate::error::format_skill_error;
use crate::services::skill_service::{SkillMetadata, SkillService, MAX_ARCHIVE_DOWNLOAD_BYTES};
use crate::types::{ProbedRepoSkill, RepoSkillProbe, SkillRepo};

/// 单仓库探测的技能条目上限
const MAX_PROBE_SKILLS: usize = 200;
/// 补充 frontmatter 的最大条数（raw.githubusercontent 不占 API 限流，仍设上限防滥用）
const MAX_PROBE_FRONTMATTER_FETCH: usize = 60;
/// frontmatter 并发拉取数
const PROBE_FRONTMATTER_CONCURRENCY: usize = 8;
/// 单个 SKILL.md 读取上限（超出按异常内容跳过）
const PROBE_FRONTMATTER_MAX_BYTES: usize = 256 * 1024;

/// 自建 HTTP 客户端（不依赖 proxy 层），带 User-Agent（GitHub API 必需）。
/// 连接超时 10s；整体超时 60s 与下载预算（download_repo_with_timeout）对齐，
/// commits API 等轻量请求用每请求 .timeout(...) 覆盖更小的值。
pub fn http_client() -> Result<&'static reqwest::Client> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("skilldock/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()?;
    Ok(CLIENT.get_or_init(|| client))
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
    let response = http_client()?.get(url).send().await?;
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
        .ok()?
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

// ========== 仓库技能探测 ==========

/// 探测仓库内全部可安装技能：递归列树找 SKILL.md，再补充 frontmatter 展示信息。
/// 指定分支请求失败时回退 main / master（与 ZIP 下载的分支策略一致）
pub async fn probe_repo_skills(owner: &str, name: &str, branch: &str) -> Result<RepoSkillProbe> {
    SkillService::validate_repo_ref(owner, name, branch)?;

    let mut branches = Vec::new();
    if !branch.is_empty() && !branch.eq_ignore_ascii_case("HEAD") {
        branches.push(branch.to_string());
    }
    for fallback in ["main", "master"] {
        if !branches.iter().any(|b| b == fallback) {
            branches.push(fallback.to_string());
        }
    }

    let mut last_error = None;
    for candidate in &branches {
        match probe_branch_skills(owner, name, candidate).await {
            Ok(probe) => return Ok(probe),
            Err(err) => {
                last_error = Some(err);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("所有分支探测失败")))
}

/// 列出指定分支下的全部 SKILL.md（git/trees API），并补充 frontmatter 信息
async fn probe_branch_skills(owner: &str, name: &str, branch: &str) -> Result<RepoSkillProbe> {
    let url = format!(
        "https://api.github.com/repos/{owner}/{name}/git/trees/{branch}?recursive=1"
    );
    let response = http_client()?
        .get(&url)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;
    if !response.status().is_success() {
        let status = response.status().as_u16().to_string();
        return Err(anyhow!(format_skill_error(
            "DOWNLOAD_FAILED",
            &[("url", &url), ("status", &status)],
            match status.as_str() {
                "403" => Some("http403"),
                "404" => Some("http404"),
                "429" => Some("http429"),
                _ => Some("checkNetwork"),
            },
        )));
    }
    let payload: serde_json::Value = response.json().await?;
    let tree = payload
        .get("tree")
        .and_then(|tree| tree.as_array())
        .ok_or_else(|| anyhow!("GitHub trees API 返回格式异常: {owner}/{name}@{branch}"))?;
    if payload
        .get("truncated")
        .and_then(|truncated| truncated.as_bool())
        .unwrap_or(false)
    {
        log::warn!("仓库 {owner}/{name}@{branch} 目录树被截断，探测结果可能不全");
    }

    let mut subpaths: Vec<String> = Vec::new();
    for entry in tree {
        let Some(path) = entry.get("path").and_then(|p| p.as_str()) else {
            continue;
        };
        let Some(subpath) = skill_subpath_from_md_path(path) else {
            continue;
        };
        subpaths.push(subpath);
        if subpaths.len() >= MAX_PROBE_SKILLS {
            log::warn!(
                "仓库 {owner}/{name}@{branch} 技能数量超过 {MAX_PROBE_SKILLS}，探测结果截断"
            );
            break;
        }
    }
    subpaths.sort();
    subpaths.dedup();

    let mut skills: Vec<ProbedRepoSkill> = subpaths
        .iter()
        .map(|subpath| {
            let dir_name = skill_dir_name(subpath, name);
            ProbedRepoSkill {
                name: dir_name,
                display_name: None,
                description: None,
                subpath: subpath.clone(),
            }
        })
        .collect();
    enrich_with_frontmatter(owner, name, branch, &mut skills).await;

    Ok(RepoSkillProbe {
        branch: branch.to_string(),
        skills,
    })
}

/// SKILL.md 的树内路径 → 技能子目录（仓库根级技能为 ""）；含隐藏路径段的跳过
fn skill_subpath_from_md_path(path: &str) -> Option<String> {
    let subpath = if path == "SKILL.md" {
        ""
    } else {
        path.strip_suffix("/SKILL.md")?
    };
    if subpath.split('/').any(|segment| segment.starts_with('.')) {
        return None;
    }
    Some(subpath.to_string())
}

/// 技能子目录的末段目录名（根级技能回落为仓库名）
fn skill_dir_name(subpath: &str, repo_name: &str) -> String {
    if subpath.is_empty() {
        return repo_name.to_string();
    }
    subpath
        .rsplit('/')
        .next()
        .unwrap_or(repo_name)
        .to_string()
}

/// 并发拉取前 N 个 SKILL.md 的 frontmatter，补充展示名与简介（失败静默保留目录名）
async fn enrich_with_frontmatter(
    owner: &str,
    name: &str,
    branch: &str,
    skills: &mut [ProbedRepoSkill],
) {
    let Ok(client) = http_client() else {
        return;
    };
    let targets: Vec<(usize, String)> = skills
        .iter()
        .take(MAX_PROBE_FRONTMATTER_FETCH)
        .enumerate()
        .map(|(idx, skill)| {
            let path = if skill.subpath.is_empty() {
                "SKILL.md".to_string()
            } else {
                format!("{}/SKILL.md", skill.subpath)
            };
            (
                idx,
                format!("https://raw.githubusercontent.com/{owner}/{name}/{branch}/{path}"),
            )
        })
        .collect();

    let fetched: Vec<(usize, Option<SkillMetadata>)> =
        futures::stream::iter(targets.into_iter().map(|(idx, url)| async move {
            let meta = fetch_frontmatter(client, &url).await;
            (idx, meta)
        }))
        .buffer_unordered(PROBE_FRONTMATTER_CONCURRENCY)
        .collect()
        .await;

    for (idx, meta) in fetched {
        let Some(meta) = meta else {
            continue;
        };
        if let Some(skill) = skills.get_mut(idx) {
            skill.display_name = meta.name;
            skill.description = meta.description;
        }
    }
}

/// 拉取单个 SKILL.md 并解析 frontmatter（网络或解析失败返回 None）
async fn fetch_frontmatter(client: &reqwest::Client, url: &str) -> Option<SkillMetadata> {
    let response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    if bytes.len() > PROBE_FRONTMATTER_MAX_BYTES {
        return None;
    }
    let content = std::str::from_utf8(&bytes).ok()?;
    Some(SkillService::parse_skill_metadata_str(content))
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


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_subpath_from_md_path_handles_root_and_nested() {
        assert_eq!(skill_subpath_from_md_path("SKILL.md"), Some(String::new()));
        assert_eq!(
            skill_subpath_from_md_path("skills/pdf/SKILL.md"),
            Some("skills/pdf".to_string())
        );
        assert_eq!(skill_subpath_from_md_path("README.md"), None);
        assert_eq!(skill_subpath_from_md_path("a/b/NOT_SKILL.md"), None);
    }

    #[test]
    fn skill_subpath_from_md_path_skips_hidden_components() {
        assert_eq!(skill_subpath_from_md_path(".github/SKILL.md"), None);
        assert_eq!(skill_subpath_from_md_path("skills/.hidden/SKILL.md"), None);
    }

    #[test]
    fn skill_dir_name_uses_last_segment_or_repo_name_for_root() {
        assert_eq!(skill_dir_name("skills/pdf", "repo"), "pdf");
        assert_eq!(skill_dir_name("single", "repo"), "single");
        assert_eq!(skill_dir_name("", "my-repo"), "my-repo");
    }

    #[test]
    fn parse_skill_metadata_str_reads_frontmatter_with_bom() {
        let content = "\u{feff}---\nname: pdf\ndescription: PDF toolkit\n---\n\n# body";
        let meta = SkillService::parse_skill_metadata_str(content);
        assert_eq!(meta.name.as_deref(), Some("pdf"));
        assert_eq!(meta.description.as_deref(), Some("PDF toolkit"));
    }

    #[test]
    fn parse_skill_metadata_str_returns_empty_without_frontmatter() {
        let meta = SkillService::parse_skill_metadata_str("# just markdown");
        assert_eq!(meta.name, None);
        assert_eq!(meta.description, None);
    }
}
