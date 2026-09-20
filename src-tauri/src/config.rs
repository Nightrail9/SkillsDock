//! 路径与环境配置
//!
//! - 数据目录：`~/.skilldock/`（debug 构建可用 `SKILLDOCK_TEST_HOME` 覆盖 home 以便测试隔离）
//! - 数据库：`~/.skilldock/skilldock.db`
//! - 默认中央技能库：`~/.skilldock/skills/`

use std::path::PathBuf;
use std::sync::OnceLock;

use anyhow::{anyhow, Result};

/// 用户主目录。测试可通过 SKILLDOCK_TEST_HOME 覆盖，
/// 避免 Windows 上 dirs::home_dir() 走 Known Folder API 导致测试污染真实目录。
/// 该覆盖**仅在 debug 构建（`debug_assertions`）下生效**：集成测试链接的是
/// 不带 `cfg(test)` 的库代码，故用 debug_assertions 而非 `cfg(test)`；
/// release 构建一律忽略它，防止环境变量把整个数据目录劫持到别处。
/// home 取不到时返回配置错误，绝不再回退 `"."`（进程 CWD，会创建非预期位置的数据库）。
pub fn get_home_dir() -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Ok(test_home) = std::env::var("SKILLDOCK_TEST_HOME") {
        if test_home.trim().is_empty() {
            return Err(anyhow!(
                "SKILLDOCK_TEST_HOME 环境变量为空：测试 home 未正确配置"
            ));
        }
        return Ok(PathBuf::from(test_home));
    }
    dirs::home_dir()
        .ok_or_else(|| anyhow!("无法确定用户主目录：请检查 HOME / USERPROFILE 环境变量"))
}

/// 应用数据目录 `~/.skilldock/`
pub fn get_app_config_dir() -> Result<PathBuf> {
    Ok(get_home_dir()?.join(".skilldock"))
}

/// 数据库文件路径
pub fn get_db_path() -> Result<PathBuf> {
    Ok(get_app_config_dir()?.join("skilldock.db"))
}

/// 默认中央技能库目录
pub fn get_default_library_dir() -> Result<PathBuf> {
    Ok(get_app_config_dir()?.join("skills"))
}

/// 展开路径开头的 `~` / `~/` 为用户主目录
pub fn expand_tilde(path: &str) -> Result<PathBuf> {
    let trimmed = path.trim();
    if trimmed == "~" {
        return get_home_dir();
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        return Ok(get_home_dir()?.join(rest));
    }
    Ok(PathBuf::from(trimmed))
}

/// 将绝对路径尽量压缩回 `~/...` 形式（用于存储与展示）
pub fn collapse_tilde(path: &PathBuf) -> Result<String> {
    let home = get_home_dir()?;
    match path.strip_prefix(&home) {
        Ok(rest) => {
            let rest_str = rest.to_string_lossy().replace('\\', "/");
            if rest_str.is_empty() {
                Ok("~".to_string())
            } else {
                Ok(format!("~/{}", rest_str.trim_start_matches('/')))
            }
        }
        Err(_) => Ok(path.to_string_lossy().to_string()),
    }
}

/// 探测当前环境能否创建目录符号链接（Windows 需要开发者模式或管理员权限）。
/// 结果缓存，整个进程只探测一次。
pub fn developer_mode_enabled() -> bool {
    static RESULT: OnceLock<bool> = OnceLock::new();
    *RESULT.get_or_init(|| {
        let Ok(temp) = tempfile::tempdir() else {
            return false;
        };
        let target = temp.path().join("target");
        if std::fs::create_dir_all(&target).is_err() {
            return false;
        }
        let link = temp.path().join("link");
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(&target, &link).is_ok()
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&target, &link).is_ok()
        }
        #[cfg(not(any(windows, unix)))]
        {
            false
        }
    })
}
