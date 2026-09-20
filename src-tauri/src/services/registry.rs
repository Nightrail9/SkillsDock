//! skills.sh 注册表搜索

use std::collections::HashSet;

use anyhow::Result;
use serde::Deserialize;

use crate::services::github::http_client;
use crate::services::skill_service::SkillService;
use crate::types::{DiscoverySkillItem, SkillsShSearchResult};

/// skills.sh API 响应
#[derive(Debug, Deserialize)]
struct SkillsShApiResponse {
    pub query: String,
    #[serde(rename = "searchType")]
    #[allow(dead_code)]
    pub search_type: String,
    pub skills: Vec<SkillsShApiSkill>,
    pub count: usize,
    #[allow(dead_code)]
    pub duration_ms: u64,
}

/// skills.sh API 原始技能条目
#[derive(Debug, Deserialize)]
struct SkillsShApiSkill {
    pub id: String,
    #[serde(rename = "skillId")]
    pub skill_id: String,
    pub name: String,
    pub installs: u64,
    pub source: String,
}

/// 紧凑格式化计数：<1000 原样；<1M → "1.2k"（去掉尾 ".0"）；否则 "3.4M"
pub fn format_count(value: u64) -> String {
    if value < 1_000 {
        return value.to_string();
    }
    if value < 1_000_000 {
        let text = format!("{:.1}k", value as f64 / 1_000.0);
        return text.replace(".0k", "k");
    }
    let text = format!("{:.1}M", value as f64 / 1_000_000.0);
    text.replace(".0M", "M")
}

/// 搜索 skills.sh 注册表
///
/// `installed_keys`：已安装技能的匹配键集合，用于标记 is_installed。
/// 键形如 `"owner/repo:directory"`（全小写）或 registry id，避免同名不同源误命中。
pub async fn search_skills_sh(
    query: &str,
    limit: usize,
    offset: usize,
    installed_keys: &HashSet<String>,
) -> Result<SkillsShSearchResult> {
    let url = url::Url::parse_with_params(
        "https://skills.sh/api/search",
        &[
            ("q", query),
            ("limit", limit.to_string().as_str()),
            ("offset", offset.to_string().as_str()),
        ],
    )?;

    let resp = http_client()?
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?
        .error_for_status()?
        .json::<SkillsShApiResponse>()
        .await?;

    let skills = resp
        .skills
        .into_iter()
        .filter_map(|s| {
            let parts: Vec<&str> = s.source.splitn(2, '/').collect();
            if parts.len() != 2 {
                return None;
            }
            let (owner, repo) = (parts[0].to_string(), parts[1].to_string());
            // 与下载同一套坐标校验：过滤非 GitHub 来源与非法坐标
            if SkillService::validate_repo_ref(&owner, &repo, "main").is_err() {
                return None;
            }
            let directory = s.skill_id.clone();
            let repo_dir_key = format!("{owner}/{repo}:{directory}").to_lowercase();
            Some(DiscoverySkillItem {
                id: s.id.clone(),
                name: s.skill_id,
                display_name: s.name,
                description: String::new(),
                author: owner.clone(),
                source_type: "skills_sh".to_string(),
                stars: 0,
                downloads: format_count(s.installs),
                repo: Some(format!("{owner}/{repo}")),
                tags: vec![],
                latest_commit: String::new(),
                verified: true,
                is_installed: installed_keys.contains(&repo_dir_key)
                    || installed_keys.contains(&s.id),
            })
        })
        .collect();

    Ok(SkillsShSearchResult {
        skills,
        total_count: resp.count,
        query: resp.query,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_count_compacts() {
        assert_eq!(format_count(0), "0");
        assert_eq!(format_count(999), "999");
        assert_eq!(format_count(1_000), "1k");
        assert_eq!(format_count(1_200), "1.2k");
        assert_eq!(format_count(28_400), "28.4k");
        assert_eq!(format_count(1_000_000), "1M");
        assert_eq!(format_count(3_400_000), "3.4M");
    }
}
