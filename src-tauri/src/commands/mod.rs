//! Tauri 命令层：30 个 IPC 命令
//!
//! 参数一律 camelCase（Tauri 自动转换），错误一律 `map_err(|e| e.to_string())`，
//! 结构化错误以 JSON 字符串（format_skill_error）或约定前缀透传给前端。

use std::collections::HashSet;

use tauri::State;

use crate::config;
use crate::services::share::SharePayload;
use crate::services::skill_service::{self, SkillService};
use crate::services::{registry, share};
use crate::types::{
    AppSettings, AppStateSnapshot, ImportSkillSelection, InstallSkillInput, MigrationResult, ProjectPathStatus, ProjectScope, Skill, SkillRepo, SkillUpdateInfo,
    SkillsShSearchResult, ToolAdapter, ToolAdapterInput, ToolPathValidation, UnmanagedSkill,
};
use crate::AppState;

type CmdResult<T> = Result<T, String>;

fn now_iso() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ========== 首屏状态 / 详情 / 发现 ==========

#[tauri::command]
pub fn get_app_state(state: State<'_, AppState>) -> CmdResult<AppStateSnapshot> {
    let db = &state.db;
    Ok(AppStateSnapshot {
        skills: SkillService::list_api_skills(db).map_err(|e| e.to_string())?,
        tools: SkillService::api_tools(db).map_err(|e| e.to_string())?,
        projects: SkillService::api_projects(db).map_err(|e| e.to_string())?,
        settings: SkillService::get_settings(db).map_err(|e| e.to_string())?,
        repos: db.get_skill_repos().map_err(|e| e.to_string())?,
        onboarding_completed: db
            .get_setting("onboarding_completed")
            .map_err(|e| e.to_string())?
            .as_deref()
            == Some("true"),
        home_dir: crate::config::get_home_dir()
            .to_string_lossy()
            .replace('\\', "/"),
    })
}

