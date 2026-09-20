//! 本地目录 Git 来源识别
//!
//! 手工解析 `<dir>/.git/config`（INI 子集）与 HEAD/refs，
//! 不依赖 git 可执行文件。只识别 github.com 远端。

use std::path::{Path, PathBuf};

/// 从本地目录识别出的 Git 来源信息
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitSourceInfo {
    /// "owner/repo"
    pub repo: String,
    pub branch: Option<String>,
    /// 短 SHA（7 位）
    pub commit: Option<String>,
    /// 远端原始 URL
    pub url: String,
}

/// 识别目录的 GitHub 来源；目录不是 git 仓库或远端不是 github.com 时返回 None
pub fn detect_github_source(dir: &Path) -> Option<GitSourceInfo> {
    let git_dir = dir.join(".git");
    let config_path = git_dir.join("config");
    let content = std::fs::read_to_string(config_path).ok()?;

    let remote_url = parse_origin_url(&content)?;
    let repo = parse_github_repo(&remote_url)?;

    let (branch, commit) = read_head(&git_dir);

    Some(GitSourceInfo {
        repo,
        branch,
        commit,
        url: remote_url,
    })
}

/// 在 .git/config 文本中找 `[remote "origin"]` 段的 `url = ...`
fn parse_origin_url(config: &str) -> Option<String> {
    let mut in_origin = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_origin = line.eq_ignore_ascii_case("[remote \"origin\"]");
            continue;
        }
        if in_origin {
            if let Some((key, value)) = line.split_once('=') {
                if key.trim().eq_ignore_ascii_case("url") {
                    let value = value.trim();
                    if !value.is_empty() {
                        return Some(value.to_string());
                    }
                }
            }
        }
    }
    None
}

/// 从远端 URL 提取 "owner/repo"，只认 github.com
///
/// 支持：
/// - `https://github.com/owner/repo(.git)`
/// - `git@github.com:owner/repo(.git)`
/// - `ssh://git@github.com/owner/repo(.git)`
fn parse_github_repo(url: &str) -> Option<String> {
    let path = if let Some(rest) = url.strip_prefix("git@github.com:") {
        rest.to_string()
    } else if let Ok(parsed) = url::Url::parse(url) {
        let host = parsed.host_str()?;
        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }
        parsed.path().trim_start_matches('/').to_string()
    } else {
        return None;
    };

    let path = path.trim_end_matches('/').trim_end_matches(".git");
    let mut segments = path.split('/');
    let owner = segments.next()?;
    let name = segments.next()?;
    if owner.is_empty() || name.is_empty() || segments.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{name}"))
}

/// 读 HEAD 得到 (branch, commit 短 SHA)
fn read_head(git_dir: &Path) -> (Option<String>, Option<String>) {
    let head = match std::fs::read_to_string(git_dir.join("HEAD")) {
        Ok(content) => content.trim().to_string(),
        Err(_) => return (None, None),
    };

    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        let branch = reference
            .strip_prefix("refs/heads/")
            .map(|name| name.to_string());
        let commit = read_ref(git_dir, reference);
        (branch, commit)
    } else {
        // detached HEAD：内容即完整 SHA
        let short: String = head.chars().take(7).collect();
        (None, (!short.is_empty()).then_some(short))
    }
}

/// 读引用对应的 SHA：先 loose ref，再 packed-refs；返回短 SHA
fn read_ref(git_dir: &Path, reference: &str) -> Option<String> {
    let loose: PathBuf = git_dir.join(reference);
    if let Ok(sha) = std::fs::read_to_string(&loose) {
        let sha = sha.trim();
        if !sha.is_empty() {
            return Some(sha.chars().take(7).collect());
        }
    }
    if let Ok(packed) = std::fs::read_to_string(git_dir.join("packed-refs")) {
        for line in packed.lines() {
            let line = line.trim();
            if line.starts_with('#') || line.starts_with('^') {
                continue;
            }
            if let Some((sha, name)) = line.split_once(' ') {
                if name.trim() == reference {
                    return Some(sha.trim().chars().take(7).collect());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_git_repo(dir: &Path, config: &str, head: &str, refs: &[(&str, &str)]) {
        let git_dir = dir.join(".git");
        fs::create_dir_all(&git_dir).unwrap();
        fs::write(git_dir.join("config"), config).unwrap();
        fs::write(git_dir.join("HEAD"), head).unwrap();
        for (reference, sha) in refs {
            let path = git_dir.join(reference);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, sha).unwrap();
        }
    }

    #[test]
    fn detects_https_remote_with_branch_and_commit() {
        let temp = tempfile::tempdir().unwrap();
        write_git_repo(
            temp.path(),
            "[remote \"origin\"]\n\turl = https://github.com/anthropics/skills.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n",
            "ref: refs/heads/main\n",
            &[(
                "refs/heads/main",
                "0123456789abcdef0123456789abcdef01234567\n",
            )],
        );
        let info = detect_github_source(temp.path()).expect("should detect");
        assert_eq!(info.repo, "anthropics/skills");
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(info.commit.as_deref(), Some("0123456"));
        assert_eq!(info.url, "https://github.com/anthropics/skills.git");
    }

    #[test]
    fn detects_ssh_remote_and_packed_refs() {
        let temp = tempfile::tempdir().unwrap();
        write_git_repo(
            temp.path(),
            "[remote \"origin\"]\n\turl = git@github.com:owner/repo\n",
            "ref: refs/heads/feature/x\n",
            &[],
        );
        fs::write(
            temp.path().join(".git/packed-refs"),
            "# pack-refs with: peeled fully-peeled sorted \nabcdef0123456789abcdef0123456789abcdef01 refs/heads/feature/x\n",
        )
        .unwrap();
        let info = detect_github_source(temp.path()).expect("should detect");
        assert_eq!(info.repo, "owner/repo");
        assert_eq!(info.branch.as_deref(), Some("feature/x"));
        assert_eq!(info.commit.as_deref(), Some("abcdef0"));
    }

    #[test]
    fn rejects_non_github_remote_and_detached_head() {
        let temp = tempfile::tempdir().unwrap();
        write_git_repo(
            temp.path(),
            "[remote \"origin\"]\n\turl = https://gitlab.com/owner/repo.git\n",
            "ref: refs/heads/main\n",
            &[],
        );
        assert!(detect_github_source(temp.path()).is_none());

        let temp2 = tempfile::tempdir().unwrap();
        write_git_repo(
            temp2.path(),
            "[remote \"origin\"]\n\turl = ssh://git@github.com/owner/repo.git\n",
            "0123456789abcdef0123456789abcdef01234567\n",
            &[],
        );
        let info = detect_github_source(temp2.path()).expect("detached");
        assert_eq!(info.repo, "owner/repo");
        assert_eq!(info.branch, None);
        assert_eq!(info.commit.as_deref(), Some("0123456"));
    }

    #[test]
    fn returns_none_without_git_dir() {
        let temp = tempfile::tempdir().unwrap();
        assert!(detect_github_source(temp.path()).is_none());
    }
}
