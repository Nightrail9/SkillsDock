//! 技能坞 SkillDock — Tauri v2 后端

pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod services;
pub mod types;

use std::sync::Arc;

/// 全局应用状态（数据库句柄）
pub struct AppState {
    pub db: Arc<db::Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // panic 不再静默退出：写日志 + stderr（windows_subsystem 下 stderr 可能被丢弃，日志兜底）
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("应用发生 panic: {info}");
        log::error!("{msg}");
        eprintln!("{msg}");
    }));

    let db = db::Database::init().unwrap_or_else(|e| panic!("初始化数据库失败: {e}"));

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { db: Arc::new(db) })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::complete_onboarding,
            commands::get_skill_detail,
            commands::search_skills_sh,
            commands::backfill_skill_sources,
            commands::install_skill_unified,
            commands::create_share_link,
            commands::parse_share_link,
            commands::toggle_skill_tool,
            commands::set_skill_tags,
            commands::uninstall_skill,
            commands::check_skill_updates,
            commands::update_skill,
            commands::validate_tool_path,
            commands::add_tool_adapter,
            commands::update_tool_adapter,
            commands::delete_tool_adapter,
            commands::toggle_tool_enabled,
            commands::get_skill_projects,
            commands::add_skill_project,
            commands::remove_skill_project,
            commands::check_project_paths,
            commands::add_skill_repo,
            commands::get_settings,
            commands::update_settings,
            commands::migrate_library,
            commands::scan_unmanaged_skills,
            commands::import_skills_from_apps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running skilldock application");
}
