//! 数据库模块 - SQLite 持久化（rusqlite bundled）
//!
//! 从零建表（无历史迁移包袱）：
//! - `skills`         技能记录（字段对齐前端 Skill 接口）
//! - `tool_adapters`  工具适配器（动态表驱动，替代硬编码枚举）
//! - `skill_projects` 项目作用域
//! - `skill_repos`    技能仓库源
//! - `settings`       键值设置

mod skills_dao;

use crate::config;
use crate::error::AppError;
use crate::types::ToolAdapter;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::Mutex;

/// 安全地序列化 JSON
pub(crate) fn to_json_string<T: Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_string(value)
        .map_err(|e| AppError::Config(format!("JSON serialization failed: {e}")))
}

macro_rules! lock_conn {
    ($mutex:expr) => {
        $mutex
            .lock()
            .map_err(|e| AppError::Database(format!("Mutex lock failed: {}", e)))?
    };
}

pub(crate) use lock_conn;

/// 数据库连接封装（Mutex 包装以支持 Tauri State 共享）
pub struct Database {
    pub(crate) conn: Mutex<Connection>,
}

/// 内置工具适配器种子（对齐前端 initialData.ts 的 7 个内置工具）
struct BuiltinToolSeed {
    id: &'static str,
    name: &'static str,
    vendor: &'static str,
    description: &'static str,
    default_path: &'static str,
    color: &'static str,
}

const BUILTIN_TOOLS: &[BuiltinToolSeed] = &[
    BuiltinToolSeed {
        id: "claude-code",
        name: "Claude Code",
        vendor: "Anthropic",
        description: "Anthropic 官方终端智能体，支持读取项目上下文与自动化工作流",
        default_path: "~/.claude/skills",
        color: "#D97757",
    },
    BuiltinToolSeed {
        id: "codex",
        name: "OpenAI Codex",
        vendor: "OpenAI",
        description: "OpenAI 编程辅助 CLI 与开发工作区技能引擎",
        default_path: "~/.codex/skills",
        color: "#10A37F",
    },
    BuiltinToolSeed {
        id: "antigravity-cli",
        name: "Antigravity CLI",
        vendor: "Google",
        description: "Google 官方新一代 AI 智能体终端开发平台与多智能体工作流引擎",
        default_path: "~/.gemini/config/skills",
        color: "#4285F4",
    },
    BuiltinToolSeed {
        id: "opencode",
        name: "OpenCode",
        vendor: "OpenCode",
        description: "开源本地代码智能体套件，与多模型路由无缝对接",
        default_path: "~/.opencode/skills",
        color: "#0284C7",
    },
    BuiltinToolSeed {
        id: "openclaw",
        name: "OpenClaw",
        vendor: "OpenClaw",
        description: "开源自主多平台 AI 智能体，支持 Telegram/Discord 本地自动化与工作流",
        default_path: "~/.openclaw/skills",
        color: "#E11D48",
    },
    BuiltinToolSeed {
        id: "hermes",
        name: "Hermes Agent",
        vendor: "Nous Research",
        description: "Nous Research 自主进化智能体，具备持久记忆与自主技能生成",
        default_path: "~/.hermes/skills",
        color: "#7C3AED",
    },
];

impl Database {
    /// 初始化数据库（默认路径 `~/.skilldock/skilldock.db`）
    pub fn init() -> Result<Self, AppError> {
        Self::init_at(&config::get_db_path())
    }

