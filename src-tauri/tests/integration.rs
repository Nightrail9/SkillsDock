//! 端到端集成测试：种子 → 本地导入 → 分发 → 移除分发 → 卸载无残留
//!
//! 单测试串行跑全流程，避免 SKILLDOCK_TEST_HOME 环境变量竞争。

use std::fs;
use std::sync::Arc;

use serial_test::serial;
use skilldock_lib::db::Database;
use skilldock_lib::services::skill_service::SkillService;
use skilldock_lib::types::{SkillRepo, SKILL_SCOPE_PROJECT};

#[tokio::test]
#[serial]
async fn full_skill_lifecycle() {
    let home = tempfile::tempdir().expect("temp home");
    std::env::set_var("SKILLDOCK_TEST_HOME", home.path());

    let db_path = home.path().join(".skilldock").join("skilldock.db");
    let db = Arc::new(Database::init_at(&db_path).expect("init db"));

    // ---- 种子：6 个内置工具（未检测到目录，默认停用）+ 4 个默认仓库 ----
    let tools = db.list_tool_adapters().expect("list tools");
    assert_eq!(tools.len(), 6, "内置工具种子");
    assert!(tools.iter().all(|t| t.is_builtin));
    assert!(
        tools.iter().all(|t| !t.is_enabled),
        "测试 home 下无工具目录，内置工具应默认停用"
    );
    assert!(
        !tools.iter().any(|t| t.id == "gemini-cli"),
        "gemini-cli 已下线"
    );
    let repos = db.get_skill_repos().expect("list repos");
    assert_eq!(repos.len(), 4, "默认仓库种子");
    assert!(repos
        .iter()
        .any(|r| r.owner == "anthropics" && r.name == "skills"));

    // ---- 造一个本地技能目录 ----
    let external = home.path().join("external/my-skill");
    fs::create_dir_all(&external).unwrap();
    fs::write(
        external.join("SKILL.md"),
        "---\nname: my-skill\ndescription: 测试技能\n---\n\n# My Skill\n",
    )
    .unwrap();
    fs::write(external.join("helper.txt"), "helper").unwrap();

    // ---- 导入到中央库 ----
    let record = SkillService::import_local(&db, external.to_str().unwrap(), vec![], None, None, None)
        .await
        .expect("import_local");
    assert_eq!(record.id, "local:my-skill");
    assert_eq!(record.name, "my-skill");
    assert_eq!(record.directory, "my-skill");
    assert!(!record.source_github_detected);

    let library = SkillService::get_library_dir(&db).expect("library dir");
    let stored = library.join("my-skill");
    assert!(stored.join("SKILL.md").is_file(), "技能已入库");
    assert!(stored.join("helper.txt").is_file());

    // ---- 分发到一个临时工具目录 ----
    let tool_root = home.path().join("tool-skills");
    let tool = skilldock_lib::types::ToolAdapter {
        id: "custom-test".to_string(),
        name: "Test Tool".to_string(),
        vendor: "Custom".to_string(),
        description: String::new(),
        default_path: tool_root.display().to_string(),
        current_path: tool_root.display().to_string(),
        is_builtin: false,
        is_enabled: true,
        installed_skills_count: 0,
        detected: true,
        version: None,
        color: "#4F46E5".to_string(),
    };
    db.insert_tool_adapter(&tool, 100).expect("insert tool");

    SkillService::toggle_tool(&db, &record.id, "custom-test", true).expect("deploy");
    let deployed = tool_root.join("my-skill");
    assert!(
        deployed.join("SKILL.md").is_file(),
        "分发落盘（symlink 或 copy 均可；Windows 无开发者模式时 symlink 失败会回退 copy）"
    );
    let stored_record = db.get_skill(&record.id).unwrap().unwrap();
    assert_eq!(stored_record.enabled_tools, vec!["custom-test"]);

    // ---- scan_unmanaged 不应列出受管目录 ----
    let unmanaged = SkillService::scan_unmanaged(&db).expect("scan");
    assert!(!unmanaged.iter().any(|s| s.directory == "my-skill"));

    // ---- 详情视图 ----
    let detail = SkillService::get_skill_detail(&db, &record.id).expect("detail");
    assert!(detail.documentation.contains("My Skill"));
    assert!(detail.files.iter().any(|f| f.name == "SKILL.md"));
    assert_eq!(detail.deployed_tools.get("custom-test"), Some(&true));

    // ---- 移除分发 ----
    SkillService::toggle_tool(&db, &record.id, "custom-test", false).expect("undeploy");
    assert!(
        !deployed.exists() && !SkillService::is_symlink(&deployed),
        "分发已移除"
    );

    // ---- 卸载无残留 ----
    SkillService::uninstall(&db, &record.id).expect("uninstall");
    assert!(db.get_skill(&record.id).unwrap().is_none(), "DB 行已删");
    assert!(!stored.exists(), "中央库目录已删");

    // ---- 标签接口 ----
    let record2 = SkillService::import_local(&db, external.to_str().unwrap(), vec![], None, None, None)
        .await
        .expect("re-import");
    let updated =
        SkillService::set_skill_tags(&db, vec![record2.id.clone()], vec![" cli ".to_string(), "cli".to_string(), "".to_string()])
            .expect("set tags");
    assert_eq!(updated, 1);
    assert_eq!(
        db.get_skill(&record2.id).unwrap().unwrap().tags,
        vec!["cli"]
    );

    // 清理环境变量，避免影响同进程其他测试
    std::env::remove_var("SKILLDOCK_TEST_HOME");
}

