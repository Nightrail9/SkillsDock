//! 前后端契约类型
//!
//! 所有对外序列化结构与前端 `src/types.ts` / `src/data/initialData.ts` 对齐：
//! serde `rename_all = "camelCase"` 之后字段名必须与 TS 接口完全一致。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 技能作用域：全局（中央库管理，分发到各工具目录）
pub const SKILL_SCOPE_GLOBAL: &str = "global";
/// 技能作用域：项目级（文件落在项目目录内）
pub const SKILL_SCOPE_PROJECT: &str = "project";

// ========== 前端契约：Skill 相关 ==========

/// 技能来源（对齐 TS `SkillSource`）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillSource {
    /// 'github' | 'skills_sh' | 'local' | 'url_zip'
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// 例如 "anthropics/skills-kit"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// skills.sh 注册表 id
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registry_id: Option<String>,
    /// 本地导入时从 .git 识别出的 GitHub 来源
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_git_hub_detected_from_local: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

/// 技能文件树节点（对齐 TS `SkillFile`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFile {
    pub name: String,
    pub path: String,
    /// 已格式化的大小，如 "4.8 KB"
    pub size: String,
    /// 'file' | 'dir'
    #[serde(rename = "type")]
    pub file_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SkillFile>>,
}

/// 已安装技能（对齐 TS `Skill`）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub display_name: String,
    /// 中央库内的目录名（skills.sh 来源匹配坐标之一）
    pub directory: String,
    pub description: String,
    pub tags: Vec<String>,
    /// 'global' | 'project'
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    pub source: SkillSource,
    /// 短 SHA，无远端来源时为本地占位符
    pub current_commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_commit: Option<String>,
    pub has_update: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_changelog: Option<String>,
    /// ISO 8601 时间字符串
    pub installed_at: String,
    pub last_updated: String,
    pub author: String,
    pub license: String,
    /// 列表接口给空串，详情接口填 SKILL.md 原文
    pub documentation: String,
    /// 列表接口给空数组，详情接口填文件树
    pub files: Vec<SkillFile>,
    /// toolId -> 是否已分发
    pub deployed_tools: HashMap<String, bool>,
    /// 'symlink' | 'copy'
    pub deploy_method: String,
    pub storage_path: String,
}

// ========== 前端契约：工具适配器 / 项目 / 设置 ==========

/// 工具适配器（对齐 TS `ToolAdapter`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapter {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub description: String,
    pub default_path: String,
    pub current_path: String,
    pub is_builtin: bool,
    /// 该适配器是否在应用内启用
    pub is_enabled: bool,
    #[serde(default)]
    pub installed_skills_count: usize,
    /// 后端实时探测目录是否存在
    #[serde(default)]
    pub detected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub color: String,
}

/// 项目作用域（对齐 TS `ProjectScope`）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScope {
    pub id: String,
    pub name: String,
    pub path: String,
    pub skill_count: usize,
    /// ISO 8601 时间字符串
    pub registered_at: String,
    pub is_path_valid: bool,
}

/// 应用设置（对齐 TS `AppSettings`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// 'symlink' | 'copy'（历史值 auto 读取时归一为 symlink）
    pub distribution_method: String,
    pub library_path: String,
    pub auto_check_update: bool,
    pub check_interval_days: u32,
    /// 上次成功检查更新的 Unix 秒时间戳（0 = 从未检查；只由后端写入）
    #[serde(default)]
    pub last_update_check_at: u64,
    /// Windows 软链接能力探测结果（只读，由后端实测得出）
    #[serde(default)]
    pub developer_mode_enabled: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    pub confirm_on_uninstall: bool,
}

fn default_theme() -> String {
    "light".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            distribution_method: "symlink".to_string(),
            library_path: String::new(),
            auto_check_update: true,
            check_interval_days: 1,
            last_update_check_at: 0,
            developer_mode_enabled: false,
            theme: default_theme(),
            confirm_on_uninstall: true,
        }
    }
}

/// 发现页技能条目（对齐 `initialData.ts` 的 `DiscoverySkillItem`）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverySkillItem {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub author: String,
    /// 'featured' | 'skills_sh' | 'github'
    pub source_type: String,
    #[serde(default)]
    pub stars: u64,
    /// 已格式化的下载量，如 "28.4k"
    #[serde(default)]
    pub downloads: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub latest_commit: String,
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub is_installed: bool,
}

// ========== 内部模型与辅助类型 ==========