    /// 在指定路径初始化数据库
    pub fn init_at(db_path: &std::path::Path) -> Result<Self, AppError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
        }
        let conn = Connection::open(db_path).map_err(|e| AppError::Database(e.to_string()))?;
        Self::wrap(conn)
    }

    /// 创建内存数据库（用于测试）
    pub fn memory() -> Result<Self, AppError> {
        let conn =
            Connection::open_in_memory().map_err(|e| AppError::Database(e.to_string()))?;
        Self::wrap(conn)
    }

    fn wrap(conn: Connection) -> Result<Self, AppError> {
        conn.execute("PRAGMA foreign_keys = ON;", [])
            .map_err(|e| AppError::Database(e.to_string()))?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.create_tables()?;
        db.seed_builtin_tools()?;
        db.init_default_skill_repos()?;
        db.reconcile_builtin_tools()?;
        Ok(db)
    }

    fn create_tables(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);

        conn.execute(
            "CREATE TABLE IF NOT EXISTS skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT NOT NULL DEFAULT '',
                description TEXT,
                directory TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                scope TEXT NOT NULL DEFAULT 'global',
                project_id TEXT,
                project_path TEXT,
                source_type TEXT NOT NULL DEFAULT 'local',
                source_repo TEXT,
                source_branch TEXT,
                source_subpath TEXT,
                source_author TEXT,
                source_registry_id TEXT,
                source_url TEXT,
                source_github_detected INTEGER NOT NULL DEFAULT 0,
                current_commit TEXT,
                latest_commit TEXT,
                has_update INTEGER NOT NULL DEFAULT 0,
                content_hash TEXT,
                enabled_tools TEXT NOT NULL DEFAULT '[]',
                deploy_method TEXT NOT NULL DEFAULT 'auto',
                installed_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0,
                author TEXT,
                license TEXT
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tool_adapters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                vendor TEXT NOT NULL DEFAULT 'Custom',
                description TEXT NOT NULL DEFAULT '',
                default_path TEXT NOT NULL,
                current_path TEXT NOT NULL,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                is_enabled INTEGER NOT NULL DEFAULT 1,
                color TEXT NOT NULL DEFAULT '#4F46E5',
                sort_order INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS skill_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS skill_repos (
                owner TEXT NOT NULL,
                name TEXT NOT NULL,
                branch TEXT NOT NULL DEFAULT 'main',
                enabled INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (owner, name)
            )",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(())
    }

    /// 内置工具技能目录是否已检测到（与 SkillService::api_tools 的 detected 语义一致）
    fn tool_path_detected(path: &str) -> bool {
        config::expand_tilde(path).is_dir()
    }

    /// 首次启动写入内置工具种子（仅当表为空）；未检测到目录的工具默认停用
    fn seed_builtin_tools(&self) -> Result<usize, AppError> {
        if !self.list_tool_adapters()?.is_empty() {
            return Ok(0);
        }
        let conn = lock_conn!(self.conn);
        let mut count = 0;
        for (index, tool) in BUILTIN_TOOLS.iter().enumerate() {
            let enabled = Self::tool_path_detected(tool.default_path);
            conn.execute(
                "INSERT OR IGNORE INTO tool_adapters
                 (id, name, vendor, description, default_path, current_path, is_builtin, is_enabled, color, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1, ?6, ?7, ?8)",
                params![
                    tool.id,
                    tool.name,
                    tool.vendor,
                    tool.description,
                    tool.default_path,
                    enabled as i64,
                    tool.color,
                    index as i64
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
            count += 1;
        }
        Ok(count)
    }

    /// 一次性校正存量库：移除已下线的内置工具（gemini-cli）；
    /// 未检测到技能目录的内置工具置为停用（用户手动启用过的检测到工具不受影响）
    fn reconcile_builtin_tools(&self) -> Result<(), AppError> {
        if self.get_setting("tools_reconcile_v2")?.as_deref() == Some("done") {
            return Ok(());
        }
        {
            let conn = lock_conn!(self.conn);
            conn.execute(
                "DELETE FROM tool_adapters WHERE id = 'gemini-cli' AND is_builtin = 1",
                [],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        for tool in self.list_tool_adapters()? {
            if tool.is_builtin && tool.is_enabled && !Self::tool_path_detected(&tool.current_path)
            {
                self.set_tool_enabled(&tool.id, false)?;
            }
        }
        self.set_setting("tools_reconcile_v2", "done")?;
        Ok(())
    }

    /// 初始化默认技能仓库（仅当表为空）
    pub fn init_default_skill_repos(&self) -> Result<usize, AppError> {
        if !self.get_skill_repos()?.is_empty() {
            return Ok(0);
        }
        let mut count = 0;
        for repo in crate::types::SkillRepo::defaults() {
            self.save_skill_repo(&repo)?;
            count += 1;
        }
        Ok(count)
    }

    // ========== settings kv ==========

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    // ========== tool_adapters CRUD ==========

    pub fn list_tool_adapters(&self) -> Result<Vec<ToolAdapter>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, name, vendor, description, default_path, current_path,
                        is_builtin, is_enabled, color
                 FROM tool_adapters ORDER BY sort_order ASC, rowid ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ToolAdapter {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    vendor: row.get(2)?,
                    description: row.get(3)?,
                    default_path: row.get(4)?,
                    current_path: row.get(5)?,
                    is_builtin: row.get::<_, i64>(6)? != 0,
                    is_enabled: row.get::<_, i64>(7)? != 0,
                    installed_skills_count: 0,
                    detected: false,
                    version: None,
                    color: row.get(8)?,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut tools = Vec::new();
        for row in rows {
            tools.push(row.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(tools)
    }

    pub fn get_tool_adapter(&self, id: &str) -> Result<Option<ToolAdapter>, AppError> {
        Ok(self
            .list_tool_adapters()?
            .into_iter()
            .find(|tool| tool.id == id))
    }

    pub fn insert_tool_adapter(&self, tool: &ToolAdapter, sort_order: i64) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT INTO tool_adapters
             (id, name, vendor, description, default_path, current_path, is_builtin, is_enabled, color, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                tool.id,
                tool.name,
                tool.vendor,
                tool.description,
                tool.default_path,
                tool.current_path,
                tool.is_builtin as i64,
                tool.is_enabled as i64,
                tool.color,
                sort_order
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_tool_adapter(&self, tool: &ToolAdapter) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE tool_adapters SET name = ?1, vendor = ?2, description = ?3,
                 current_path = ?4, is_enabled = ?5, color = ?6 WHERE id = ?7",
                params![
                    tool.name,
                    tool.vendor,
                    tool.description,
                    tool.current_path,
                    tool.is_enabled as i64,
                    tool.color,
                    tool.id
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    pub fn set_tool_enabled(&self, id: &str, enabled: bool) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "UPDATE tool_adapters SET is_enabled = ?1 WHERE id = ?2",
                params![enabled as i64, id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    pub fn delete_tool_adapter(&self, id: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute(
                "DELETE FROM tool_adapters WHERE id = ?1 AND is_builtin = 0",
                params![id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    // ========== skill_repos CRUD ==========

    pub fn get_skill_repos(&self) -> Result<Vec<crate::types::SkillRepo>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT owner, name, branch, enabled FROM skill_repos ORDER BY owner ASC, name ASC",
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(crate::types::SkillRepo {
                    owner: row.get(0)?,
                    name: row.get(1)?,
                    branch: row.get(2)?,
                    enabled: row.get::<_, i64>(3)? != 0,
                })
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut repos = Vec::new();
        for row in rows {
            repos.push(row.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(repos)
    }

    pub fn save_skill_repo(&self, repo: &crate::types::SkillRepo) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO skill_repos (owner, name, branch, enabled) VALUES (?1, ?2, ?3, ?4)",
            params![repo.owner, repo.name, repo.branch, repo.enabled as i64],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_skill_repo(&self, owner: &str, name: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM skill_repos WHERE owner = ?1 AND name = ?2",
            params![owner, name],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    // ========== skill_projects CRUD ==========

    /// 返回 (id, name, path, created_at)
    pub fn list_skill_projects(&self) -> Result<Vec<(i64, String, String, i64)>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id, name, path, created_at FROM skill_projects ORDER BY created_at ASC, id ASC")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut projects = Vec::new();
        for row in rows {
            projects.push(row.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(projects)
    }

    pub fn add_skill_project(&self, name: &str, path: &str) -> Result<i64, AppError> {
        let conn = lock_conn!(self.conn);
        let created_at = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO skill_projects (name, path, created_at) VALUES (?1, ?2, ?3)",
            params![name, path, created_at],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_skill_project(&self, id: i64) -> Result<Option<(i64, String, String, i64)>, AppError> {
        Ok(self
            .list_skill_projects()?
            .into_iter()
            .find(|project| project.0 == id))
    }

    pub fn remove_skill_project(&self, id: i64) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let affected = conn
            .execute("DELETE FROM skill_projects WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(affected > 0)
    }

    pub fn count_skills_by_project_path(&self, path: &str) -> Result<i64, AppError> {
        let conn = lock_conn!(self.conn);
        let count = conn
            .query_row(
                "SELECT COUNT(*) FROM skills WHERE scope = 'project' AND project_path = ?1",
                params![path],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(count)
    }
}