/// 新手指引完成/跳过后置标记，之后启动不再自动弹出
#[tauri::command]
pub fn complete_onboarding(state: State<'_, AppState>) -> CmdResult<()> {
    state
        .db
        .set_setting("onboarding_completed", "true")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_skill_detail(state: State<'_, AppState>, id: String) -> CmdResult<Skill> {
    SkillService::get_skill_detail(&state.db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_skills_sh(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> CmdResult<SkillsShSearchResult> {
    let records = state.db.get_all_skills().map_err(|e| e.to_string())?;
    // 精确匹配键：有来源的技能按 "repo:directory"（小写）或 registry id 匹配；
    // 纯本地技能不产出键，避免同名不同源的社区技能被误标"已安装"。
    let mut installed_keys: HashSet<String> = HashSet::new();
    for s in records.values() {
        if let Some(repo) = &s.source_repo {
            installed_keys.insert(format!("{repo}:{}", s.directory).to_lowercase());
        }
        if let Some(registry_id) = &s.source_registry_id {
            installed_keys.insert(registry_id.clone());
        }
    }
    registry::search_skills_sh(
        &query,
        limit.unwrap_or(20),
        offset.unwrap_or(0),
        &installed_keys,
    )
    .await
    .map_err(|e| e.to_string())
}

// ========== 安装 / 卸载 / 更新 ==========

/// 回填无来源技能的 skills.sh 注册表来源（联网，逐条精确匹配；失败保持纯本地）。
/// 返回成功回填的技能数量。
#[tauri::command]
pub async fn backfill_skill_sources(state: State<'_, AppState>) -> CmdResult<usize> {
    SkillService::backfill_skill_sources(&state.db)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_skill_unified(
    state: State<'_, AppState>,
    skill: InstallSkillInput,
    scope: String,
    project_id: Option<String>,
    tool_ids: Vec<String>,
    deploy_method: Option<String>,
) -> CmdResult<Skill> {
    let record = SkillService::install_unified(
        &state.db,
        skill,
        &scope,
        project_id.as_deref(),
        tool_ids,
        deploy_method.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    let tools = state.db.list_tool_adapters().map_err(|e| e.to_string())?;
    let projects = state.db.list_skill_projects().map_err(|e| e.to_string())?;
    Ok(SkillService::record_to_skill(
        &state.db, &record, &tools, &projects, false,
    ))
}

// ========== 分享 ==========

#[tauri::command]
pub fn create_share_link(state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<String> {
    let skills = state.db.get_all_skills().map_err(|e| e.to_string())?;
    let records: Vec<_> = ids
        .iter()
        .filter_map(|id| skills.get(id).cloned())
        .collect();
    if records.is_empty() {
        return Err("未找到要分享的技能".to_string());
    }
    share::create_share_link(&records).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn parse_share_link(url: String) -> CmdResult<SharePayload> {
    share::parse_share_link(&url).map_err(|e| e.to_string())
}

// ========== 分发开关 / 标签 ==========

#[tauri::command]
pub fn toggle_skill_tool(
    state: State<'_, AppState>,
    id: String,
    tool_id: String,
    enabled: bool,
) -> CmdResult<()> {
    SkillService::toggle_tool(&state.db, &id, &tool_id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_skill_tags(
    state: State<'_, AppState>,
    ids: Vec<String>,
    tags: Vec<String>,
) -> CmdResult<usize> {
    SkillService::set_skill_tags(&state.db, ids, tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn uninstall_skill(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    SkillService::uninstall(&state.db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_skill_updates(
    state: State<'_, AppState>,
) -> CmdResult<Vec<SkillUpdateInfo>> {
    let updates = SkillService::check_updates(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    // 记录上次成功检测时间，供启动时按间隔决定是否自动检测
    let _ = state.db.set_setting(
        "last_update_check_at",
        &chrono::Utc::now().timestamp().to_string(),
    );
    Ok(updates)
}

#[tauri::command]
pub async fn update_skill(state: State<'_, AppState>, id: String) -> CmdResult<Skill> {
    let record = SkillService::update_skill(&state.db, &id)
        .await
        .map_err(|e| e.to_string())?;
    let tools = state.db.list_tool_adapters().map_err(|e| e.to_string())?;
    let projects = state.db.list_skill_projects().map_err(|e| e.to_string())?;
    Ok(SkillService::record_to_skill(
        &state.db, &record, &tools, &projects, false,
    ))
}

// ========== 工具适配器管理 ==========

/// 校验工具路径：存在须为目录且可写；不存在则找最近存在祖先测可写
#[tauri::command]
pub fn validate_tool_path(path: String) -> CmdResult<ToolPathValidation> {
    Ok(validate_path_inner(&path))
}

fn validate_path_inner(raw: &str) -> ToolPathValidation {
    let invalid = |message: &str| ToolPathValidation {
        valid: false,
        exists: false,
        writable: false,
        message: Some(message.to_string()),
    };
    if raw.trim().is_empty() {
        return invalid("路径不能为空");
    }
    let path = config::expand_tilde(raw);
    if path.exists() {
        if !path.is_dir() {
            return ToolPathValidation {
                valid: false,
                exists: true,
                writable: false,
                message: Some("路径已存在但不是目录".to_string()),
            };
        }
        let writable = probe_writable(&path);
        return ToolPathValidation {
            valid: writable,
            exists: true,
            writable,
            message: (!writable).then(|| "目录不可写".to_string()),
        };
    }
    // 不存在：沿祖先找到第一个存在的目录测可写
    let mut ancestor = path.parent();
    while let Some(dir) = ancestor {
        if dir.is_dir() {
            let writable = probe_writable(dir);
            return ToolPathValidation {
                valid: writable,
                exists: false,
                writable,
                message: (!writable).then(|| format!("父目录 {} 不可写", dir.display())),
            };
        }
        ancestor = dir.parent();
    }
    invalid("找不到可写的父目录")
}

fn probe_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(format!(".skilldock-write-probe-{}", std::process::id()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 由名称生成工具 id（slugify + custom- 前缀防撞）
fn slugify_tool_id(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    format!("custom-{}", if slug.is_empty() { "tool" } else { &slug })
}

#[tauri::command]
pub fn add_tool_adapter(
    state: State<'_, AppState>,
    input: ToolAdapterInput,
) -> CmdResult<ToolAdapter> {
    let db = &state.db;
    let id = input
        .id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| slugify_tool_id(&input.name));
    if db.get_tool_adapter(&id).map_err(|e| e.to_string())?.is_some() {
        return Err(format!("工具 id 已存在: {id}"));
    }
    let validation = validate_path_inner(&input.path);
    if !validation.valid {
        return Err(format!(
            "工具路径不可用: {}",
            validation.message.unwrap_or_default()
        ));
    }
    let tool = ToolAdapter {
        id: id.clone(),
        name: input.name.clone(),
        vendor: input.vendor.clone().unwrap_or_else(|| "Custom".to_string()),
        description: input.description.clone().unwrap_or_default(),
        default_path: input.path.clone(),
        current_path: input.path.clone(),
        is_builtin: false,
        is_enabled: input.is_enabled.unwrap_or(true),
        installed_skills_count: 0,
        detected: validation.exists,
        version: None,
        color: input
            .color
            .clone()
            .unwrap_or_else(|| "#4F46E5".to_string()),
    };
    let sort_order = db.list_tool_adapters().map_err(|e| e.to_string())?.len() as i64;
    db.insert_tool_adapter(&tool, sort_order)
        .map_err(|e| e.to_string())?;
    Ok(tool)
}

#[tauri::command]
pub fn update_tool_adapter(
    state: State<'_, AppState>,
    input: ToolAdapterInput,
) -> CmdResult<ToolAdapter> {
    let db = &state.db;
    let id = input
        .id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "更新工具必须提供 id".to_string())?;
    let existing = db
        .get_tool_adapter(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("工具不存在: {id}"))?;
    let validation = validate_path_inner(&input.path);
    if !validation.valid {
        return Err(format!(
            "工具路径不可用: {}",
            validation.message.unwrap_or_default()
        ));
    }
    let tool = ToolAdapter {
        id: id.clone(),
        name: input.name.clone(),
        vendor: input
            .vendor
            .clone()
            .unwrap_or_else(|| existing.vendor.clone()),
        description: input
            .description
            .clone()
            .unwrap_or_else(|| existing.description.clone()),
        default_path: existing.default_path.clone(),
        current_path: input.path.clone(),
        is_builtin: existing.is_builtin,
        is_enabled: input.is_enabled.unwrap_or(existing.is_enabled),
        installed_skills_count: 0,
        detected: validation.exists,
        version: None,
        color: input.color.clone().unwrap_or_else(|| existing.color.clone()),
    };
    if !db.update_tool_adapter(&tool).map_err(|e| e.to_string())? {
        return Err(format!("工具不存在: {id}"));
    }
    Ok(tool)
}

#[tauri::command]
pub fn delete_tool_adapter(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let db = &state.db;
    // 删工具行与剥离各技能 enabled_tools 引用为同一事务，任一步失败整体回滚
    if !db.delete_tool_and_strip(&id).map_err(|e| e.to_string())? {
        return Err(format!("工具不存在或为内置工具，不可删除: {id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_tool_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> CmdResult<()> {
    if !state
        .db
        .set_tool_enabled(&id, enabled)
        .map_err(|e| e.to_string())?
    {
        return Err(format!("工具不存在: {id}"));
    }
    Ok(())
}

// ========== 项目作用域 ==========

#[tauri::command]
pub fn get_skill_projects(state: State<'_, AppState>) -> CmdResult<Vec<ProjectScope>> {
    SkillService::api_projects(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_skill_project(state: State<'_, AppState>, path: String) -> CmdResult<ProjectScope> {
    let db = &state.db;
    // 规范化：必须存在且为目录、canonicalize、去 Windows \\?\ 前缀
    let raw = config::expand_tilde(&path);
    if !raw.is_dir() {
        return Err(format!("项目目录不存在或不是目录: {path}"));
    }
    let canonical = raw
        .canonicalize()
        .map_err(|e| format!("无法解析项目目录: {path}: {e}"))?;
    let normalized = match canonical.to_string_lossy() {
        s if s.starts_with(r"\\?\") => std::path::PathBuf::from(s.trim_start_matches(r"\\?\")),
        _ => canonical,
    };
    let key = normalized.to_string_lossy().to_string();
    if db
        .list_skill_projects()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|p| p.2 == key)
    {
        return Err(format!("项目已注册: {key}"));
    }
    let name = normalized
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| key.clone());
    let id = db.add_skill_project(&name, &key).map_err(|e| e.to_string())?;
    Ok(ProjectScope {
        id: id.to_string(),
        name,
        path: key.clone(),
        skill_count: 0,
        registered_at: now_iso(),
        is_path_valid: true,
    })
}

#[tauri::command]
pub fn remove_skill_project(
    state: State<'_, AppState>,
    id: String,
    cleanup: bool,
) -> CmdResult<()> {
    let db = &state.db;
    let project_id = id
        .parse::<i64>()
        .map_err(|_| format!("无效的项目 id: {id}"))?;
    let project = db
        .get_skill_project(project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("项目不存在: {id}"))?;

    let remaining = db
        .count_skills_by_project_path(&project.2)
        .map_err(|e| e.to_string())?;
    if remaining > 0 {
        if !cleanup {
            return Err(format!(
                "{}{}",
                skill_service::SKILL_PROJECT_NOT_EMPTY_PREFIX,
                project.2
            ));
        }
        // 先卸载该项目下全部技能
        let skills = db.get_all_skills().map_err(|e| e.to_string())?;
        for skill in skills
            .values()
            .filter(|s| s.is_project() && s.project_path.as_deref() == Some(project.2.as_str()))
        {
            SkillService::uninstall(db, &skill.id).map_err(|e| e.to_string())?;
        }
    }

    db.remove_skill_project(project_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn check_project_paths(state: State<'_, AppState>) -> CmdResult<Vec<ProjectPathStatus>> {
    let projects = state.db.list_skill_projects().map_err(|e| e.to_string())?;
    Ok(projects
        .into_iter()
        .map(|(id, _name, path, _created)| ProjectPathStatus {
            id: id.to_string(),
            is_path_valid: std::path::Path::new(&path).is_dir(),
            path,
        })
        .collect())
}

// ========== 仓库源 ==========

#[tauri::command]
pub fn add_skill_repo(state: State<'_, AppState>, repo: SkillRepo) -> CmdResult<()> {
    SkillService::validate_repo_ref(&repo.owner, &repo.name, &repo.branch)
        .map_err(|e| e.to_string())?;
    state.db.save_skill_repo(&repo).map_err(|e| e.to_string())
}

// ========== 设置 / 迁移 / 导入 ==========

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> CmdResult<AppSettings> {
    SkillService::get_settings(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> CmdResult<Vec<String>> {
    SkillService::save_settings(&state.db, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn redeploy_project_links(state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<usize> {
    SkillService::redeploy_project_links(&state.db, &ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn migrate_library(state: State<'_, AppState>, target: String) -> CmdResult<MigrationResult> {
    SkillService::migrate_library(&state.db, &target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scan_unmanaged_skills(state: State<'_, AppState>) -> CmdResult<Vec<UnmanagedSkill>> {
    SkillService::scan_unmanaged(&state.db).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_skills_from_apps(
    state: State<'_, AppState>,
    selections: Vec<ImportSkillSelection>,
) -> CmdResult<Vec<Skill>> {
    let records = SkillService::import_from_apps(&state.db, selections)
        .await
        .map_err(|e| e.to_string())?;
    let tools = state.db.list_tool_adapters().map_err(|e| e.to_string())?;
    let projects = state.db.list_skill_projects().map_err(|e| e.to_string())?;
    Ok(records
        .iter()
        .map(|r| SkillService::record_to_skill(&state.db, r, &tools, &projects, false))
        .collect())
}
