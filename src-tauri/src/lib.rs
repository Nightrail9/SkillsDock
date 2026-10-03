//! SkillDock Tauri v2 后端

pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod services;
pub mod types;

use std::sync::Arc;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

/// 全局应用状态（数据库句柄）
pub struct AppState {
    pub db: Arc<db::Database>,
}

/// Reports whether this process is running from the portable ZIP distribution.
#[tauri::command]
fn is_portable_install() -> Result<bool, String> {
    let executable =
        std::env::current_exe().map_err(|error| format!("无法获取应用程序路径: {error}"))?;
    let directory = executable
        .parent()
        .ok_or_else(|| "应用程序路径没有父目录".to_owned())?;

    Ok(directory.join("skilldock-portable.flag").is_file())
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState { db: Arc::new(db) })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_state,
            commands::complete_onboarding,
            commands::get_skill_detail,
            commands::search_skills_sh,
            commands::backfill_skill_sources,
            commands::install_skill_unified,
            commands::probe_repo_skills,
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
            commands::assign_skill_to_projects,
            commands::schedule_skill_to_projects,
            commands::schedule_skill_globally,
            commands::scan_project_unmanaged_skills,
            commands::import_project_skills,
            commands::remove_skill_project,
            commands::check_project_paths,
            commands::add_skill_repo,
            commands::get_settings,
            commands::update_settings,
            commands::get_llm_config,
            commands::save_llm_config,
            commands::test_llm_connection,
            commands::process_skill_descriptions,
            commands::redeploy_project_links,
            commands::migrate_library,
            commands::scan_unmanaged_skills,
            commands::import_skills_from_apps,
            commands::restart_as_admin,
            is_portable_install,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Show SkillDock", true, None::<&str>)?;
            let exit_item = MenuItem::with_id(app, "exit", "Exit SkillDock", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &exit_item])?;
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("SkillDock")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "exit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            // 存量项目级技能存储布局迁移（原文件入中央库命名空间）。
            // 放在 setup 中：日志插件已就绪，迁移日志可落盘；best-effort 不阻塞启动
            let state = tauri::Manager::state::<AppState>(app.handle());
            if let Err(e) =
                services::skill_service::SkillService::migrate_project_storage_layout(&state.db)
            {
                log::error!("项目级技能存储布局迁移失败: {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let should_hide = match window.state::<AppState>().db.get_setting("close_to_tray") {
                    Ok(value) => value.as_deref() != Some("false"),
                    Err(error) => {
                        log::error!("读取关闭到托盘设置失败，按默认开启处理: {error}");
                        true
                    }
                };
                if should_hide {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        log::error!("关闭窗口时隐藏到系统托盘失败: {error}");
                    }
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running skilldock application");
}

/// 显示并聚焦主窗口，供托盘菜单和图标点击复用。
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.unminimize() {
            log::error!("还原 SkillDock 主窗口失败: {error}");
        }
        if let Err(error) = window.show() {
            log::error!("显示 SkillDock 主窗口失败: {error}");
        }
        if let Err(error) = window.set_focus() {
            log::error!("聚焦 SkillDock 主窗口失败: {error}");
        }
    }
}