/// 技能仓库配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRepo {
    pub owner: String,
    pub name: String,
    pub branch: String,
    pub enabled: bool,
}

impl SkillRepo {
    /// 内置推荐仓库种子（参考 cc-switch `SkillStore::default`）
    pub fn defaults() -> Vec<SkillRepo> {
        vec![
            SkillRepo {
                owner: "anthropics".to_string(),
                name: "skills".to_string(),
                branch: "main".to_string(),
                enabled: true,
            },
            SkillRepo {
                owner: "ComposioHQ".to_string(),
                name: "awesome-claude-skills".to_string(),
                branch: "master".to_string(),
                enabled: true,
            },
            SkillRepo {
                owner: "cexll".to_string(),
                name: "myclaude".to_string(),
                branch: "master".to_string(),
                enabled: true,
            },
            SkillRepo {
                owner: "JimLiu".to_string(),
                name: "baoyu-skills".to_string(),
                branch: "main".to_string(),
                enabled: true,
            },
        ]
    }
}

/// skills 表行（内部模型）
#[derive(Debug, Clone)]
pub struct SkillRecord {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    /// 安装目录名（单段，中央库或项目内的子目录名）
    pub directory: String,
    pub tags: Vec<String>,
    pub scope: String,
    pub project_id: Option<String>,
    pub project_path: Option<String>,
    pub source_type: String,
    pub source_repo: Option<String>,
    pub source_branch: Option<String>,
    pub source_subpath: Option<String>,
    pub source_author: Option<String>,
    pub source_registry_id: Option<String>,
    pub source_url: Option<String>,
    /// 本地导入时是否从 .git 识别出 GitHub 来源
    pub source_github_detected: bool,
    pub current_commit: Option<String>,
    pub latest_commit: Option<String>,
    pub has_update: bool,
    pub content_hash: Option<String>,
    /// 已分发工具 id 列表
    pub enabled_tools: Vec<String>,
    /// 'symlink' | 'copy' | 'auto'
    pub deploy_method: String,
    pub installed_at: i64,
    pub updated_at: i64,
    pub author: Option<String>,
    pub license: Option<String>,
}

impl SkillRecord {
    pub fn is_project(&self) -> bool {
        self.scope == SKILL_SCOPE_PROJECT
    }
}

/// 安装请求（`install_skill_unified` 的 skill 参数，兼容 `DiscoverySkillItem` 形状）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    /// 'featured' | 'skills_sh' | 'github' | 'local' | 'url_zip'
    #[serde(default)]
    pub source_type: Option<String>,
    /// "owner/repo" 或 "owner/repo/sub/path"
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub subpath: Option<String>,
    /// 仓库内目录（优先级高于 subpath）
    #[serde(default)]
    pub directory: Option<String>,
    #[serde(default)]
    pub registry_id: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

/// 更新检测结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUpdateInfo {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_commit: Option<String>,
}

/// 中央库迁移结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated_count: usize,
    pub skipped_count: usize,
    pub errors: Vec<String>,
}

/// skills.sh 搜索结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsShSearchResult {
    pub skills: Vec<DiscoverySkillItem>,
    pub total_count: usize,
    pub query: String,
}

/// 未受管技能（新手引导扫描结果）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmanagedSkill {
    pub directory: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 在哪些工具目录中发现（tool id 列表）
    pub found_in: Vec<String>,
    pub path: String,
}

/// 从工具目录导入的选择项
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillSelection {
    pub directory: String,
    #[serde(default)]
    pub tool_ids: Vec<String>,
}

/// 工具路径校验结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPathValidation {
    pub valid: bool,
    pub exists: bool,
    pub writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 项目路径有效性检查结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathStatus {
    pub id: String,
    pub path: String,
    pub is_path_valid: bool,
}

/// 首屏全量状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSnapshot {
    pub skills: Vec<Skill>,
    pub tools: Vec<ToolAdapter>,
    pub projects: Vec<ProjectScope>,
    pub settings: AppSettings,
    pub repos: Vec<SkillRepo>,
    /// 新手指引是否已完成/跳过（PRD 3.10：首次启动展示引导）
    pub onboarding_completed: bool,
    /// 用户主目录（前端用于把绝对路径折叠为 ~/... 展示）
    pub home_dir: String,
}

/// 工具适配器新增/更新入参
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAdapterInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub vendor: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// 技能目录路径（支持 ~ 开头）
    pub path: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub is_enabled: Option<bool>,
}
