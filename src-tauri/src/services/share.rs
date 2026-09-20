//! 分享链接：本地编码/解码技能清单
//!
//! 格式：`https://skilldock.app/s#<base64url(JSON)>`，payload 全部放在
//! fragment 中（不经过服务器），纯本地编解码。

use anyhow::{anyhow, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::types::SkillRecord;

pub const SHARE_BASE_URL: &str = "https://skilldock.app/s#";

/// 分享清单中的单个技能条目
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareSkillEntry {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 'github' | 'skills_sh'
    pub source_type: String,
    /// "owner/repo"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

/// 分享 payload（v 为格式版本号）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharePayload {
    pub v: u32,
    pub skills: Vec<ShareSkillEntry>,
}

/// 生成分享链接。纯本地技能（无远端来源）不可分享，会被拒绝。
pub fn create_share_link(records: &[SkillRecord]) -> Result<String> {
    if records.is_empty() {
        return Err(anyhow!("分享清单为空"));
    }

    let mut entries = Vec::with_capacity(records.len());
    for record in records {
        let is_remote = record.source_repo.is_some() || record.source_registry_id.is_some();
        if !is_remote {
            return Err(anyhow!(
                "本地技能「{}」没有远端来源，无法分享",
                record.display_name
            ));
        }
        entries.push(ShareSkillEntry {
            name: record.name.clone(),
            display_name: (!record.display_name.is_empty())
                .then(|| record.display_name.clone()),
            description: record.description.clone(),
            source_type: record.source_type.clone(),
            repo: record.source_repo.clone(),
            branch: record.source_branch.clone(),
            subpath: record.source_subpath.clone(),
            registry_id: record.source_registry_id.clone(),
            tags: record.tags.clone(),
        });
    }

    let payload = SharePayload { v: 1, skills: entries };
    encode_payload(&payload)
}

/// 解析分享链接（支持完整链接或裸 base64url payload）
pub fn parse_share_link(url: &str) -> Result<SharePayload> {
    let trimmed = url.trim();
    let encoded = match trimmed.split_once('#') {
        Some((_, fragment)) => fragment.trim(),
        None => trimmed,
    };
    if encoded.is_empty() {
        return Err(anyhow!("分享链接缺少 payload"));
    }
    decode_payload(encoded)
}

fn encode_payload(payload: &SharePayload) -> Result<String> {
    let json = serde_json::to_vec(payload)?;
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json);
    Ok(format!("{SHARE_BASE_URL}{encoded}"))
}

fn decode_payload(encoded: &str) -> Result<SharePayload> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|e| anyhow!("分享链接 payload 不是合法的 base64url: {e}"))?;
    let payload: SharePayload =
        serde_json::from_slice(&bytes).map_err(|e| anyhow!("分享链接 payload 解析失败: {e}"))?;
    if payload.v == 0 || payload.v > 1 {
        return Err(anyhow!("不支持的分享格式版本: v{}", payload.v));
    }
    if payload.skills.is_empty() {
        return Err(anyhow!("分享清单为空"));
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SKILL_SCOPE_GLOBAL;

    fn record(id: &str, directory: &str, repo: Option<&str>, registry: Option<&str>) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: directory.to_string(),
            display_name: directory.to_string(),
            description: Some("desc".to_string()),
            directory: directory.to_string(),
            tags: vec!["cli".to_string()],
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_id: None,
            project_path: None,
            source_type: if repo.is_some() { "github" } else { "local" }.to_string(),
            source_repo: repo.map(|r| r.to_string()),
            source_branch: repo.map(|_| "main".to_string()),
            source_subpath: None,
            source_author: None,
            source_registry_id: registry.map(|r| r.to_string()),
            source_url: None,
            source_github_detected: false,
            current_commit: Some("abc1234".to_string()),
            latest_commit: None,
            has_update: false,
            content_hash: None,
            enabled_tools: vec![],
            deploy_method: "auto".to_string(),
            installed_at: 1,
            updated_at: 0,
            author: None,
            license: None,
        }
    }

    #[test]
    fn share_link_roundtrip_single_and_multi() {
        let records = vec![
            record("owner/repo:a", "a", Some("owner/repo"), None),
            record("owner/repo2:b", "b", Some("owner/repo2"), None),
        ];
        let link = create_share_link(&records).expect("create");
        assert!(link.starts_with(SHARE_BASE_URL));

        let payload = parse_share_link(&link).expect("parse");
        assert_eq!(payload.v, 1);
        assert_eq!(payload.skills.len(), 2);
        assert_eq!(payload.skills[0].repo.as_deref(), Some("owner/repo"));
        assert_eq!(payload.skills[0].tags, vec!["cli"]);
        assert_eq!(payload.skills[1].name, "b");

        // 裸 payload 也能解析
        let encoded = link.split_once('#').unwrap().1;
        let payload2 = parse_share_link(encoded).expect("bare payload");
        assert_eq!(payload, payload2);
    }

    #[test]
    fn rejects_pure_local_skills() {
        let records = vec![record("local:a", "a", None, None)];
        let err = create_share_link(&records).expect_err("local must be rejected");
        assert!(err.to_string().contains("无法分享"));
    }

    #[test]
    fn rejects_garbage_payload() {
        assert!(parse_share_link("https://skilldock.app/s#!!!").is_err());
        assert!(parse_share_link("").is_err());
    }
}