#[test]
fn skill_repo_defaults_are_valid_coordinates() {
    for repo in SkillRepo::defaults() {
        SkillService::validate_repo_ref(&repo.owner, &repo.name, &repo.branch)
            .expect("种子仓库坐标必须合法");
    }
}

fn build_test_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    for (name, content) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(content).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// ZIP 安装到项目作用域：原技能入中央库 projects 命名空间，按工具项目内目录分发，
/// skills 表 scope/project_id/project_path 正确；卸载后无残留
#[tokio::test]
#[serial]
async fn zip_install_to_project_scope_and_uninstall() {
    let home = tempfile::tempdir().expect("temp home");
    std::env::set_var("SKILLDOCK_TEST_HOME", home.path());

    let db_path = home.path().join(".skilldock").join("skilldock.db");
    let db = Arc::new(Database::init_at(&db_path).expect("init db"));

    // 注册项目
    let proj = home.path().join("proj");
    fs::create_dir_all(&proj).unwrap();
    let project_key = proj.to_string_lossy().to_string();
    let project_id = db
        .add_skill_project("proj", &project_key)
        .expect("add project");

    // 配一个项目内技能目录为 .claude/skills 的工具（模拟 Claude Code）
    let tool = skilldock_lib::types::ToolAdapter {
        id: "proj-tool".to_string(),
        name: "Project Tool".to_string(),
        vendor: "Custom".to_string(),
        description: String::new(),
        // 本地目录在 home 下：项目内目录由去掉 home 根推导（.claude/skills）
        default_path: home.path().join(".claude/skills").display().to_string(),
        current_path: home.path().join(".claude/skills").display().to_string(),
        is_builtin: false,
        is_enabled: true,
        installed_skills_count: 0,
        detected: true,
        version: None,
        color: "#4F46E5".to_string(),
    };
    db.insert_tool_adapter(&tool, 100).expect("insert tool");

    // 造 ZIP：cool-skill/SKILL.md + 辅助文件
    let zip_bytes = build_test_zip(&[
        (
            "cool-skill/SKILL.md",
            "---\nname: cool-skill\ndescription: 项目级技能\n---\n\n# Cool\n".as_bytes(),
        ),
        ("cool-skill/helper.txt", "helper".as_bytes()),
    ]);
    let zip_path = home.path().join("cool.zip");
    fs::write(&zip_path, zip_bytes).unwrap();

    // ---- 安装到项目作用域（选中 proj-tool） ----
    let records = SkillService::install_from_zip(
        &db,
        &zip_path,
        vec!["proj-tool".to_string()],
        None,
        Some(SKILL_SCOPE_PROJECT),
        Some(&project_id.to_string()),
    )
    .expect("install_from_zip to project");
    assert_eq!(records.len(), 1, "返回 1 条安装记录");
    let record = &records[0];
    assert_eq!(record.scope, SKILL_SCOPE_PROJECT);
    assert_eq!(record.project_id, Some(project_id.to_string()));
    assert_eq!(record.project_path.as_deref(), Some(project_key.as_str()));
    assert_eq!(record.directory, "cool-skill");
    assert_eq!(record.enabled_tools, vec!["proj-tool".to_string()]);

    // 原技能入中央库 projects 命名空间
    let library = SkillService::get_library_dir(&db).expect("library dir");
    let projects_ns = library.join("projects");
    let stored = fs::read_dir(&projects_ns)
        .expect("projects namespace exists")
        .flatten()
        .map(|e| e.path().join("cool-skill"))
        .find(|p| p.join("SKILL.md").is_file())
        .expect("中央库 projects 命名空间中存在原技能");
    assert!(stored.join("helper.txt").is_file());

    // 按工具项目内目录分发（symlink 或 copy 均可）
    let deployed = proj.join(".claude").join("skills").join("cool-skill");
    assert!(
        deployed.exists() || SkillService::is_symlink(&deployed),
        "已分发到工具项目内目录"
    );

    // 新模型不再创建写死的 <project>/skills 链接
    let legacy_linked = proj.join("skills").join("cool-skill");
    assert!(
        !legacy_linked.exists() && !SkillService::is_symlink(&legacy_linked),
        "新模型不创建 skills/ 链接"
    );

    // DB 行 scope/project_path 正确
    let stored_record = db.get_skill(&record.id).unwrap().expect("db row");
    assert_eq!(stored_record.scope, SKILL_SCOPE_PROJECT);
    assert_eq!(
        stored_record.project_path.as_deref(),
        Some(project_key.as_str())
    );

    // ---- 卸载后项目目录无残留 ----
    SkillService::uninstall(&db, &record.id).expect("uninstall");
    assert!(db.get_skill(&record.id).unwrap().is_none(), "DB 行已删");
    assert!(!stored.exists(), "中央库原文件已删");
    assert!(
        !deployed.exists() && !SkillService::is_symlink(&deployed),
        "工具项目内分发已删"
    );

    std::env::remove_var("SKILLDOCK_TEST_HOME");
}
