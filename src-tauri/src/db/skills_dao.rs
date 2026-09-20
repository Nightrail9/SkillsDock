//! Skills 数据访问对象

use super::{lock_conn, to_json_string, Database};
use crate::error::AppError;
use crate::types::SkillRecord;
use indexmap::IndexMap;
use rusqlite::params;

fn parse_json_string_list(raw: &str) -> Vec<String> {
    match serde_json::from_str(raw) {
        Ok(list) => list,
        Err(e) => {
            // 解析失败不再静默丢数据：记录截断的原始内容后返回空列表
            let truncated: String = raw.chars().take(80).collect();
            log::warn!("JSON 字符串列表解析失败，按空列表处理: {e}; raw={truncated:?}");
            Vec::new()
        }
    }
}

/// strip 核心：在已有事务内从所有技能的 enabled_tools 中移除工具 id
pub(crate) fn strip_tool_in_tx(
    tx: &rusqlite::Transaction,
    tool_id: &str,
) -> Result<usize, AppError> {
    let mut stmt = tx
        .prepare("SELECT id, enabled_tools FROM skills")
        .map_err(|e| AppError::Database(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| AppError::Database(e.to_string()))?;
    let mut updates: Vec<(String, String)> = Vec::new();
    for row in rows {
        let (id, raw) = row.map_err(|e| AppError::Database(e.to_string()))?;
        let tools = parse_json_string_list(&raw);
        if tools.iter().any(|t| t == tool_id) {
            let remaining: Vec<String> = tools.into_iter().filter(|t| t != tool_id).collect();
            updates.push((id, to_json_string(&remaining)?));
        }
    }
    drop(stmt);
    let changed = updates.len();
    for (id, json) in updates {
        tx.execute(
            "UPDATE skills SET enabled_tools = ?1 WHERE id = ?2",
            params![json, id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    }
    Ok(changed)
}

const SKILL_COLUMNS: &str = "id, name, display_name, description, directory, tags, scope,
     project_id, project_path, source_type, source_repo, source_branch, source_subpath,
     source_author, source_registry_id, source_url, source_github_detected,
     current_commit, latest_commit, has_update, content_hash, enabled_tools,
     deploy_method, installed_at, updated_at, author, license";

fn row_to_skill(row: &rusqlite::Row) -> rusqlite::Result<SkillRecord> {
    Ok(SkillRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        description: row.get(3)?,
        directory: row.get(4)?,
        tags: parse_json_string_list(&row.get::<_, String>(5).unwrap_or_default()),
        scope: row.get(6)?,
        project_id: row.get(7)?,
        project_path: row.get(8)?,
        source_type: row.get(9)?,
        source_repo: row.get(10)?,
        source_branch: row.get(11)?,
        source_subpath: row.get(12)?,
        source_author: row.get(13)?,
        source_registry_id: row.get(14)?,
        source_url: row.get(15)?,
        source_github_detected: row.get::<_, i64>(16)? != 0,
        current_commit: row.get(17)?,
        latest_commit: row.get(18)?,
        has_update: row.get::<_, i64>(19)? != 0,
        content_hash: row.get(20)?,
        enabled_tools: parse_json_string_list(&row.get::<_, String>(21).unwrap_or_default()),
        deploy_method: row.get(22)?,
        installed_at: row.get(23)?,
        updated_at: row.get(24)?,
        author: row.get(25)?,
        license: row.get(26)?,
    })
}

impl Database {
    /// 获取所有技能（按显示名排序）
    pub fn get_all_skills(&self) -> Result<IndexMap<String, SkillRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {SKILL_COLUMNS} FROM skills ORDER BY display_name ASC, name ASC"
            ))
            .map_err(|e| AppError::Database(e.to_string()))?;

        let rows = stmt
            .query_map([], row_to_skill)
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut skills = IndexMap::new();
        for row in rows {
            let skill = row.map_err(|e| AppError::Database(e.to_string()))?;
            skills.insert(skill.id.clone(), skill);
        }
        Ok(skills)
    }

    pub fn get_skill(&self, id: &str) -> Result<Option<SkillRecord>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            &format!("SELECT {SKILL_COLUMNS} FROM skills WHERE id = ?1"),
            params![id],
            row_to_skill,
        );
        match result {
            Ok(skill) => Ok(Some(skill)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// 保存技能（INSERT OR REPLACE，用于安装路径）
    pub fn save_skill(&self, skill: &SkillRecord) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skills (
                id, name, display_name, description, directory, tags, scope,
                project_id, project_path, source_type, source_repo, source_branch, source_subpath,
                source_author, source_registry_id, source_url, source_github_detected,
                current_commit, latest_commit, has_update, content_hash, enabled_tools,
                deploy_method, installed_at, updated_at, author, license
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                       ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)",
            params![
                skill.id,
                skill.name,
                skill.display_name,
                skill.description,
                skill.directory,
                to_json_string(&skill.tags)?,
                skill.scope,
                skill.project_id,
                skill.project_path,
                skill.source_type,
                skill.source_repo,
                skill.source_branch,
                skill.source_subpath,
                skill.source_author,
                skill.source_registry_id,
                skill.source_url,
                skill.source_github_detected as i64,
                skill.current_commit,
                skill.latest_commit,
                skill.has_update as i64,
                skill.content_hash,
                to_json_string(&skill.enabled_tools)?,
                skill.deploy_method,
                skill.installed_at,
                skill.updated_at,
                skill.author,
                skill.license,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    /// 仅更新已有记录的元数据（更新流程使用；不插入缺失行，不动 enabled_tools）
    pub fn update_skill_metadata(&self, skill: &SkillRecord) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET name = ?1, display_name = ?2, description = ?3,
                    source_branch = ?4, current_commit = ?5, latest_commit = ?6, has_update = ?7,
                    content_hash = ?8, updated_at = ?9, source_url = ?10
                 WHERE id = ?11",
                params![
                    skill.name,
                    skill.display_name,
                    skill.description,
                    skill.source_branch,
                    skill.current_commit,
                    skill.latest_commit,
                    skill.has_update as i64,
                    skill.content_hash,
                    skill.updated_at,
                    skill.source_url,
                    skill.id,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    pub fn delete_skill(&self, id: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute("DELETE FROM skills WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 更新技能的工具分发列表（整体替换）
    pub fn update_skill_enabled_tools(&self, id: &str, tools: &[String]) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET enabled_tools = ?1 WHERE id = ?2",
                params![to_json_string(&tools)?, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 从所有技能的 enabled_tools 中移除某个工具 id（删除工具适配器时调用，单事务）
    pub fn strip_tool_from_all_skills(&self, tool_id: &str) -> Result<usize, AppError> {
        self.with_write_tx(|tx| strip_tool_in_tx(tx, tool_id))
    }

    /// 批量整体替换多个技能的标签（单事务），返回更新的记录数
    pub fn set_tags_for_skills(&self, ids: &[String], tags: &[String]) -> Result<usize, AppError> {
        let json = to_json_string(&tags)?;
        self.with_write_tx(|tx| {
            let mut changed = 0;
            for id in ids {
                changed += tx
                    .execute("UPDATE skills SET tags = ?1 WHERE id = ?2", params![json, id])
                    .map_err(|e| AppError::Database(e.to_string()))?;
            }
            Ok(changed)
        })
    }

    /// 更新内容哈希（不触碰 updated_at）
    pub fn update_skill_hash(&self, id: &str, content_hash: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET content_hash = ?1 WHERE id = ?2",
                params![content_hash, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 更新更新检测状态
    pub fn update_skill_update_state(
        &self,
        id: &str,
        latest_commit: Option<&str>,
        has_update: bool,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET latest_commit = ?1, has_update = ?2 WHERE id = ?3",
                params![latest_commit, has_update as i64, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    /// 更新技能标签（整体替换）
    pub fn update_skill_tags(&self, id: &str, tags: &[String]) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE skills SET tags = ?1 WHERE id = ?2",
                params![to_json_string(&tags)?, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SKILL_SCOPE_GLOBAL;

    fn skill(id: &str, directory: &str) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: directory.to_string(),
            display_name: directory.to_string(),
            description: Some("desc".to_string()),
            directory: directory.to_string(),
            tags: vec![],
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_id: None,
            project_path: None,
            source_type: "github".to_string(),
            source_repo: Some("owner/repo".to_string()),
            source_branch: Some("main".to_string()),
            source_subpath: None,
            source_author: None,
            source_registry_id: None,
            source_url: None,
            source_github_detected: false,
            current_commit: Some("abc1234".to_string()),
            latest_commit: None,
            has_update: false,
            content_hash: Some("hash".to_string()),
            enabled_tools: vec![],
            deploy_method: "auto".to_string(),
            installed_at: 1,
            updated_at: 0,
            author: None,
            license: None,
        }
    }

    #[test]
    fn parse_json_string_list_tolerates_invalid_json() {
        assert_eq!(
            parse_json_string_list("[\"a\",\"b\"]"),
            vec!["a".to_string(), "b".to_string()]
        );
        assert!(parse_json_string_list("not json").is_empty());
        assert!(parse_json_string_list("{\"a\":1}").is_empty());
        assert!(parse_json_string_list("").is_empty());
    }

    #[test]
    fn enabled_tools_json_roundtrip() {
        let db = Database::memory().expect("memory db");
        let mut s = skill("owner/repo:a", "a");
        s.enabled_tools = vec!["claude-code".to_string(), "codex".to_string()];
        s.tags = vec!["rust".to_string(), "cli".to_string()];
        db.save_skill(&s).expect("save");

        let stored = db.get_skill("owner/repo:a").expect("query").expect("exists");
        assert_eq!(stored.enabled_tools, vec!["claude-code", "codex"]);
        assert_eq!(stored.tags, vec!["rust", "cli"]);

        // 整体替换
        assert!(db
            .update_skill_enabled_tools("owner/repo:a", &["hermes".to_string()])
            .expect("update"));
        let stored = db.get_skill("owner/repo:a").expect("query").expect("exists");
        assert_eq!(stored.enabled_tools, vec!["hermes"]);

        // 缺失 id 返回 false
        assert!(!db
            .update_skill_enabled_tools("ghost", &[])
            .expect("missing id"));
    }

    #[test]
    fn strip_tool_from_all_skills() {
        let db = Database::memory().expect("memory db");
        let mut a = skill("owner/repo:a", "a");
        a.enabled_tools = vec!["claude-code".to_string(), "custom-x".to_string()];
        let mut b = skill("owner/repo:b", "b");
        b.enabled_tools = vec!["custom-x".to_string()];
        let c = skill("owner/repo:c", "c");
        db.save_skill(&a).expect("save a");
        db.save_skill(&b).expect("save b");
        db.save_skill(&c).expect("save c");

        let changed = db.strip_tool_from_all_skills("custom-x").expect("strip");
        assert_eq!(changed, 2);
        assert_eq!(
            db.get_skill("owner/repo:a").unwrap().unwrap().enabled_tools,
            vec!["claude-code"]
        );
        assert!(db
            .get_skill("owner/repo:b")
            .unwrap()
            .unwrap()
            .enabled_tools
            .is_empty());
    }

    #[test]
    fn update_skill_metadata_preserves_enabled_tools_and_skips_missing() {
        let db = Database::memory().expect("memory db");
        let mut s = skill("owner/repo:a", "a");
        s.enabled_tools = vec!["codex".to_string()];
        db.save_skill(&s).expect("save");

        let mut updated = s.clone();
        updated.display_name = "新名字".to_string();
        updated.enabled_tools = vec![]; // 不应生效
        updated.has_update = true;
        updated.latest_commit = Some("fff0000".to_string());
        assert!(db.update_skill_metadata(&updated).expect("update"));

        let stored = db.get_skill("owner/repo:a").unwrap().unwrap();
        assert_eq!(stored.display_name, "新名字");
        assert_eq!(stored.enabled_tools, vec!["codex"]);
        assert!(stored.has_update);
        assert_eq!(stored.latest_commit.as_deref(), Some("fff0000"));

        let ghost = skill("owner/repo:ghost", "ghost");
        assert!(!db.update_skill_metadata(&ghost).expect("no insert"));
        assert!(db.get_skill("owner/repo:ghost").unwrap().is_none());
    }

    #[test]
    fn builtin_tools_seeded_once() {
        let db = Database::memory().expect("memory db");
        let tools = db.list_tool_adapters().expect("list");
        assert_eq!(tools.len(), 6);
        assert!(tools.iter().all(|t| t.is_builtin));
        assert_eq!(tools[0].id, "claude-code");
        assert_eq!(tools[0].default_path, "~/.claude/skills");

        // 自定义工具删除保护：内置行不可删
        assert!(!db.delete_tool_adapter("claude-code").expect("builtin protected"));
    }
}
