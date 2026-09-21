//! 技能服务核心：安装/卸载/分发/更新/扫描
//!
//! 移植自 cc-switch `services/skill.rs`，裁剪掉 Pi/MCode/Hermes 特殊保护、
//! 备份恢复、云同步防御与旧版兼容 API；卸载即删（无备份）。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use indexmap::IndexMap;

use crate::config;
use crate::db::Database;
use crate::error::format_skill_error;
use crate::services::{git_detect, github};
use crate::types::{
    AppSettings, ImportSkillSelection, InstallSkillInput, MigrationResult,
    ProjectScope, Skill, SkillFile, SkillRecord, SkillRepo, SkillSource, SkillUpdateInfo,
    ToolAdapter, UnmanagedSkill, SKILL_SCOPE_GLOBAL, SKILL_SCOPE_PROJECT,
};

/// 项目级安装与全局同名技能冲突的错误前缀（前端据此给出专属提示）
pub const SKILL_GLOBAL_CONFLICT_PREFIX: &str = "SKILL_GLOBAL_CONFLICT:";
/// 项目下仍有技能时拒绝移除项目注册的错误前缀
pub const SKILL_PROJECT_NOT_EMPTY_PREFIX: &str = "SKILL_PROJECT_NOT_EMPTY:";

/// 解压安全预算：条目数 / 解压后总字节 / symlink 目标声明长度 / 目录计费
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SYMLINK_TARGET_BYTES: u64 = 4 * 1024;
const DIRECTORY_BUDGET_COST: u64 = 4096;
/// 压缩体下载上限（github.rs 引用）
pub const MAX_ARCHIVE_DOWNLOAD_BYTES: u64 = 128 * 1024 * 1024;

/// 全局状态锁：快照读与写操作互斥（网络 I/O 期间刻意不持有）
fn skill_state_lock() -> &'static RwLock<()> {
    static LOCK: OnceLock<RwLock<()>> = OnceLock::new();
    LOCK.get_or_init(|| RwLock::new(()))
}

fn state_read_guard() -> std::sync::RwLockReadGuard<'static, ()> {
    skill_state_lock().read().unwrap_or_else(|e| e.into_inner())
}

fn state_write_guard() -> std::sync::RwLockWriteGuard<'static, ()> {
    skill_state_lock()
        .write()
        .unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
std::thread_local! {
    /// 测试用：注入第 N 次 fs_rename 调用失败（Some(0) = 下一次调用即失败）
    static RENAME_FAIL_AFTER: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

/// 分发方式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncMethod {
    Auto,
    Symlink,
    Copy,
}

/// 项目级安装的记录元数据（各安装入口共用）
struct ProjectInstallMeta {
    directory: String,
    source_type: String,
    source_repo: Option<String>,
    source_branch: Option<String>,
    source_subpath: Option<String>,
    source_author: Option<String>,
    source_registry_id: Option<String>,
    source_url: Option<String>,
    source_github_detected: bool,
    current_commit: Option<String>,
    display_name: Option<String>,
    input_description: Option<String>,
    tags: Vec<String>,
    /// 安装时用户选择的工具（仅记录偏好，项目级不做工具部署）
    enabled_tools: Vec<String>,
    /// 安装时选择的项目技能同步方式。
    deploy_method: String,
}

impl SyncMethod {
    fn from_str(raw: &str) -> Self {
        match raw {
            "symlink" => Self::Symlink,
            "copy" => Self::Copy,
            _ => Self::Auto,
        }
    }
}

/// `inspect_destination` 的调用场景：决定悬空 symlink / 普通文件如何分类。
/// 区别的动机是数据安全：卸载与重部署不能因为"看起来能覆盖"就删掉用户文件。
/// （安装/新建分发场景不走此分类——由 replace_dest_with_copy 的原子替换兜底，
/// 旧值先备份、失败回滚，语义更强。）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum DestCheckMode {
    /// 重部署场景：悬空 symlink（无数据风险）可安全覆盖；普通文件仍按外来内容拒绝
    Redeploy,
    /// 卸载场景：悬空 symlink 与普通文件一律按外来内容 Err 拒绝，绝不删用户文件
    Uninstall,
}

/// SKILL.md frontmatter 元数据
#[derive(Debug, Default, serde::Deserialize)]
pub struct SkillMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
}

pub struct SkillService;

impl SkillService {
    // ========== 路径与设置 ==========

    /// 当前同步方式（settings.distribution_method，默认 auto）
    pub fn get_sync_method(db: &Database) -> SyncMethod {
        let raw = db
            .get_setting("distribution_method")
            .ok()
            .flatten()
            .unwrap_or_else(|| "auto".to_string());
        SyncMethod::from_str(&raw)
    }

    /// 中央技能库目录（settings.library_path 覆盖，支持 ~；默认 ~/.skilldock/skills）
    pub fn get_library_dir(db: &Database) -> Result<PathBuf> {
        let dir = match db.get_setting("library_path")? {
            Some(raw) if !raw.trim().is_empty() => config::expand_tilde(&raw)?,
            _ => config::get_default_library_dir()?,
        };
        fs::create_dir_all(&dir).with_context(|| format!("创建技能库目录失败: {}", dir.display()))?;
        Ok(dir)
    }

    // ========== 安全校验 ==========

    /// 校验并规范化技能源路径（允许多级目录），拒绝路径穿越和绝对路径
    pub fn sanitize_skill_source_path(raw: &str) -> Option<PathBuf> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }

        let mut normalized = PathBuf::new();
        let mut has_component = false;

        for component in Path::new(trimmed).components() {
            match component {
                Component::Normal(name) => {
                    let segment = name.to_string_lossy().trim().to_string();
                    if segment.is_empty() || segment == "." || segment == ".." {
                        return None;
                    }
                    normalized.push(segment);
                    has_component = true;
                }
                Component::CurDir
                | Component::ParentDir
                | Component::RootDir
                | Component::Prefix(_) => {
                    return None;
                }
            }
        }

        has_component.then_some(normalized)
    }

    /// 校验并规范化安装目录名（最终落盘目录名，仅单段）。
    /// 拒绝：路径分隔符、隐藏名、尾点/尾空格、Windows 非法字符（`<>:"|?*` 及控制字符）、
    /// Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，大小写不敏感，含 con.txt 带扩展名形式）、
    /// 超过 255 字节的组件。
    pub fn sanitize_install_name(raw: &str) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
        // 显式拒绝两种分隔符：`\` 在 Unix 上不是分隔符，但同一值到 Windows 就变嵌套路径
        if trimmed.contains('/') || trimmed.contains('\\') {
            return None;
        }
        let path = Path::new(trimmed);
        let mut components = path.components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(name)), None) => {
                let raw_name = name.to_string_lossy();
                // Windows 会静默剥离尾点/尾空格，落盘名与声明名不一致，直接拒绝
                if raw_name.ends_with('.') || raw_name.ends_with(char::is_whitespace) {
                    return None;
                }
                let normalized = raw_name.trim().to_string();
                if normalized.is_empty()
                    || normalized == "."
                    || normalized == ".."
                    || normalized.starts_with('.')
                {
                    return None;
                }
                // NTFS 单组件上限 255 字节
                if normalized.len() > 255 {
                    return None;
                }
                if normalized
                    .chars()
                    .any(|c| c.is_ascii_control() || "<>:\"|?*".contains(c))
                {
                    return None;
                }
                // Windows 保留设备名：取首个 `.` 前的词干判断（con.txt 同样不可创建）
                let stem = normalized.split('.').next().unwrap_or(&normalized);
                let upper = stem.to_ascii_uppercase();
                if matches!(
                    upper.as_str(),
                    "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5"
                        | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4"
                        | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
                ) {
                    return None;
                }
                Some(normalized)
            }
            _ => None,
        }
    }

    /// 校验来自 DB 行等外部来源的 directory 字段：归一化结果须与原值逐字相同
    pub fn require_valid_directory(directory: &str) -> Result<String> {
        match Self::sanitize_install_name(directory) {
            Some(normalized) if normalized == directory => Ok(normalized),
            _ => Err(anyhow!(
                "Invalid skill directory (possible path traversal): {directory:?}"
            )),
        }
    }

    /// GitHub 账号名（user / org login）：ASCII 字母数字与 `-`
    fn is_valid_github_owner(owner: &str) -> bool {
        !owner.is_empty()
            && owner.len() <= 39
            && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    }

    /// GitHub 仓库名：允许 `.` `-` `_`，整体不能是 `.` 或 `..`
    fn is_valid_github_repo_name(name: &str) -> bool {
        !name.is_empty()
            && name.len() <= 100
            && name != "."
            && name != ".."
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    }

    /// git 分支名（按段白名单；空串与 HEAD 是「默认分支」哨兵，永远放行）
    fn is_valid_git_branch(branch: &str) -> bool {
        if branch.is_empty() || branch.eq_ignore_ascii_case("HEAD") {
            return true;
        }
        if branch.len() > 255 {
            return false;
        }
        if branch.starts_with('/') || branch.ends_with('/') || branch.contains("//") {
            return false;
        }
        // git 引用规则：不允许连续两点（防 range 语法歧义）
        if branch.contains("..") {
            return false;
        }
        if branch.contains("@{") {
            return false;
        }
        if branch
            .chars()
            .any(|c| c.is_ascii_control() || " ~^:?*[\\#%".contains(c))
        {
            return false;
        }
        branch.split('/').all(|segment| {
            !segment.is_empty()
                && !segment.starts_with('.')
                && !segment.ends_with('.')
                && !segment.ends_with(".lock")
                // 前导连字符会被 option 解析吞掉
                && !segment.starts_with('-')
        })
    }

    /// 校验一组仓库坐标，用于任何会被拼进 github.com URL 的地方
    pub fn validate_repo_ref(owner: &str, name: &str, branch: &str) -> Result<()> {
        if !Self::is_valid_github_owner(owner) || !Self::is_valid_github_repo_name(name) {
            return Err(anyhow!(format_skill_error(
                "INVALID_REPO_REF",
                &[("owner", owner), ("name", name)],
                Some("checkRepoUrl"),
            )));
        }
        if !Self::is_valid_git_branch(branch) {
            return Err(anyhow!(format_skill_error(
                "INVALID_REPO_REF",
                &[("owner", owner), ("name", name), ("branch", branch)],
                Some("checkRepoUrl"),
            )));
        }
        Ok(())
    }

    /// 出口断言：URL 拼好后再确认它确实指向预期的 github.com 路径
    pub fn assert_github_archive_url(url: &str, owner: &str, name: &str) -> Result<()> {
        let parsed = url::Url::parse(url).map_err(|e| anyhow!("Invalid archive URL: {e}"))?;
        let expected_prefix = format!("/{owner}/{name}/archive/refs/heads/");
        if parsed.scheme() != "https"
            || parsed.host_str() != Some("github.com")
            || !parsed.path().starts_with(&expected_prefix)
        {
            return Err(anyhow!(format_skill_error(
                "INVALID_REPO_REF",
                &[("owner", owner), ("name", name)],
                Some("checkRepoUrl"),
            )));
        }
        Ok(())
    }

    // ========== 内容哈希 ==========

    /// 计算目录内容 SHA-256：非隐藏文件按相对路径排序，"路径\0内容\0" 逐文件 feed。
    /// 符号链接一律跳过（不跟随）；目录深度 / 文件数超限返回 Err 而非 partial hash
    pub fn compute_dir_hash(dir: &Path) -> Result<String> {
        use sha2::{Digest, Sha256};

        let mut files: Vec<PathBuf> = Vec::new();
        Self::collect_files_for_hash(dir, dir, 0, &mut files)?;
        files.sort();

        let mut hasher = Sha256::new();
        for file_path in &files {
            let relative = file_path.strip_prefix(dir).unwrap_or(file_path);
            let rel_str = relative.to_string_lossy().replace('\\', "/");
            hasher.update(rel_str.as_bytes());
            hasher.update(b"\0");
            let content = fs::read(file_path)
                .with_context(|| format!("读取文件失败: {}", file_path.display()))?;
            hasher.update(&content);
            hasher.update(b"\0");
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    /// 递归收集目录下所有非隐藏文件（symlink 不跟随，深度/数量超限报错）
    #[allow(clippy::only_used_in_recursion)]
    fn collect_files_for_hash(
        base: &Path,
        current: &Path,
        depth: usize,
        files: &mut Vec<PathBuf>,
    ) -> Result<()> {
        const MAX_HASH_DEPTH: usize = 32;
        const MAX_HASH_FILES: usize = 100_000;

        if depth > MAX_HASH_DEPTH {
            return Err(anyhow!(
                "目录嵌套超过 {MAX_HASH_DEPTH} 层，拒绝计算哈希: {}",
                current.display()
            ));
        }
        let entries =
            fs::read_dir(current).with_context(|| format!("读取目录失败: {}", current.display()))?;
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            // file_type 不跟随链接：symlink 一律跳过，避免环状链接导致无限递归
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                Self::collect_files_for_hash(base, &path, depth + 1, files)?;
            } else {
                files.push(path);
                if files.len() > MAX_HASH_FILES {
                    return Err(anyhow!(
                        "目录文件数超过 {MAX_HASH_FILES}，拒绝计算哈希: {}",
                        base.display()
                    ));
                }
            }
        }
        Ok(())
    }

    /// 判定 check_updates 应使用的本地哈希：目录缺失 → None（视为可更新）；
    /// 有缓存用缓存；无缓存现算（freshly_computed=true，调用方回填）
    fn local_hash_for_update_check(
        base_dir: &Path,
        raw_directory: &str,
        cached_hash: Option<&str>,
    ) -> Option<(String, bool)> {
        let directory = match Self::require_valid_directory(raw_directory) {
            Ok(d) => d,
            Err(err) => {
                log::warn!("Skill directory 非法，跳过本地目录检查: {err}");
                return cached_hash.map(|h| (h.to_string(), false));
            }
        };

        let local_dir = base_dir.join(&directory);
        if !local_dir.exists() {
            return None;
        }
        if let Some(h) = cached_hash {
            return Some((h.to_string(), false));
        }
        match Self::compute_dir_hash(&local_dir) {
            Ok(h) => Some((h, true)),
            Err(_) => None,
        }
    }

    // ========== ZIP 安全解压 ==========

    /// 按预算把单个归档条目写出，累计超限即中止（不信任归档头声明的 size）
    fn copy_entry_within_budget<R: std::io::Read, W: std::io::Write>(
        reader: &mut R,
        writer: &mut W,
        total_bytes: &mut u64,
    ) -> Result<()> {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let read = reader.read(&mut buffer)?;
            if read == 0 {
                return Ok(());
            }
            Self::charge_archive_budget(total_bytes, read as u64)?;
            writer.write_all(&buffer[..read])?;
        }
    }

    /// 读取 symlink 条目声明的目标路径（≤4KiB、须为 UTF-8，否则返回 None 跳过）
    fn read_symlink_target<R: std::io::Read>(
        reader: &mut R,
        total_bytes: &mut u64,
    ) -> Result<Option<String>> {
        let mut raw = Vec::new();
        // 多读一个字节，用来区分"正好到上限"和"被截断"
        let mut limited = std::io::Read::take(reader, MAX_SYMLINK_TARGET_BYTES + 1);
        std::io::Read::read_to_end(&mut limited, &mut raw)?;
        if raw.len() as u64 > MAX_SYMLINK_TARGET_BYTES {
            return Ok(None);
        }
        Self::charge_archive_budget(total_bytes, raw.len() as u64)?;
        Ok(String::from_utf8(raw)
            .ok()
            .map(|target| target.trim().to_string()))
    }

    /// 建目录并按实际新建的层数计费
    fn create_dir_all_within_budget(path: &Path, total_bytes: &mut u64) -> Result<()> {
        let missing = path.ancestors().take_while(|p| !p.exists()).count() as u64;
        if missing > 0 {
            Self::charge_archive_budget(total_bytes, missing * DIRECTORY_BUDGET_COST)?;
        }
        fs::create_dir_all(path)?;
        Ok(())
    }

    /// 归档预算的唯一扣费点
    fn charge_archive_budget(total_bytes: &mut u64, amount: u64) -> Result<()> {
        if total_bytes.saturating_add(amount) > MAX_ARCHIVE_TOTAL_BYTES {
            let limit_mb = (MAX_ARCHIVE_TOTAL_BYTES / 1024 / 1024).to_string();
            return Err(anyhow!(format_skill_error(
                "ARCHIVE_TOO_LARGE",
                &[("limit_mb", &limit_mb)],
                Some("checkZipContent"),
            )));
        }
        *total_bytes += amount;
        Ok(())
    }

    /// 解压核心：可选剥掉一层根目录（GitHub 归档）或不剥（任意 URL / 本地 ZIP）
    fn extract_archive_core<R: std::io::Read + std::io::Seek>(
        mut archive: zip::ZipArchive<R>,
        dest: &Path,
        strip_root: bool,
    ) -> Result<()> {
        let root_name = if strip_root {
            if archive.is_empty() {
                return Err(anyhow!(format_skill_error(
                    "EMPTY_ARCHIVE",
                    &[],
                    Some("checkRepoUrl"),
                )));
            }
            let first_file = archive.by_index(0)?;
            let name = first_file.name();
            Some(name.split('/').next().unwrap_or("").to_string())
        } else {
            if archive.is_empty() {
                return Err(anyhow!(format_skill_error(
                    "EMPTY_ARCHIVE",
                    &[],
                    Some("checkZipContent"),
                )));
            }
            None
        };

        if archive.len() > MAX_ARCHIVE_ENTRIES {
            let count = archive.len().to_string();
            let limit = MAX_ARCHIVE_ENTRIES.to_string();
            return Err(anyhow!(format_skill_error(
                "ARCHIVE_TOO_MANY_ENTRIES",
                &[("count", &count), ("limit", &limit)],
                Some("checkZipContent"),
            )));
        }
        let mut total_bytes: u64 = 0;

        // 第一遍：解压普通文件和目录，收集 symlink 条目
        let mut symlinks: Vec<(PathBuf, String)> = Vec::new();

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            // 第一道：enclosed_name() 拒绝绝对路径、盘符前缀与净深度为负的条目
            let Some(safe_path) = file.enclosed_name() else {
                log::warn!("跳过不安全的压缩包条目: {}", file.name());
                continue;
            };

            let relative_path = match &root_name {
                Some(root) => match safe_path.strip_prefix(root) {
                    Ok(rel) => rel.to_path_buf(),
                    Err(_) => continue,
                },
                None => safe_path.to_path_buf(),
            };

            // 第二道：enclosed_name() 不消解 `..`；剥根目录会花掉一级深度预算，
            // join 之前必须对实际使用的相对路径再验一次。
            if relative_path
                .components()
                .any(|c| matches!(c, Component::ParentDir))
            {
                log::warn!("跳过越界的压缩包条目: {}", file.name());
                continue;
            }

            if relative_path.as_os_str().is_empty() {
                continue;
            }

            let outpath = dest.join(&relative_path);

            if file.is_symlink() {
                let Some(target) = Self::read_symlink_target(&mut file, &mut total_bytes)? else {
                    log::warn!("跳过目标不合法的 symlink 条目: {}", file.name());
                    continue;
                };
                symlinks.push((outpath, target));
            } else if file.is_dir() {
                Self::create_dir_all_within_budget(&outpath, &mut total_bytes)?;
            } else {
                if let Some(parent) = outpath.parent() {
                    Self::create_dir_all_within_budget(parent, &mut total_bytes)?;
                }
                let mut outfile = fs::File::create(&outpath)?;
                Self::copy_entry_within_budget(&mut file, &mut outfile, &mut total_bytes)?;
            }
        }

        // 第二遍：解析 symlink，将目标内容复制到 symlink 位置
        Self::resolve_symlinks_in_dir(dest, &symlinks, &mut total_bytes)?;

        Ok(())
    }

    /// 解压 GitHub 仓库归档（剥掉自带的一层根目录）
    pub fn extract_repo_archive<R: std::io::Read + std::io::Seek>(
        archive: zip::ZipArchive<R>,
        dest: &Path,
    ) -> Result<()> {
        Self::extract_archive_core(archive, dest, true)
    }

    /// 解压任意 ZIP（不剥根目录，用于 URL 安装）
    pub fn extract_zip_archive_plain<R: std::io::Read + std::io::Seek>(
        archive: zip::ZipArchive<R>,
        dest: &Path,
    ) -> Result<()> {
        Self::extract_archive_core(archive, dest, false)
    }

    /// 解压本地 ZIP 到系统临时目录（TempDir 守卫，失败无残留）
    pub fn extract_local_zip(zip_path: &Path) -> Result<tempfile::TempDir> {
        Self::extract_local_zip_in(zip_path, &std::env::temp_dir())
    }

    /// 同上，但临时目录落点由调用方指定（测试用）
    pub fn extract_local_zip_in(zip_path: &Path, base_dir: &Path) -> Result<tempfile::TempDir> {
        let file = fs::File::open(zip_path)
            .with_context(|| format!("Failed to open ZIP file: {}", zip_path.display()))?;
        let archive = zip::ZipArchive::new(file)
            .with_context(|| format!("Failed to read ZIP file: {}", zip_path.display()))?;

        // 守卫持有到解压全部成功为止：中途任何 `?` 都会让它清掉半成品目录
        let temp_dir = tempfile::tempdir_in(base_dir)?;
        let temp_path = temp_dir.path().to_path_buf();
        Self::extract_zip_archive_plain(archive, &temp_path)?;
        Ok(temp_dir)
    }

    /// 与 copy_dir_recursive 同语义，但把写出的字节计入归档总预算（仅解压期物化用）
    fn copy_dir_within_budget(src: &Path, dest: &Path, total_bytes: &mut u64) -> Result<()> {
        Self::create_dir_all_within_budget(dest, total_bytes)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let path = entry.path();
            let dest_path = dest.join(entry.file_name());
            if path.is_dir() {
                Self::copy_dir_within_budget(&path, &dest_path, total_bytes)?;
            } else {
                Self::copy_file_within_budget(&path, &dest_path, total_bytes)?;
            }
        }
        Ok(())
    }

    /// 复制单个文件并计入归档总预算
    fn copy_file_within_budget(src: &Path, dest: &Path, total_bytes: &mut u64) -> Result<()> {
        let mut reader = fs::File::open(src)?;
        let mut writer = fs::File::create(dest)?;
        Self::copy_entry_within_budget(&mut reader, &mut writer, total_bytes)
    }

    /// 第二遍：把归档内 symlink 物化为目标内容副本
    fn resolve_symlinks_in_dir(
        base_dir: &Path,
        symlinks: &[(PathBuf, String)],
        total_bytes: &mut u64,
    ) -> Result<()> {
        let canonical_base = base_dir
            .canonicalize()
            .unwrap_or_else(|_| base_dir.to_path_buf());

        for (link_path, target) in symlinks {
            let parent = link_path.parent().unwrap_or(base_dir);
            let resolved = parent.join(target);

            let resolved = match resolved.canonicalize() {
                Ok(p) => p,
                Err(_) => {
                    log::warn!(
                        "Symlink 目标不存在，跳过: {} -> {}",
                        link_path.display(),
                        target
                    );
                    continue;
                }
            };

            // 安全检查一：目标必须在 base_dir 内
            if !resolved.starts_with(&canonical_base) {
                log::warn!(
                    "Symlink 目标超出仓库范围，跳过: {} -> {}",
                    link_path.display(),
                    resolved.display()
                );
                continue;
            }

            // 安全检查二：目标不能包含 link 自身（否则递归复制逐层膨胀）。
            // 比较必须在规范形式上做：link_path 未落盘，但父目录一定存在。
            let canonical_link = match parent.canonicalize() {
                Ok(canonical_parent) => match link_path.file_name() {
                    Some(name) => canonical_parent.join(name),
                    None => canonical_parent,
                },
                Err(_) => match link_path.strip_prefix(base_dir) {
                    Ok(relative) => canonical_base.join(relative),
                    Err(_) => link_path.clone(),
                },
            };
            if canonical_link.starts_with(&resolved) {
                log::warn!(
                    "Symlink 目标包含链接自身，跳过（会导致递归自复制）: {} -> {}",
                    link_path.display(),
                    resolved.display()
                );
                continue;
            }

            if resolved.is_dir() {
                Self::copy_dir_within_budget(&resolved, link_path, total_bytes)?;
            } else if resolved.is_file() {
                if let Some(parent) = link_path.parent() {
                    Self::create_dir_all_within_budget(parent, total_bytes)?;
                }
                Self::copy_file_within_budget(&resolved, link_path, total_bytes)?;
            }
        }
        Ok(())
    }

    // ========== 文件工具 ==========

    /// 递归复制目录
    pub fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<()> {
        fs::create_dir_all(dest)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let path = entry.path();
            let dest_path = dest.join(entry.file_name());
            if path.is_dir() {
                Self::copy_dir_recursive(&path, &dest_path)?;
            } else {
                fs::copy(&path, &dest_path)?;
            }
        }
        Ok(())
    }

    /// 删除路径（symlink 只删链接本身；目录递归删；文件直接删）
    pub fn remove_path(path: &Path) -> Result<()> {
        if Self::is_symlink(path) {
            #[cfg(unix)]
            fs::remove_file(path)?;
            #[cfg(windows)]
            {
                // Windows 的目录 symlink 需要用 remove_dir，文件 symlink 需要用 remove_file；
                // 悬空链接无法靠目标类型区分，先按目录删，失败再按文件删
                if let Err(dir_err) = fs::remove_dir(path) {
                    fs::remove_file(path).map_err(|file_err| {
                        anyhow!(
                            "删除符号链接失败: {}（remove_dir: {dir_err}；remove_file: {file_err}）",
                            path.display()
                        )
                    })?;
                }
            }
        } else if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// 创建目录符号链接（跨平台）
    #[cfg(unix)]
    pub fn create_symlink(src: &Path, dest: &Path) -> Result<()> {
        std::os::unix::fs::symlink(src, dest)
            .with_context(|| format!("创建符号链接失败: {} -> {}", src.display(), dest.display()))
    }

    #[cfg(windows)]
    pub fn create_symlink(src: &Path, dest: &Path) -> Result<()> {
        std::os::windows::fs::symlink_dir(src, dest).map_err(|err| {
            if err.raw_os_error() == Some(1314) {
                anyhow!(
                    "创建符号链接失败（Windows 错误 1314，当前进程没有创建符号链接的权限）: {} -> {}。请启用 Windows 开发者模式或以管理员身份运行应用",
                    src.display(),
                    dest.display()
                )
            } else {
                anyhow!("创建符号链接失败: {} -> {}: {err}", src.display(), dest.display())
            }
        })
    }

    /// 检查路径是否为符号链接
    pub fn is_symlink(path: &Path) -> bool {
        path.symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }

    /// 同步源目录必须是真实目录且含 SKILL.md（防止覆盖目标为空壳）
    pub fn validate_sync_source_dir(source: &Path, directory: &str) -> Result<()> {
        if !source.is_dir() {
            return Err(anyhow!("Skill 不存在于技能库: {directory}"));
        }
        let manifest = source.join("SKILL.md");
        if !manifest.is_file() {
            return Err(anyhow!(
                "Skill 源目录缺少 SKILL.md，拒绝同步以避免覆盖目标目录: {}",
                source.display()
            ));
        }
        Ok(())
    }

    /// 原子替换目标目录：复制到 tmp → dest 改名 backup → tmp 改名 dest → 删除 backup。
    /// 任一步失败都回滚到 dest 原状；回滚失败返回错误并指明备份位置供手动恢复。
    pub fn replace_dest_with_copy(source: &Path, dest: &Path, directory: &str) -> Result<()> {
        Self::validate_sync_source_dir(source, directory)?;

        let parent = dest
            .parent()
            .ok_or_else(|| anyhow!("Invalid skill destination: {}", dest.display()))?;
        fs::create_dir_all(parent)?;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp_name = Self::sanitize_tmp_segment(directory);
        let staging = format!(".{tmp_name}.{}-{nonce}", std::process::id());
        let tmp = parent.join(format!("{staging}.tmp"));
        let backup = parent.join(format!("{staging}.bak"));

        for path in [&tmp, &backup] {
            if path.exists() || Self::is_symlink(path) {
                Self::remove_path(path)?;
            }
        }

        if let Err(err) = Self::copy_dir_recursive(source, &tmp) {
            Self::cleanup_staging(&tmp);
            return Err(err);
        }

        let had_dest = dest.exists() || Self::is_symlink(dest);
        if had_dest {
            if let Err(err) = Self::fs_rename(dest, &backup) {
                Self::cleanup_staging(&tmp);
                return Err(anyhow!(
                    "备份现有 Skill 目录失败: {} -> {}: {err}",
                    dest.display(),
                    backup.display()
                ));
            }
        }

        if let Err(err) = Self::fs_rename(&tmp, dest) {
            Self::cleanup_staging(&tmp);
            if had_dest {
                if let Err(rollback_err) = fs::rename(&backup, dest) {
                    return Err(anyhow!(
                        "替换 Skill 目录失败: {err}；回滚备份也失败: {rollback_err}。原数据仍在 {}，请手动重命名为 {}",
                        backup.display(),
                        dest.display()
                    ));
                }
            }
            return Err(anyhow!(
                "替换 Skill 目录失败: {} -> {}: {err}",
                tmp.display(),
                dest.display()
            ));
        }

        if had_dest {
            Self::cleanup_staging(&backup);
        }
        Ok(())
    }

    /// 尽力清理暂存目录，失败仅告警（不影响主流程结论）
    fn cleanup_staging(path: &Path) {
        if path.exists() || Self::is_symlink(path) {
            if let Err(err) = Self::remove_path(path) {
                log::warn!("清理暂存目录失败 {}: {err}", path.display());
            }
        }
    }

    /// fs::rename 封装（测试可注入失败）
    fn fs_rename(from: &Path, to: &Path) -> std::io::Result<()> {
        #[cfg(test)]
        {
            let inject = RENAME_FAIL_AFTER.with(|c| match c.get() {
                Some(0) => {
                    c.set(None);
                    true
                }
                Some(n) => {
                    c.set(Some(n - 1));
                    false
                }
                None => false,
            });
            if inject {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "injected rename failure (test)",
                ));
            }
        }
        fs::rename(from, to)
    }

    fn sanitize_tmp_segment(segment: &str) -> String {
        let sanitized = segment
            .chars()
            .map(|c| match c {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
                _ => '-',
            })
            .collect::<String>()
            .trim_matches('-')
            .to_string();
        if sanitized.is_empty() {
            "skill".to_string()
        } else {
            sanitized
        }
    }

    /// 两个路径是否指向同一位置（字面或 canonical 后相等）
    pub fn paths_alias(left: &Path, right: &Path) -> bool {
        if left == right {
            return true;
        }
        matches!(
            (left.canonicalize(), right.canonicalize()),
            (Ok(left), Ok(right)) if left == right
        )
    }

    /// 两个路径是否互相包含（含 canonical 与悬空 symlink 父目录解析）
    pub fn paths_overlap(left: &Path, right: &Path) -> bool {
        let overlaps = |left: &Path, right: &Path| {
            left == right || left.starts_with(right) || right.starts_with(left)
        };
        if overlaps(left, right) {
            return true;
        }
        if let (Ok(left), Ok(right)) = (left.canonicalize(), right.canonicalize()) {
            if overlaps(&left, &right) {
                return true;
            }
        }
        let canonical_entry =
            |path: &Path| Some(path.parent()?.canonicalize().ok()?.join(path.file_name()?));
        matches!(
            (canonical_entry(left), canonical_entry(right)),
            (Some(left), Some(right)) if overlaps(&left, &right)
        )
    }

    /// `inspect_destination` 的调用场景分类见模块级 `DestCheckMode`。
    /// 目标归属检查：symlink 解析后指向 source，或目录内容与 source 哈希相同 → Ok(Some)；
    /// 目标不存在 → Ok(None)；同名外来内容 → Err（拒绝覆盖）。
    /// 悬空 symlink 无数据损失风险，Redeploy 归为可安全覆盖（Ok(None)）；
    /// Uninstall 场景悬空 symlink 与普通文件都归为外来内容（Err）。
    fn inspect_destination(
        source: &Path,
        destination: &Path,
        directory: &str,
        mode: DestCheckMode,
    ) -> Result<Option<()>> {
        if !destination.exists() && !Self::is_symlink(destination) {
            return Ok(None);
        }

        if Self::is_symlink(destination) {
            let target = fs::read_link(destination)?;
            let resolved = if target.is_absolute() {
                target
            } else {
                destination
                    .parent()
                    .map(|parent| parent.join(&target))
                    .unwrap_or(target)
            };
            if matches!(
                (resolved.canonicalize(), source.canonicalize()),
                (Ok(resolved), Ok(source)) if resolved == source
            ) {
                return Ok(Some(()));
            }
            // 悬空 symlink：目标不存在、无数据损失风险，重部署场景可安全覆盖
            if resolved.canonicalize().is_err() && !matches!(mode, DestCheckMode::Uninstall) {
                return Ok(None);
            }
        } else if destination.is_dir() {
            if let (Ok(dest_hash), Ok(source_hash)) = (
                Self::compute_dir_hash(destination),
                Self::compute_dir_hash(source),
            ) {
                if dest_hash == source_hash {
                    return Ok(Some(()));
                }
            }
        }

        Err(anyhow!(format_skill_error(
            "SKILL_DEST_CONFLICT",
            &[
                ("path", directory),
                ("target", &destination.display().to_string()),
            ],
            Some("removeConflict"),
        )))
    }

    // ========== 元数据 ==========

    /// 解析 SKILL.md frontmatter（splitn(3, "---") + serde_yaml）
    pub fn parse_skill_metadata_static(path: &Path) -> Result<SkillMetadata> {
        let content = fs::read_to_string(path)?;
        let content = content.trim_start_matches('\u{feff}');

        let parts: Vec<&str> = content.splitn(3, "---").collect();
        if parts.len() < 3 {
            return Ok(SkillMetadata {
                name: None,
                description: None,
            });
        }

        let front_matter = parts[1].trim();
        let meta: SkillMetadata = serde_yaml::from_str(front_matter).unwrap_or(SkillMetadata {
            name: None,
            description: None,
        });
        Ok(meta)
    }

    /// 从 SKILL.md 读取名称和描述，不存在则用目录名兜底
    pub fn read_skill_name_desc(skill_md: &Path, fallback_name: &str) -> (String, Option<String>) {
        if skill_md.exists() {
            match Self::parse_skill_metadata_static(skill_md) {
                Ok(meta) => (
                    meta.name.unwrap_or_else(|| fallback_name.to_string()),
                    meta.description,
                ),
                Err(_) => (fallback_name.to_string(), None),
            }
        } else {
            (fallback_name.to_string(), None)
        }
    }

    // ========== 扫描 ==========

    /// 递归扫描目录查找包含 SKILL.md 的技能目录（跳过隐藏目录）
    pub fn scan_skills_in_dir(dir: &Path) -> Result<Vec<PathBuf>> {
        let mut skill_dirs = Vec::new();
        Self::scan_skills_recursive(dir, &mut skill_dirs)?;
        Ok(skill_dirs)
    }

    fn scan_skills_recursive(current: &Path, results: &mut Vec<PathBuf>) -> Result<()> {
        let skill_md = current.join("SKILL.md");
        if skill_md.exists() {
            results.push(current.to_path_buf());
            return Ok(());
        }
        if let Ok(entries) = fs::read_dir(current) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let dir_name = entry.file_name().to_string_lossy().to_string();
                    if dir_name.starts_with('.') {
                        continue;
                    }
                    Self::scan_skills_recursive(&path, results)?;
                }
            }
        }
        Ok(())
    }

    /// 仓库扫描：找所有含 SKILL.md 的目录，返回 (仓库内相对目录, SKILL.md 相对路径)
    fn scan_repo_dir_recursive(
        current_dir: &Path,
        base_dir: &Path,
        repo_name: &str,
        results: &mut Vec<(String, String)>,
    ) -> Result<()> {
        let skill_md = current_dir.join("SKILL.md");
        if skill_md.exists() {
            let directory = if current_dir == base_dir {
                repo_name.to_string()
            } else {
                current_dir
                    .strip_prefix(base_dir)
                    .unwrap_or(current_dir)
                    .to_string_lossy()
                    .replace('\\', "/")
            };
            let doc_path = skill_md
                .strip_prefix(base_dir)
                .unwrap_or(skill_md.as_path())
                .to_string_lossy()
                .replace('\\', "/");
            results.push((directory, doc_path));
            return Ok(());
        }
        for entry in fs::read_dir(current_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if dir_name.starts_with('.') {
                    continue;
                }
                Self::scan_repo_dir_recursive(&path, base_dir, repo_name, results)?;
            }
        }
        Ok(())
    }

    /// 在目录树中查找名称匹配且包含 SKILL.md 的子目录（≤3 层，忽略大小写）。
    /// 唯一匹配 → Ok(Some)；无匹配 → Ok(None)；多个匹配 → Err（拒绝歧义兜底）
    fn find_skill_dir_by_name(root: &Path, target_name: &str) -> Result<Option<PathBuf>> {
        fn walk(dir: &Path, target: &str, depth: usize, matches: &mut Vec<PathBuf>) {
            if depth > 3 {
                return;
            }
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with('.') {
                    continue;
                }
                if name_str.eq_ignore_ascii_case(target) && path.join("SKILL.md").exists() {
                    matches.push(path.clone());
                }
                walk(&path, target, depth + 1, matches);
            }
        }
        let mut matches = Vec::new();
        walk(root, target_name, 0, &mut matches);
        match matches.len() {
            0 => Ok(None),
            1 => Ok(matches.into_iter().next()),
            _ => {
                let candidates = matches
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                Err(anyhow!(format_skill_error(
                    "SKILL_DIR_AMBIGUOUS",
                    &[("directory", target_name), ("candidates", &candidates)],
                    Some("checkRepoUrl"),
                )))
            }
        }
    }

    /// 将目录信息解析为解压目录中的真实源目录（返回目录必含 SKILL.md）：
    /// 1. 直接相对路径命中；2. 按末段名递归查找（多匹配报歧义错误）；3. 仓库根兜底
    pub fn resolve_skill_source_dir(root: &Path, raw_directory: &str) -> Result<Option<PathBuf>> {
        let Some(source_rel) = Self::sanitize_skill_source_path(raw_directory) else {
            return Ok(None);
        };
        let Some(install_name) = source_rel.file_name().map(|n| n.to_string_lossy().to_string())
        else {
            return Ok(None);
        };

        let direct = root.join(&source_rel);
        if direct.is_dir() && direct.join("SKILL.md").is_file() {
            return Ok(Some(direct));
        }

        if let Some(found) = Self::find_skill_dir_by_name(root, &install_name)? {
            log::info!(
                "Skill directory '{}' not found at direct path, using fallback: {}",
                install_name,
                found.display()
            );
            return Ok(Some(found));
        }

        if root.join("SKILL.md").is_file() {
            log::info!(
                "Skill directory '{}' not found, but SKILL.md exists at root, using repo root",
                install_name
            );
            return Ok(Some(root.to_path_buf()));
        }

        Ok(None)
    }
}

// ========== 分发 / 安装 / 卸载 ==========

impl SkillService {
    /// 项目级技能在中央库中的命名空间键：项目路径清洗（非字母数字替 `_`、截断 40）
    /// 拼接 8 位 FNV-1a 稳定哈希。保证不同项目同名技能、项目与全局同名技能互不碰撞，
    /// 同时避开 Windows 非法字符与超长路径
    fn project_storage_namespace(project_path: &str) -> String {
        let sanitized: String = project_path
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        let trimmed: String = sanitized.chars().take(40).collect();
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in project_path.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        format!("{trimmed}-{hash:016x}")
    }

    /// 项目级技能的旧版存储目录（迁移前：原文件直接在 `<project>/.claude/skills/<dir>`）
    fn legacy_project_storage_dir(project_path: &str, directory: &str) -> PathBuf {
        Path::new(project_path)
            .join(".claude")
            .join("skills")
            .join(directory)
    }

    /// 技能的规范存储目录（全局：中央库；项目：`<library>/projects/<项目键>/<dir>`）。
    /// 项目级带旧版兜底：新位置不存在且旧位置存在时返回旧位置，
    /// 保证存量未迁移完成的安装仍可读、可更新、可卸载
    pub fn skill_storage_dir(db: &Database, record: &SkillRecord) -> Result<PathBuf> {
        let directory = Self::require_valid_directory(&record.directory)?;
        if record.is_project() {
            let project_path = record
                .project_path
                .as_deref()
                .ok_or_else(|| anyhow!("项目级 Skill {} 缺少 project_path", record.id))?;
            let new_dir = Self::get_library_dir(db)?
                .join("projects")
                .join(Self::project_storage_namespace(project_path))
                .join(&directory);
            if new_dir.exists() {
                return Ok(new_dir);
            }
            let legacy = Self::legacy_project_storage_dir(project_path, &directory);
            if legacy.exists() {
                return Ok(legacy);
            }
            Ok(new_dir)
        } else {
            Ok(Self::get_library_dir(db)?.join(directory))
        }
    }

    /// 项目内某工具的技能目录根：`<project>/<本地技能目录去掉 home 根的相对路径>`。
    /// 约定即用户规则：项目内目录 = 本地目录去掉根目录（如 `~/.claude/skills`
    /// → `.claude/skills`）；本地目录不在 home 下时该工具不参与项目级分发
    fn project_tool_root(tool: &ToolAdapter, project_path: &str) -> Option<PathBuf> {
        let home = config::get_home_dir().ok()?;
        let rel = Self::tool_project_subdir(tool, &home)?;
        Some(Path::new(project_path).join(rel))
    }

    /// 工具本地技能目录相对 home 的路径（分隔符统一为 `/`）；
    /// 不在 home 下或等于 home 本身时返回 None。home 由参数传入便于测试
    fn tool_project_subdir(tool: &ToolAdapter, home: &Path) -> Option<String> {
        let expanded = config::expand_tilde(&tool.current_path).ok()?;
        // Windows 上大小写/`\\?\` 前缀可能不一致：先直接裁，失败则 canonicalize 双方再裁
        let rel: PathBuf = match expanded.strip_prefix(home) {
            Ok(rel) => rel.to_path_buf(),
            Err(_) => {
                let expanded = expanded.canonicalize().ok()?;
                let home = home.canonicalize().ok()?;
                expanded.strip_prefix(&home).ok()?.to_path_buf()
            }
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        let rel = rel.trim_start_matches('/').to_string();
        if rel.is_empty() {
            None
        } else {
            Some(rel)
        }
    }

    /// 工具的技能根目录（current_path 展开 ~）
    fn tool_root(tool: &ToolAdapter) -> Result<PathBuf> {
        config::expand_tilde(&tool.current_path)
    }

    /// 过滤出真实存在且已启用的工具 id
    fn validated_tool_ids(db: &Database, tool_ids: &[String]) -> Result<Vec<String>> {
        let tools = db.list_tool_adapters()?;
        Ok(tool_ids
            .iter()
            .filter(|id| tools.iter().any(|t| &t.id == *id && t.is_enabled))
            .cloned()
            .collect())
    }

    /// 分发技能到一个工具目录（symlink 优先按部署方式回退 copy）。
    /// dest_root 为工具技能根目录：全局走 tool_root，项目内走 project_tool_root
    fn deploy_to_tool_at(
        db: &Database,
        record: &SkillRecord,
        tool: &ToolAdapter,
        dest_root: &Path,
    ) -> Result<()> {
        let directory = Self::require_valid_directory(&record.directory)?;
        let source = Self::skill_storage_dir(db, record)?;
        Self::validate_sync_source_dir(&source, &directory)?;

        fs::create_dir_all(dest_root)
            .with_context(|| format!("创建工具技能目录失败: {}", dest_root.display()))?;
        let dest = dest_root.join(&directory);

        // 工具目录与技能库同源时不做任何文件操作（否则会删掉源再重建）
        if Self::paths_alias(&source, &dest) {
            log::warn!("工具 {} 的技能目录与技能库相同，跳过部署", tool.id);
            return Ok(());
        }
        if Self::paths_overlap(&source, &dest) {
            return Err(anyhow!(
                "工具 {} 的技能目录与技能库路径重叠，拒绝部署: {} <-> {}",
                tool.id,
                source.display(),
                dest.display()
            ));
        }

        if record.deploy_method == "copy" {
            Self::replace_dest_with_copy(&source, &dest, &directory)?;
            return Ok(());
        }

        // symlink / auto：先试 symlink，失败回退 copy
        if dest.exists() && !Self::is_symlink(&dest) {
            Self::replace_dest_with_copy(&source, &dest, &directory)?;
            return Ok(());
        }
        if Self::is_symlink(&dest) {
            Self::remove_path(&dest)?;
        }
        match Self::create_symlink(&source, &dest) {
            Ok(()) => Ok(()),
            Err(err) => {
                log::warn!(
                    "Symlink 创建失败，回退到文件复制: {} -> {}. 错误: {err:#}",
                    source.display(),
                    dest.display()
                );
                Self::replace_dest_with_copy(&source, &dest, &directory)
            }
        }
    }

    /// 分发技能到工具的全局技能目录
    pub fn deploy_to_tool(db: &Database, record: &SkillRecord, tool: &ToolAdapter) -> Result<()> {
        let root = Self::tool_root(tool)?;
        Self::deploy_to_tool_at(db, record, tool, &root)
    }

    /// 从工具目录移除技能（容错删除 symlink 或真实目录）。
    /// dest_root 为工具技能根目录：全局走 tool_root，项目内走 project_tool_root
    fn remove_from_tool_at(
        db: &Database,
        record: &SkillRecord,
        tool: &ToolAdapter,
        dest_root: &Path,
    ) -> Result<()> {
        let directory = Self::require_valid_directory(&record.directory)?;
        let dest = dest_root.join(&directory);
        // 工具目录与技能库同源/重叠时跳过（否则会删掉库内源目录）
        if let Ok(source) = Self::skill_storage_dir(db, record) {
            if Self::paths_overlap(&source, &dest) {
                log::warn!(
                    "工具 {} 的技能目录与技能库路径重叠，跳过移除: {} <-> {}",
                    tool.id,
                    source.display(),
                    dest.display()
                );
                return Ok(());
            }
        }
        if dest.exists() || Self::is_symlink(&dest) {
            Self::remove_path(&dest)?;
        }
        Ok(())
    }

    /// 从工具的全局技能目录移除技能
    pub fn remove_from_tool(db: &Database, record: &SkillRecord, tool: &ToolAdapter) -> Result<()> {
        let root = Self::tool_root(tool)?;
        Self::remove_from_tool_at(db, record, tool, &root)
    }

    /// 统一安装入口（GitHub 仓库 / skills.sh 注册表坐标）
    pub async fn install_unified(
        db: &Database,
        input: InstallSkillInput,
        scope: &str,
        project_id: Option<&str>,
        tool_ids: Vec<String>,
        deploy_method: Option<&str>,
    ) -> Result<SkillRecord> {
        let repo_raw = input
            .repo
            .clone()
            .filter(|r| !r.trim().is_empty())
            .ok_or_else(|| {
                anyhow!(format_skill_error(
                    "INVALID_REPO_REF",
                    &[("repo", input.repo.as_deref().unwrap_or(""))],
                    Some("checkRepoUrl"),
                ))
            })?;

        // repo 允许 "owner/repo" 或 "owner/repo/sub/path"
        let segments: Vec<&str> = repo_raw.split('/').filter(|s| !s.is_empty()).collect();
        if segments.len() < 2 {
            return Err(anyhow!(format_skill_error(
                "INVALID_REPO_REF",
                &[("repo", &repo_raw)],
                Some("checkRepoUrl"),
            )));
        }
        let owner = segments[0].to_string();
        let repo_name = segments[1].trim_end_matches(".git").to_string();
        let embedded_subpath = if segments.len() > 2 {
            Some(segments[2..].join("/"))
        } else {
            None
        };
        let branch = input
            .branch
            .clone()
            .filter(|b| !b.trim().is_empty())
            .unwrap_or_else(|| "main".to_string());
        Self::validate_repo_ref(&owner, &repo_name, &branch)?;

        // 仓库内目录：directory > subpath > repo 内嵌子路径 > registry_id > name
        let directory_raw = input
            .directory
            .clone()
            .or(input.subpath.clone())
            .or(embedded_subpath)
            .or(input.registry_id.clone())
            .or(input.name.clone())
            .ok_or_else(|| {
                anyhow!(format_skill_error(
                    "INVALID_SKILL_DIRECTORY",
                    &[("directory", "")],
                    Some("checkZipContent"),
                ))
            })?;
        let source_rel = Self::sanitize_skill_source_path(&directory_raw).ok_or_else(|| {
            anyhow!(format_skill_error(
                "INVALID_SKILL_DIRECTORY",
                &[("directory", &directory_raw)],
                Some("checkZipContent"),
            ))
        })?;
        // 安装目录名始终使用最后一段
        let install_name = source_rel
            .file_name()
            .and_then(|name| Self::sanitize_install_name(&name.to_string_lossy()))
            .ok_or_else(|| {
                anyhow!(format_skill_error(
                    "INVALID_SKILL_DIRECTORY",
                    &[("directory", &directory_raw)],
                    Some("checkZipContent"),
                ))
            })?;
        let directory = source_rel.to_string_lossy().replace('\\', "/");
        let source_type = match input.source_type.as_deref() {
            Some("skills_sh") => "skills_sh",
            _ => "github", // featured / github 统一归一为 github
        }
        .to_string();

        let repo = SkillRepo {
            owner: owner.clone(),
            name: repo_name.clone(),
            branch: branch.clone(),
            enabled: true,
        };

        // ========== 项目级作用域 ==========
        if scope == SKILL_SCOPE_PROJECT {
            let project = Self::resolve_project(db, project_id)?;
            let project_deploy_method = match deploy_method {
                Some("symlink") => "symlink",
                Some("copy") => "copy",
                _ => "auto",
            };
            return Self::install_to_project(
                db,
                &input,
                &repo,
                &directory,
                &install_name,
                &source_type,
                &project,
                &tool_ids,
                project_deploy_method,
            )
            .await;
        }

        // ========== 全局作用域 ==========
        let enabled_tools = Self::validated_tool_ids(db, &tool_ids)?;

        // 下载前快速冲突检查（写锁内还会复查）
        {
            let existing_skills = db.get_all_skills()?;
            if let Some(reused) = Self::reuse_global_install(
                db,
                &existing_skills,
                &install_name,
                &format!("{owner}/{repo_name}"),
                &enabled_tools,
            )? {
                return Ok(reused);
            }
        }

        // 下载仓库（网络 I/O 期间不持有状态锁）
        let (temp_guard, used_branch) = github::download_repo_with_timeout(&repo).await?;
        let temp_dir = temp_guard.path();

        let source = Self::resolve_skill_source_dir(temp_dir, &directory)?
            .ok_or_else(|| {
                let missing = temp_dir.join(&source_rel).display().to_string();
                anyhow!(format_skill_error(
                    "SKILL_DIR_NOT_FOUND",
                    &[("path", &missing)],
                    Some("checkRepoUrl"),
                ))
            })?;
        let canonical_temp = temp_dir
            .canonicalize()
            .unwrap_or_else(|_| temp_dir.to_path_buf());
        let canonical_source = source.canonicalize().map_err(|_| {
            anyhow!(format_skill_error(
                "SKILL_DIR_NOT_FOUND",
                &[("path", &source.display().to_string())],
                Some("checkRepoUrl"),
            ))
        })?;
        if !canonical_source.starts_with(&canonical_temp) || !canonical_source.is_dir() {
            return Err(anyhow!(format_skill_error(
                "INVALID_SKILL_DIRECTORY",
                &[("directory", &directory)],
                Some("checkZipContent"),
            )));
        }
        let doc_path = github::doc_path_for_source(&canonical_temp, &canonical_source)
            .unwrap_or_else(|| format!("{}/SKILL.md", directory.trim_end_matches('/')));
        let source_url = github::build_skill_doc_url(&owner, &repo_name, &used_branch, &doc_path);

        // 最新 commit 也属网络 I/O，在拿锁前完成
        let current_commit =
            github::fetch_latest_commit(&owner, &repo_name, &used_branch).await;

        // 落盘 + 入库在同一临界区
        let _guard = state_write_guard();
        let existing_skills = db.get_all_skills()?;
        if let Some(reused) = Self::reuse_global_install(
            db,
            &existing_skills,
            &install_name,
            &format!("{owner}/{repo_name}"),
            &enabled_tools,
        )? {
            return Ok(reused);
        }

        let library = Self::get_library_dir(db)?;
        let dest = library.join(&install_name);
        if dest.exists() || Self::is_symlink(&dest) {
            Self::remove_path(&dest)?;
        }
        Self::copy_dir_recursive(&canonical_source, &dest)?;

        let content_hash = Self::compute_dir_hash(&dest).map(Some).unwrap_or_else(|e| {
            log::warn!("Failed to compute content hash for {install_name}: {e}");
            None
        });

        // SKILL.md frontmatter 覆盖名称与描述
        let skill_md = dest.join("SKILL.md");
        let (meta_name, meta_desc) = Self::read_skill_name_desc(&skill_md, &install_name);

        let now = chrono::Utc::now().timestamp();
        let record = SkillRecord {
            id: format!("{owner}/{repo_name}:{directory}"),
            name: meta_name.clone(),
            display_name: input
                .display_name
                .clone()
                .filter(|d| !d.trim().is_empty())
                .unwrap_or(meta_name),
            description: meta_desc.or(input.description.clone()),
            display_description: None,
            description_status: "pending".to_string(),
            directory: install_name.clone(),
            tags: input.tags.clone().unwrap_or_default(),
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_id: None,
            project_path: None,
            source_type,
            source_repo: Some(format!("{owner}/{repo_name}")),
            source_branch: Some(used_branch.clone()),
            source_subpath: (directory != install_name).then_some(directory.clone()),
            source_author: input.author.clone().or(Some(owner.clone())),
            source_registry_id: input.registry_id.clone(),
            source_url,
            source_github_detected: false,
            current_commit,
            latest_commit: None,
            has_update: false,
            content_hash,
            enabled_tools: enabled_tools.clone(),
            deploy_method: deploy_method.unwrap_or("auto").to_string(),
            installed_at: now,
            updated_at: 0,
            author: input.author.clone().or(Some(owner.clone())),
            license: None,
        };

        db.save_skill(&record)?;

        // 逐工具部署：全部失败则回滚（删记录 + 删目录）
        let deployed = Self::deploy_to_tools(db, &record, &enabled_tools);
        if !enabled_tools.is_empty() && deployed.is_empty() {
            if let Err(err) = db.delete_skill(&record.id) {
                log::warn!("部署失败回滚：删除技能记录 {} 失败: {err}", record.id);
            }
            if let Err(err) = fs::remove_dir_all(&dest) {
                log::warn!("部署失败回滚：删除目录 {} 失败: {err}", dest.display());
            }
            return Err(anyhow!(format_skill_error(
                "DEPLOY_FAILED",
                &[("skill", &install_name)],
                Some("checkToolPath"),
            )));
        }
        if deployed.len() != enabled_tools.len() {
            db.update_skill_enabled_tools(&record.id, &deployed)?;
        }
        let mut record = record;
        record.enabled_tools = deployed;

        log::info!("Skill {} 安装成功", record.name);
        Ok(record)
    }

    /// 全局安装冲突处理：同 directory 同仓库 → 复用并补分发；异仓库 → 冲突错误
    fn reuse_global_install(
        db: &Database,
        existing_skills: &IndexMap<String, SkillRecord>,
        install_name: &str,
        repo_full: &str,
        tool_ids: &[String],
    ) -> Result<Option<SkillRecord>> {
        for existing in existing_skills.values() {
            // 项目级与全局安装相互独立
            if existing.is_project() {
                continue;
            }
            if !existing.directory.eq_ignore_ascii_case(install_name) {
                continue;
            }
            let same_repo = existing.source_repo.as_deref() == Some(repo_full)
                || (existing.source_repo.is_none() && repo_full == "local");
            if same_repo {
                let mut updated = existing.clone();
                let mut added = Vec::new();
                for tool_id in tool_ids {
                    if !updated.enabled_tools.contains(tool_id) {
                        updated.enabled_tools.push(tool_id.clone());
                        added.push(tool_id.clone());
                    }
                }
                if !added.is_empty() {
                    let deployed = Self::deploy_to_tools(db, &updated, &added);
                    updated.enabled_tools.retain(|id| {
                        existing.enabled_tools.contains(id) || deployed.contains(id)
                    });
                    db.update_skill_enabled_tools(&updated.id, &updated.enabled_tools)?;
                }
                log::info!("Skill {} 已存在，补充工具分发状态", updated.name);
                return Ok(Some(updated));
            }
            return Err(anyhow!(format_skill_error(
                "SKILL_DIRECTORY_CONFLICT",
                &[
                    ("directory", install_name),
                    (
                        "existing_repo",
                        existing.source_repo.as_deref().unwrap_or("local"),
                    ),
                    ("new_repo", repo_full),
                ],
                Some("uninstallFirst"),
            )));
        }
        Ok(None)
    }

    /// 部署到一组工具，返回部署成功的工具 id（单个失败仅记日志）
    fn deploy_to_tools(db: &Database, record: &SkillRecord, tool_ids: &[String]) -> Vec<String> {
        let mut deployed = Vec::new();
        for tool_id in tool_ids {
            let tool = match db.get_tool_adapter(tool_id) {
                Ok(Some(tool)) => tool,
                _ => continue,
            };
            // 项目级技能分发到项目内目录；全局技能分发到工具全局目录
            let result = if record.is_project() {
                match record
                    .project_path
                    .as_deref()
                    .and_then(|p| Self::project_tool_root(&tool, p))
                {
                    Some(dest_root) => Self::deploy_to_tool_at(db, record, &tool, &dest_root),
                    None => {
                        log::warn!(
                            "工具 {} 未配置项目内技能目录，跳过部署（可在「AI 工具」页配置）",
                            tool.id
                        );
                        continue;
                    }
                }
            } else {
                Self::deploy_to_tool(db, record, &tool)
            };
            match result {
                Ok(()) => deployed.push(tool_id.clone()),
                Err(err) => {
                    log::warn!("部署 Skill {} 到工具 {} 失败: {err}", record.id, tool_id)
                }
            }
        }
        deployed
    }

    /// 安装到项目目录：文件落 `<project>/.claude/skills/<name>`，
    /// 并在 `<project>/skills/<name>` 建链接（symlink 优先，按同步方式回退 copy）
    async fn install_to_project(
        db: &Database,
        input: &InstallSkillInput,
        repo: &SkillRepo,
        directory: &str,
        install_name: &str,
        source_type: &str,
        project: &(i64, String, String, i64),
        tool_ids: &[String],
        deploy_method: &str,
    ) -> Result<SkillRecord> {
        let project_root = PathBuf::from(&project.2);
        if !project_root.is_dir() {
            return Err(anyhow!("项目目录不存在或不是目录: {}", project.2));
        }
        let project_key = project.2.clone();
        let repo_full = format!("{}/{}", repo.owner, repo.name);

        // 下载前快速冲突检查
        {
            let existing_skills = db.get_all_skills()?;
            Self::ensure_no_global_conflict(existing_skills.values(), install_name)?;
            if let Some(existing) =
                Self::find_project_install(existing_skills.values(), &project_key, install_name)
            {
                return Self::resolve_project_reinstall(existing, Some(&repo_full));
            }
        }

        let (temp_guard, used_branch) = github::download_repo_with_timeout(repo).await?;
        let temp_dir = temp_guard.path();
        let source = Self::resolve_skill_source_dir(temp_dir, directory)?.ok_or_else(|| {
            anyhow!(format_skill_error(
                "SKILL_DIR_NOT_FOUND",
                &[("path", &temp_dir.join(directory).display().to_string())],
                Some("checkRepoUrl"),
            ))
        })?;
        let canonical_temp = temp_dir
            .canonicalize()
            .unwrap_or_else(|_| temp_dir.to_path_buf());
        let canonical_source = source.canonicalize().map_err(|_| {
            anyhow!(format_skill_error(
                "SKILL_DIR_NOT_FOUND",
                &[("path", &source.display().to_string())],
                Some("checkRepoUrl"),
            ))
        })?;
        if !canonical_source.starts_with(&canonical_temp) || !canonical_source.is_dir() {
            return Err(anyhow!(format_skill_error(
                "INVALID_SKILL_DIRECTORY",
                &[("directory", directory)],
                Some("checkZipContent"),
            )));
        }
        let doc_path = github::doc_path_for_source(&canonical_temp, &canonical_source)
            .unwrap_or_else(|| format!("{}/SKILL.md", directory.trim_end_matches('/')));
        let source_url =
            github::build_skill_doc_url(&repo.owner, &repo.name, &used_branch, &doc_path);
        let current_commit =
            github::fetch_latest_commit(&repo.owner, &repo.name, &used_branch).await;

        // 网络 I/O 结束，冲突复查 + 落盘 + 入库同一临界区
        let _guard = state_write_guard();
        // 记录用户安装时选择的工具；安装时按各工具的项目内目录实际分发
        let enabled_tools = Self::validated_tool_ids(db, tool_ids)?;
        Self::install_dir_to_project(
            db,
            project,
            &canonical_source,
            install_name,
            ProjectInstallMeta {
                directory: directory.to_string(),
                source_type: source_type.to_string(),
                source_repo: Some(repo_full),
                source_branch: Some(used_branch),
                source_subpath: (directory != install_name).then_some(directory.to_string()),
                source_author: input.author.clone().or(Some(repo.owner.clone())),
                source_registry_id: input.registry_id.clone(),
                source_url,
                source_github_detected: false,
                current_commit,
                display_name: input
                    .display_name
                    .clone()
                    .filter(|d| !d.trim().is_empty()),
                input_description: input.description.clone(),
                tags: input.tags.clone().unwrap_or_default(),
                enabled_tools,
                deploy_method: deploy_method.to_string(),
            },
        )
    }

    /// 项目级安装前置守卫：同名全局 Skill 会与项目链接互相覆盖，必须拒绝
    fn ensure_no_global_conflict<'a>(
        skills: impl IntoIterator<Item = &'a SkillRecord>,
        install_name: &str,
    ) -> Result<()> {
        if let Some(existing) = skills
            .into_iter()
            .find(|s| !s.is_project() && s.directory.eq_ignore_ascii_case(install_name))
        {
            return Err(anyhow!("{SKILL_GLOBAL_CONFLICT_PREFIX}{}", existing.name));
        }
        Ok(())
    }

    /// 查找同一项目下同名（忽略大小写）的项目级安装记录
    fn find_project_install<'a>(
        skills: impl IntoIterator<Item = &'a SkillRecord>,
        project_path: &str,
        install_name: &str,
    ) -> Option<&'a SkillRecord> {
        skills.into_iter().find(|s| {
            s.is_project()
                && s.project_path.as_deref() == Some(project_path)
                && s.directory.eq_ignore_ascii_case(install_name)
        })
    }

    /// 同项目同目录的重装：同来源直接复用记录；异来源的目录拒绝覆盖
    fn resolve_project_reinstall(
        existing: &SkillRecord,
        repo_full: Option<&str>,
    ) -> Result<SkillRecord> {
        if existing.source_repo.as_deref() == repo_full {
            log::info!("Skill {} 在该项目中已安装，直接复用", existing.name);
            return Ok(existing.clone());
        }
        Err(anyhow!(format_skill_error(
            "SKILL_DIRECTORY_CONFLICT",
            &[
                ("directory", &existing.directory),
                (
                    "existing_repo",
                    existing.source_repo.as_deref().unwrap_or("local"),
                ),
                ("new_repo", repo_full.unwrap_or("local")),
            ],
            Some("uninstallFirst"),
        )))
    }

    /// 项目级 Skill 的入库 id：基准 `owner/repo:directory`，冲突时追加项目路径哈希后缀
    fn project_skill_id(
        base_key: &str,
        existing_skills: &IndexMap<String, SkillRecord>,
        normalized_project_path: &str,
    ) -> String {
        if !existing_skills.contains_key(base_key) {
            return base_key.to_string();
        }
        use sha2::{Digest, Sha256};
        let hash = format!("{:x}", Sha256::digest(normalized_project_path.as_bytes()));
        format!("{base_key}#project:{}", &hash[..8])
    }

    /// 校验项目级安装目标，返回已注册的项目记录
    fn resolve_project(
        db: &Database,
        project_id: Option<&str>,
    ) -> Result<(i64, String, String, i64)> {
        let id = project_id
            .ok_or_else(|| anyhow!("项目级安装缺少 project_id"))?
            .parse::<i64>()
            .map_err(|_| anyhow!("无效的 project_id"))?;
        let project = db
            .get_skill_project(id)?
            .ok_or_else(|| anyhow!("项目未注册: {id}"))?;
        if !PathBuf::from(&project.2).is_dir() {
            return Err(anyhow!("项目目录不存在或不是目录: {}", project.2));
        }
        Ok(project)
    }

    /// 将本地目录安装到项目作用域（.claude/skills 实体 + skills/ 链接，写 skills 表）。
    /// 调用方必须已持有 state_write_guard()（本函数自身不加锁，避免同线程重入死锁）。
    fn install_dir_to_project(
        db: &Database,
        project: &(i64, String, String, i64),
        source: &Path,
        install_name: &str,
        meta: ProjectInstallMeta,
    ) -> Result<SkillRecord> {
        let project_key = project.2.clone();

        // 冲突复查 + 落盘 + 入库同一临界区（调用方持写锁）
        let existing_skills = db.get_all_skills()?;
        Self::ensure_no_global_conflict(existing_skills.values(), install_name)?;
        if let Some(existing) =
            Self::find_project_install(existing_skills.values(), &project_key, install_name)
        {
            return Self::resolve_project_reinstall(existing, meta.source_repo.as_deref());
        }
        let base_key = match &meta.source_repo {
            Some(repo_full) => format!("{repo_full}:{}", meta.directory),
            None => format!("local:{}", meta.directory),
        };
        let id = Self::project_skill_id(&base_key, &existing_skills, &project_key);

        // 原文件落中央库命名空间（复用原子替换；失败即 Err，不动 DB）
        let storage_dir = Self::get_library_dir(db)?
            .join("projects")
            .join(Self::project_storage_namespace(&project_key))
            .join(install_name);
        if storage_dir.exists() || Self::is_symlink(&storage_dir) {
            return Err(anyhow!(
                "项目技能在中央库中已存在，拒绝覆盖: {}",
                storage_dir.display()
            ));
        }
        Self::replace_dest_with_copy(source, &storage_dir, install_name)?;

        // 筛选出实际参与分发的工具：已启用且配置了项目内技能目录
        let tools = db.list_tool_adapters()?;
        let deploy_tools: Vec<ToolAdapter> = tools
            .into_iter()
            .filter(|t| t.is_enabled && meta.enabled_tools.iter().any(|id| id == &t.id))
            .collect();
        let deployed_tool_ids: Vec<String> = deploy_tools
            .iter()
            .filter(|t| Self::project_tool_root(t, &project_key).is_some())
            .map(|t| t.id.clone())
            .collect();

        // 先构造记录（未落库）：deploy_to_tool_at 需要按 record 解析存储目录与部署方式
        let content_hash = Self::compute_dir_hash(&storage_dir).ok();
        let skill_md = storage_dir.join("SKILL.md");
        let (meta_name, meta_desc) = Self::read_skill_name_desc(&skill_md, install_name);

        let now = chrono::Utc::now().timestamp();
        let record = SkillRecord {
            id,
            name: meta_name.clone(),
            display_name: meta.display_name.clone().unwrap_or(meta_name),
            description: meta_desc.or(meta.input_description.clone()),
            display_description: None,
            description_status: "pending".to_string(),
            directory: install_name.to_string(),
            tags: meta.tags.clone(),
            scope: SKILL_SCOPE_PROJECT.to_string(),
            project_id: Some(project.0.to_string()),
            project_path: Some(project_key.clone()),
            source_type: meta.source_type.clone(),
            source_repo: meta.source_repo.clone(),
            source_branch: meta.source_branch.clone(),
            source_subpath: meta.source_subpath.clone(),
            source_author: meta.source_author.clone(),
            source_registry_id: meta.source_registry_id.clone(),
            source_url: meta.source_url.clone(),
            source_github_detected: meta.source_github_detected,
            current_commit: meta.current_commit.clone(),
            latest_commit: None,
            has_update: false,
            content_hash,
            enabled_tools: deployed_tool_ids,
            deploy_method: meta.deploy_method.clone(),
            installed_at: now,
            updated_at: 0,
            author: meta.source_author.clone(),
            license: None,
        };

        // 按选择分发到各工具的项目内技能目录（symlink / copy / auto 随部署方式）。
        // 悬空 symlink 可安全覆盖；普通文件按外来内容拒绝（inspect_destination 语义），
        // 绝不误删用户放在项目技能目录里的文件
        let mut deployed: Vec<PathBuf> = Vec::new();
        let deploy_result: Result<()> = (|| {
            for tool in &deploy_tools {
                let Some(dest_root) = Self::project_tool_root(tool, &project_key) else {
                    log::warn!(
                        "工具 {} 未配置项目内技能目录，跳过项目级分发（可在「AI 工具」页配置）",
                        tool.id
                    );
                    continue;
                };
                let dest = dest_root.join(install_name);
                Self::deploy_to_tool_at(db, &record, tool, &dest_root)?;
                deployed.push(dest);
            }
            Ok(())
        })();
        if let Err(err) = deploy_result {
            // 分发失败整体回滚：删已部署条目 + 删中央库原文件，不留半成品
            for dest in deployed.iter().rev() {
                if let Err(clean_err) = Self::remove_path(dest) {
                    log::warn!("分发失败回滚：移除 {} 失败: {clean_err}", dest.display());
                }
            }
            if let Err(clean_err) = Self::remove_path(&storage_dir) {
                log::warn!(
                    "分发失败回滚：删除中央库原文件 {} 失败: {clean_err}",
                    storage_dir.display()
                );
            }
            return Err(err);
        }

        if let Err(err) = db.save_skill(&record) {
            for dest in deployed.iter().rev() {
                if let Err(clean_err) = Self::remove_path(dest) {
                    log::warn!("保存失败回滚：移除 {} 失败: {clean_err}", dest.display());
                }
            }
            if let Err(clean_err) = Self::remove_path(&storage_dir) {
                log::warn!(
                    "保存失败回滚：删除中央库原文件 {} 失败: {clean_err}",
                    storage_dir.display()
                );
            }
            return Err(err.into());
        }

        log::info!(
            "Skill {} 已安装到项目 {}（原文件入中央库，已分发 {} 个工具）",
            record.name,
            project_key,
            deployed.len()
        );
        Ok(record)
    }

    /// 把扫描出的技能目录安装到项目作用域（ZIP / URL-ZIP 项目级共用）。
    /// 同名复用/冲突处理由 install_dir_to_project 内部完成。
    fn install_scanned_dir_to_project(
        db: &Database,
        project: &(i64, String, String, i64),
        skill_dir: &Path,
        temp_root: &Path,
        zip_stem: Option<&str>,
        source_type: &str,
        source_url: Option<&str>,
        tool_ids: &[String],
        deploy_method: Option<&str>,
    ) -> Result<Option<SkillRecord>> {
        let skill_md = skill_dir.join("SKILL.md");
        let meta = if skill_md.exists() {
            Self::parse_skill_metadata_static(&skill_md).ok()
        } else {
            None
        };
        let install_name = Self::derive_scanned_install_name(
            skill_dir,
            temp_root,
            zip_stem,
            meta.as_ref(),
        )?;
        let record = Self::install_dir_to_project(
            db,
            project,
            skill_dir,
            &install_name,
            ProjectInstallMeta {
                directory: install_name.clone(),
                source_type: source_type.to_string(),
                source_repo: None,
                source_branch: None,
                source_subpath: None,
                source_author: None,
                source_registry_id: None,
                source_url: source_url.map(|u| u.to_string()),
                source_github_detected: false,
                current_commit: None,
                display_name: None,
                input_description: None,
                tags: vec![],
                enabled_tools: Self::validated_tool_ids(db, tool_ids)?,
                deploy_method: deploy_method.unwrap_or("auto").to_string(),
            },
        )?;
        Ok(Some(record))
    }

    /// 扫描目录的安装名回退链：目录名 → 元数据 name → ZIP 文件名
    fn derive_scanned_install_name(
        skill_dir: &Path,
        temp_root: &Path,
        zip_stem: Option<&str>,
        meta: Option<&SkillMetadata>,
    ) -> Result<String> {
        let dir_name = skill_dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let install_name = if skill_dir == temp_root || dir_name.is_empty() || dir_name.starts_with('.')
        {
            meta.and_then(|m| m.name.as_deref())
                .and_then(Self::sanitize_install_name)
                .or_else(|| zip_stem.and_then(Self::sanitize_install_name))
        } else {
            Self::sanitize_install_name(&dir_name)
                .or_else(|| {
                    meta.and_then(|m| m.name.as_deref())
                        .and_then(Self::sanitize_install_name)
                })
                .or_else(|| zip_stem.and_then(Self::sanitize_install_name))
        };
        install_name.ok_or_else(|| {
            anyhow!(format_skill_error(
                "INVALID_SKILL_DIRECTORY",
                &[("path", &skill_dir.display().to_string())],
                Some("checkZipContent"),
            ))
        })
    }

    /// 从本地 ZIP 文件安装（可含多个技能）
    pub fn install_from_zip(
        db: &Database,
        zip_path: &Path,
        tool_ids: Vec<String>,
        deploy_method: Option<&str>,
        scope: Option<&str>,
        project_id: Option<&str>,
    ) -> Result<Vec<SkillRecord>> {
        let temp_guard = Self::extract_local_zip(zip_path)?;
        let temp_dir = temp_guard.path();
        let skill_dirs = Self::scan_skills_in_dir(temp_dir)?;
        if skill_dirs.is_empty() {
            return Err(anyhow!(format_skill_error(
                "NO_SKILLS_IN_ZIP",
                &[],
                Some("checkZipContent"),
            )));
        }

        // 项目级作用域：先校验项目，再在写锁内逐目录安装
        let project = if scope == Some(SKILL_SCOPE_PROJECT) {
            Some(Self::resolve_project(db, project_id)?)
        } else {
            None
        };

        let _guard = state_write_guard();
        let zip_stem = zip_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());

        let mut installed = Vec::new();
        for skill_dir in skill_dirs {
            let record = match &project {
                Some(project) => Self::install_scanned_dir_to_project(
                    db,
                    project,
                    &skill_dir,
                    temp_dir,
                    zip_stem.as_deref(),
                    "local",
                    None,
                    &tool_ids,
                    deploy_method,
                )?,
                None => Self::install_scanned_dir(
                    db,
                    &skill_dir,
                    temp_dir,
                    zip_stem.as_deref(),
                    "local",
                    None,
                    &tool_ids,
                    deploy_method,
                )?,
            };
            if let Some(record) = record {
                installed.push(record);
            }
        }
        if installed.is_empty() {
            return Err(anyhow!(format_skill_error(
                "NO_SKILLS_IN_ZIP",
                &[],
                Some("checkZipContent"),
            )));
        }
        Ok(installed)
    }

    /// 把扫描出的技能目录复制进中央库并入库（ZIP / URL-ZIP 共用）。
    /// 同名冲突跳过返回 None。
    #[allow(clippy::too_many_arguments)]
    fn install_scanned_dir(
        db: &Database,
        skill_dir: &Path,
        temp_root: &Path,
        zip_stem: Option<&str>,
        source_type: &str,
        source_url: Option<&str>,
        tool_ids: &[String],
        deploy_method: Option<&str>,
    ) -> Result<Option<SkillRecord>> {
        let skill_md = skill_dir.join("SKILL.md");
        let meta = if skill_md.exists() {
            Self::parse_skill_metadata_static(&skill_md).ok()
        } else {
            None
        };
        let install_name =
            Self::derive_scanned_install_name(skill_dir, temp_root, zip_stem, meta.as_ref())?;

        // 同名冲突跳过
        let existing_skills = db.get_all_skills()?;
        if existing_skills
            .values()
            .any(|s| s.directory.eq_ignore_ascii_case(&install_name))
        {
            log::warn!("Skill directory '{install_name}' already exists, skipping");
            return Ok(None);
        }

        let enabled_tools = Self::validated_tool_ids(db, tool_ids)?;

        let library = Self::get_library_dir(db)?;
        let dest = library.join(&install_name);
        if dest.exists() || Self::is_symlink(&dest) {
            Self::remove_path(&dest)?;
        }
        Self::copy_dir_recursive(skill_dir, &dest)?;
        let content_hash = Self::compute_dir_hash(&dest).ok();
        let (name, description) = match meta {
            Some(m) => (
                m.name.unwrap_or_else(|| install_name.clone()),
                m.description,
            ),
            None => (install_name.clone(), None),
        };

        let now = chrono::Utc::now().timestamp();
        let record = SkillRecord {
            id: format!("local:{install_name}"),
            name: name.clone(),
            display_name: name,
            description,
            display_description: None,
            description_status: "pending".to_string(),
            directory: install_name.clone(),
            tags: vec![],
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_id: None,
            project_path: None,
            source_type: source_type.to_string(),
            source_repo: None,
            source_branch: None,
            source_subpath: None,
            source_author: None,
            source_registry_id: None,
            source_url: source_url.map(|u| u.to_string()),
            source_github_detected: false,
            current_commit: None,
            latest_commit: None,
            has_update: false,
            content_hash,
            enabled_tools: enabled_tools.clone(),
            deploy_method: deploy_method.unwrap_or("auto").to_string(),
            installed_at: now,
            updated_at: 0,
            author: None,
            license: None,
        };
        db.save_skill(&record)?;

        let deployed = Self::deploy_to_tools(db, &record, &enabled_tools);
        if !enabled_tools.is_empty() && deployed.is_empty() {
            if let Err(err) = db.delete_skill(&record.id) {
                log::warn!("部署失败回滚：删除技能记录 {} 失败: {err}", record.id);
            }
            if let Err(err) = fs::remove_dir_all(&dest) {
                log::warn!("部署失败回滚：删除目录 {} 失败: {err}", dest.display());
            }
            return Err(anyhow!(format_skill_error(
                "DEPLOY_FAILED",
                &[("skill", &install_name)],
                Some("checkToolPath"),
            )));
        }
        if deployed.len() != enabled_tools.len() {
            db.update_skill_enabled_tools(&record.id, &deployed)?;
        }
        let mut record = record;
        record.enabled_tools = deployed;
        Ok(Some(record))
    }

    /// 导入本地技能目录（必须含 SKILL.md；识别 .git 里的 GitHub 来源）
    /// git 识别失败时，按目录名在 skills.sh 注册表精确匹配来源（联网；失败/无匹配 → 纯本地）。
    /// 目录名未命中时，再用 SKILL.md frontmatter 的技能名匹配一次（安装目录名可能是仓库名而非技能注册名）。
    /// 返回 (repo "owner/repo", registry_id)。
    async fn match_registry_source(install_name: &str, skill_name: Option<&str>) -> Option<(String, String)> {
        // 测试环境（SKILLDOCK_TEST_HOME 隔离 home）不做联网匹配，保证测试离线确定性；
        // 与 config.rs 一致，仅 debug 构建响应该变量
        #[cfg(debug_assertions)]
        if std::env::var("SKILLDOCK_TEST_HOME")
            .map(|v| !v.is_empty())
            .unwrap_or(false)
        {
            return None;
        }
        if let Some(found) = Self::match_registry_source_by_key(install_name).await {
            return Some(found);
        }
        // 目录名未命中时退回技能名（如目录名是仓库名 taste-skill，而注册名是 design-taste-frontend）
        match skill_name {
            Some(name) if !name.eq_ignore_ascii_case(install_name) => {
                Self::match_registry_source_by_key(name).await
            }
            _ => None,
        }
    }

    /// 按单个键（目录名或技能名）在 skills.sh 注册表精确匹配来源仓库
    async fn match_registry_source_by_key(key: &str) -> Option<(String, String)> {
        let result = crate::services::registry::search_skills_sh(key, 20, 0, &HashSet::new())
            .await
            .map_err(|e| log::warn!("skills.sh 来源匹配失败（保持纯本地）: {e}"))
            .ok()?;
        let matched = result
            .skills
            .into_iter()
            .find(|s| s.name.eq_ignore_ascii_case(key) || s.display_name.eq_ignore_ascii_case(key))?;
        let repo = matched.repo.clone()?;
        log::info!("本地技能「{key}」匹配到 skills.sh 来源: {repo}");
        Some((repo, matched.id))
    }

    /// 回填无来源技能的 skills.sh 注册表来源（联网逐条精确匹配；失败/无匹配保持纯本地）。
    /// 覆盖存量 local/url_zip 技能，返回成功回填的条数。
    pub async fn backfill_skill_sources(db: &Database) -> Result<usize> {
        let candidates: Vec<SkillRecord> = db
            .get_all_skills()?
            .into_values()
            .filter(|r| {
                (r.source_type == "local" || r.source_type == "url_zip") && r.source_repo.is_none()
            })
            .collect();
        let mut updated = 0;
        for mut record in candidates {
            if let Some((repo, registry_id)) =
                Self::match_registry_source(&record.directory, Some(&record.name)).await
            {
                record.source_type = "skills_sh".to_string();
                record.source_author = repo.split('/').next().map(|s| s.to_string());
                record.source_registry_id = Some(registry_id);
                record.source_url = Some(format!("https://github.com/{repo}"));
                record.source_repo = Some(repo);
                db.save_skill(&record)?;
                updated += 1;
            }
        }
        Ok(updated)
    }

    pub async fn import_local(
        db: &Database,
        dir_path: &str,
        tool_ids: Vec<String>,
        deploy_method: Option<&str>,
        scope: Option<&str>,
        project_id: Option<&str>,
    ) -> Result<SkillRecord> {
        let source_dir = config::expand_tilde(dir_path)?;
        if !source_dir.is_dir() {
            return Err(anyhow!("目录不存在或不是目录: {dir_path}"));
        }
        if !source_dir.join("SKILL.md").is_file() {
            return Err(anyhow!(format_skill_error(
                "SKILL_DIR_NOT_FOUND",
                &[("path", &source_dir.display().to_string())],
                Some("checkSkillDir"),
            )));
        }
        let dir_name = source_dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or_else(|| anyhow!("无法解析目录名: {dir_path}"))?;
        let install_name = Self::sanitize_install_name(&dir_name).ok_or_else(|| {
            anyhow!(format_skill_error(
                "INVALID_SKILL_DIRECTORY",
                &[("directory", &dir_name)],
                Some("checkZipContent"),
            ))
        })?;

        // git 来源识别（全局/项目级分支共用）
        let git_info = git_detect::detect_github_source(&source_dir);
        // git 识别失败时，联网在 skills.sh 注册表按目录名（必要时退回 SKILL.md 技能名）精确匹配原作者仓库（失败保持纯本地）
        let registry_match = if git_info.is_none() {
            let skill_name = Self::parse_skill_metadata_static(&source_dir.join("SKILL.md"))
                .ok()
                .and_then(|m| m.name);
            Self::match_registry_source(&install_name, skill_name.as_deref()).await
        } else {
            None
        };

        // 项目级作用域：复制到项目技能目录并入库
        if scope == Some(SKILL_SCOPE_PROJECT) {
            let project = Self::resolve_project(db, project_id)?;
            let _guard = state_write_guard();
            return Self::install_dir_to_project(
                db,
                &project,
                &source_dir,
                &install_name,
                ProjectInstallMeta {
                    directory: install_name.clone(),
                    source_type: if registry_match.is_some() {
                        "skills_sh".to_string()
                    } else {
                        "local".to_string()
                    },
                    source_repo: git_info
                        .as_ref()
                        .map(|i| i.repo.clone())
                        .or_else(|| registry_match.as_ref().map(|(repo, _)| repo.clone())),
                    source_branch: git_info.as_ref().and_then(|i| i.branch.clone()),
                    source_subpath: None,
                    source_author: git_info
                        .as_ref()
                        .and_then(|i| i.repo.split('/').next().map(|s| s.to_string()))
                        .or_else(|| {
                            registry_match
                                .as_ref()
                                .and_then(|(repo, _)| repo.split('/').next().map(|s| s.to_string()))
                        }),
                    source_registry_id: registry_match
                        .as_ref()
                        .map(|(_, registry_id)| registry_id.clone()),
                    source_url: git_info.as_ref().map(|i| i.url.clone()).or_else(|| {
                        registry_match
                            .as_ref()
                            .map(|(repo, _)| format!("https://github.com/{repo}"))
                    }),
                    source_github_detected: git_info.is_some(),
                    current_commit: git_info.as_ref().and_then(|i| i.commit.clone()),
                    display_name: None,
                    input_description: None,
                    tags: vec![],
                    enabled_tools: vec![],
                    deploy_method: "auto".to_string(),
                },
            );
        }

        let _guard = state_write_guard();
        let enabled_tools = Self::validated_tool_ids(db, &tool_ids)?;

        // 同名已存在 → 补充工具分发后复用
        {
            let existing_skills = db.get_all_skills()?;
            if let Some(existing) = existing_skills
                .values()
                .find(|s| !s.is_project() && s.directory.eq_ignore_ascii_case(&install_name))
            {
                let mut updated = existing.clone();
                let mut added = Vec::new();
                for tool_id in &enabled_tools {
                    if !updated.enabled_tools.contains(tool_id) {
                        updated.enabled_tools.push(tool_id.clone());
                        added.push(tool_id.clone());
                    }
                }
                let deployed = Self::deploy_to_tools(db, &updated, &added);
                updated.enabled_tools.retain(|id| {
                    existing.enabled_tools.contains(id) || deployed.contains(id)
                });
                db.update_skill_enabled_tools(&updated.id, &updated.enabled_tools)?;
                return Ok(updated);
            }
        }

        let library = Self::get_library_dir(db)?;
        let dest = library.join(&install_name);
        Self::copy_dir_recursive(&source_dir, &dest)?;
        let content_hash = Self::compute_dir_hash(&dest).ok();
        let skill_md = dest.join("SKILL.md");
        let (name, description) = Self::read_skill_name_desc(&skill_md, &install_name);

        let now = chrono::Utc::now().timestamp();
        let record = SkillRecord {
            id: match (&git_info, &registry_match) {
                (Some(info), _) => format!("{}:{}", info.repo, install_name),
                (None, Some((repo, _))) => format!("{}:{}", repo, install_name),
                (None, None) => format!("local:{install_name}"),
            },
            name: name.clone(),
            display_name: name,
            description,
            display_description: None,
            description_status: "pending".to_string(),
            directory: install_name.clone(),
            tags: vec![],
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_id: None,
            project_path: None,
            source_type: if registry_match.is_some() {
                "skills_sh".to_string()
            } else {
                "local".to_string()
            },
            source_repo: git_info
                .as_ref()
                .map(|i| i.repo.clone())
                .or_else(|| registry_match.as_ref().map(|(repo, _)| repo.clone())),
            source_branch: git_info.as_ref().and_then(|i| i.branch.clone()),
            source_subpath: None,
            source_author: git_info
                .as_ref()
                .and_then(|i| i.repo.split('/').next().map(|s| s.to_string()))
                .or_else(|| {
                    registry_match
                        .as_ref()
                        .and_then(|(repo, _)| repo.split('/').next().map(|s| s.to_string()))
                }),
            source_registry_id: registry_match
                .as_ref()
                .map(|(_, registry_id)| registry_id.clone()),
            source_url: git_info.as_ref().map(|i| i.url.clone()).or_else(|| {
                registry_match
                    .as_ref()
                    .map(|(repo, _)| format!("https://github.com/{repo}"))
            }),
            source_github_detected: git_info.is_some(),
            current_commit: git_info.as_ref().and_then(|i| i.commit.clone()),
            latest_commit: None,
            has_update: false,
            content_hash,
            enabled_tools: enabled_tools.clone(),
            deploy_method: deploy_method.unwrap_or("auto").to_string(),
            installed_at: now,
            updated_at: 0,
            author: None,
            license: None,
        };
        db.save_skill(&record)?;

        let deployed = Self::deploy_to_tools(db, &record, &enabled_tools);
        if !enabled_tools.is_empty() && deployed.is_empty() {
            if let Err(err) = db.delete_skill(&record.id) {
                log::warn!("部署失败回滚：删除技能记录 {} 失败: {err}", record.id);
            }
            if let Err(err) = fs::remove_dir_all(&dest) {
                log::warn!("部署失败回滚：删除目录 {} 失败: {err}", dest.display());
            }
            return Err(anyhow!(format_skill_error(
                "DEPLOY_FAILED",
                &[("skill", &install_name)],
                Some("checkToolPath"),
            )));
        }
        if deployed.len() != enabled_tools.len() {
            db.update_skill_enabled_tools(&record.id, &deployed)?;
        }
        let mut record = record;
        record.enabled_tools = deployed;
        Ok(record)
    }

    /// 卸载技能（即删，无备份）
    pub fn uninstall(db: &Database, id: &str) -> Result<()> {
        let _guard = state_write_guard();
        let record = db
            .get_skill(id)?
            .ok_or_else(|| anyhow!("Skill not found: {id}"))?;

        if record.is_project() {
            return Self::uninstall_project_skill(db, &record);
        }

        // 脏 directory：跳过文件操作但仍删 DB 行，避免用户被锁在坏状态
        match Self::require_valid_directory(&record.directory) {
            Ok(_) => {
                // 先清理全部部署点，任一失败即中止并保留 DB 行（可修复后重试）
                for tool_id in &record.enabled_tools {
                    if let Ok(Some(tool)) = db.get_tool_adapter(tool_id) {
                        Self::remove_from_tool(db, &record, &tool).with_context(|| {
                            format!("卸载中止：从工具 {tool_id} 移除失败，技能记录已保留")
                        })?;
                    }
                }
                let library = Self::get_library_dir(db)?;
                let skill_path = library.join(&record.directory);
                if skill_path.exists() {
                    fs::remove_dir_all(&skill_path).with_context(|| {
                        format!(
                            "卸载中止：删除技能库目录 {} 失败，技能记录已保留",
                            skill_path.display()
                        )
                    })?;
                }
            }
            Err(err) => {
                log::warn!(
                    "Skill {id} 的 directory 非法（{:?}），跳过文件清理，仅删除数据库记录: {err}",
                    record.directory
                );
            }
        }

        db.delete_skill(id)?;
        log::info!("Skill {} 卸载成功", record.name);
        Ok(())
    }

    /// 卸载项目级 Skill：先按归属验证删除 `<project>/skills/<dir>` 链接/副本，
    /// 再删 `<project>/.claude/skills/<dir>` 与 DB 行
    fn uninstall_project_skill(db: &Database, record: &SkillRecord) -> Result<()> {
        let directory = match Self::require_valid_directory(&record.directory) {
            Ok(directory) => directory,
            Err(err) => {
                log::warn!(
                    "项目级 Skill {} 的 directory 非法（{:?}），仅删除数据库记录: {err}",
                    record.id,
                    record.directory
                );
                db.delete_skill(&record.id)?;
                return Ok(());
            }
        };
        let Some(project_path) = record.project_path.clone() else {
            log::warn!(
                "项目级 Skill {} 缺少 project_path，仅删除数据库记录",
                record.id
            );
            db.delete_skill(&record.id)?;
            return Ok(());
        };

        let project_root = PathBuf::from(&project_path);
        // 规范存储目录（新模型中央库命名空间 / 旧版项目内位置，含兜底解析）
        let storage = Self::skill_storage_dir(db, record)?;

        // 1. 各工具项目内分发条目（record.enabled_tools 记录的工具）。
        // 与全局卸载同语义：目标位置即工具纳管命名空间，存在即删
        let tools = db.list_tool_adapters()?;
        for tool_id in &record.enabled_tools {
            let Some(tool) = tools.iter().find(|t| &t.id == tool_id) else {
                continue;
            };
            let Some(dest_root) = Self::project_tool_root(tool, &project_path) else {
                continue;
            };
            Self::remove_from_tool_at(db, record, tool, &dest_root).with_context(|| {
                format!(
                    "卸载中止：删除工具 {} 的项目内分发失败，技能记录已保留",
                    tool.id
                )
            })?;
        }

        // 2. 遗留约定 `<project>/skills/<dir>`（旧版第二条链接）：仅删能验证归属的，
        // 悬空 symlink/普通文件按外来内容保留，防误删用户文件
        let legacy_linked = project_root.join("skills").join(&directory);
        if legacy_linked.exists() || Self::is_symlink(&legacy_linked) {
            match Self::inspect_destination(
                &storage,
                &legacy_linked,
                &directory,
                DestCheckMode::Uninstall,
            ) {
                Ok(Some(_)) => {
                    Self::remove_path(&legacy_linked).with_context(|| {
                        format!(
                            "卸载中止：删除链接 {} 失败，技能记录已保留",
                            legacy_linked.display()
                        )
                    })?;
                }
                Ok(None) => {}
                Err(err) => {
                    log::warn!(
                        "项目级 Skill {} 的 skills 目录存在外来内容，保留 {}: {err}",
                        record.id,
                        legacy_linked.display()
                    );
                }
            }
        }

        // 3. 遗留约定 `<project>/.claude/skills/<dir>`（旧版原文件位置；新模型下也可能是
        // claude-code 的项目内分发条目，步骤 1 已删过一次）。同样只删能验证归属的
        let legacy_source = project_root.join(".claude").join("skills").join(&directory);
        if legacy_source.exists() || Self::is_symlink(&legacy_source) {
            if Self::paths_alias(&storage, &legacy_source) {
                // 兜底解析下二者本就是同一目录，交给步骤 4 处理
            } else {
                match Self::inspect_destination(
                    &storage,
                    &legacy_source,
                    &directory,
                    DestCheckMode::Uninstall,
                ) {
                    Ok(Some(_)) => {
                        Self::remove_path(&legacy_source).with_context(|| {
                            format!(
                                "卸载中止：删除遗留项目技能目录 {} 失败，技能记录已保留",
                                legacy_source.display()
                            )
                        })?;
                    }
                    Ok(None) => {}
                    Err(err) => {
                        log::warn!(
                            "项目级 Skill {} 的 .claude/skills 存在外来内容，保留 {}: {err}",
                            record.id,
                            legacy_source.display()
                        );
                    }
                }
            }
        }

        // 4. 中央库（或旧版位置）中的原文件
        if storage.exists() {
            Self::remove_path(&storage).with_context(|| {
                format!(
                    "卸载中止：删除技能原文件 {} 失败，技能记录已保留",
                    storage.display()
                )
            })?;
        }

        db.delete_skill(&record.id)?;
        log::info!("项目级 Skill {} 卸载成功", record.name);
        Ok(())
    }

    /// 切换技能在单个工具上的分发状态
    pub fn toggle_tool(db: &Database, id: &str, tool_id: &str, enabled: bool) -> Result<()> {
        let _guard = state_write_guard();
        let mut record = db
            .get_skill(id)?
            .ok_or_else(|| anyhow!("Skill not found: {id}"))?;

        let tool = db
            .get_tool_adapter(tool_id)?
            .ok_or_else(|| anyhow!("Tool not found: {tool_id}"))?;

        if enabled {
            if record.is_project() {
                // 项目级：分发到该工具配置的项目内技能目录
                let project_path = record
                    .project_path
                    .as_deref()
                    .ok_or_else(|| anyhow!("项目级 Skill {} 缺少 project_path", record.id))?
                    .to_string();
                let dest_root = Self::project_tool_root(&tool, &project_path).ok_or_else(|| {
                    anyhow!(
                        "工具 {} 未配置项目内技能目录，无法项目级分发（可在「AI 工具」页配置）",
                        tool.id
                    )
                })?;
                Self::deploy_to_tool_at(db, &record, &tool, &dest_root)?;
            } else {
                Self::deploy_to_tool(db, &record, &tool)?;
            }
            if !record.enabled_tools.iter().any(|t| t == tool_id) {
                record.enabled_tools.push(tool_id.to_string());
            }
        } else {
            if record.is_project() {
                if let Some(project_path) = record.project_path.as_deref() {
                    if let Some(dest_root) = Self::project_tool_root(&tool, project_path) {
                        Self::remove_from_tool_at(db, &record, &tool, &dest_root)?;
                    }
                }
            } else {
                Self::remove_from_tool(db, &record, &tool)?;
            }
            record.enabled_tools.retain(|t| t != tool_id);
        }
        db.update_skill_enabled_tools(id, &record.enabled_tools)?;
        Ok(())
    }

    /// 批量设置标签（trim、丢空、截 50 字符、去重保序），返回更新的记录数
    pub fn set_skill_tags(db: &Database, ids: Vec<String>, tags: Vec<String>) -> Result<usize> {
        const MAX_TAG_CHARS: usize = 50;
        let mut seen = HashSet::new();
        let normalized: Vec<String> = tags
            .iter()
            .map(|t| t.trim())
            .filter(|t| !t.is_empty())
            .map(|t| t.chars().take(MAX_TAG_CHARS).collect::<String>())
            .filter(|t| seen.insert(t.clone()))
            .collect();

        let _guard = state_write_guard();
        // 单事务批量替换，任一条失败整体回滚
        Ok(db.set_tags_for_skills(&ids, &normalized)?)
    }
}

// ========== 更新检测 / 迁移 / 查询视图 ==========

impl SkillService {
    /// 检查所有已安装 Skill 的更新（仅远端来源；按 (repo, branch) 分组去重下载）
    /// check_updates 的远端目录匹配谓词：有 source_subpath 时按全路径段匹配，
    /// 否则按目录末段匹配（均忽略大小写）
    fn remote_dir_matches(skill: &SkillRecord, remote_directory: &str) -> bool {
        match skill.source_subpath.as_deref().filter(|s| !s.is_empty()) {
            Some(subpath) => remote_directory.eq_ignore_ascii_case(subpath),
            None => {
                let remote_install_name =
                    remote_directory.rsplit('/').next().unwrap_or(remote_directory);
                remote_install_name.eq_ignore_ascii_case(&skill.directory)
            }
        }
    }

    pub async fn check_updates(db: &Database) -> Result<Vec<SkillUpdateInfo>> {
        let skills = db.get_all_skills()?;
        let mut updates = Vec::new();

        let mut repo_groups: HashMap<(String, String), Vec<SkillRecord>> = HashMap::new();
        for skill in skills.into_values() {
            let Some(repo_full) = skill.source_repo.clone() else {
                continue;
            };
            if repo_full.split_once('/').is_none() {
                continue;
            }
            let branch = skill
                .source_branch
                .clone()
                .filter(|b| !b.is_empty())
                .unwrap_or_else(|| "main".to_string());
            repo_groups
                .entry((repo_full, branch))
                .or_default()
                .push(skill);
        }

        let library = Self::get_library_dir(db)?;

        for ((repo_full, branch), group_skills) in &repo_groups {
            let Some((owner, name)) = repo_full.split_once('/') else {
                continue;
            };
            let repo = SkillRepo {
                owner: owner.to_string(),
                name: name.to_string(),
                branch: branch.clone(),
                enabled: true,
            };

            let (temp_guard, used_branch) = match github::download_repo_with_timeout(&repo).await {
                Ok(result) => result,
                Err(e) => {
                    log::warn!("检查更新时下载 {repo_full} 失败: {e}");
                    continue;
                }
            };
            let temp_dir = temp_guard.path();
            let latest_commit =
                github::fetch_latest_commit(owner, name, &used_branch).await;

            // 扫描远端仓库中的全部技能目录
            let mut remote_dirs: Vec<(String, String)> = Vec::new();
            Self::scan_repo_dir_recursive(temp_dir, temp_dir, name, &mut remote_dirs)?;

            // 远端 I/O 完成后才读本地状态
            let _guard = state_read_guard();

            for skill in group_skills {
                // 有 source_subpath 时按全路径段精确匹配，否则按目录末段匹配
                let remote_match = remote_dirs
                    .iter()
                    .find(|(directory, _)| Self::remote_dir_matches(skill, directory));
                let Some((remote_directory, _)) = remote_match else {
                    // 远端目录已消失：清除可能残留的更新标记，避免角标卡死
                    if skill.has_update {
                        log::warn!(
                            "远端仓库 {repo_full} 中未找到技能目录 {}，清除更新标记",
                            skill.directory
                        );
                        if let Err(e) = db.update_skill_update_state(
                            &skill.id,
                            skill.latest_commit.as_deref(),
                            false,
                        ) {
                            log::warn!("清除更新标记失败 {}: {e}", skill.id);
                        }
                    }
                    continue;
                };
                let remote_skill_dir = match Self::resolve_skill_source_dir(temp_dir, remote_directory)
                {
                    Ok(Some(dir)) => dir,
                    Ok(None) => continue,
                    // 解析阶段可能因歧义等多匹配报错，跳过该技能的更新检查
                    Err(e) => {
                        log::warn!("解析远程技能目录失败 {}: {e}", skill.id);
                        continue;
                    }
                };
                let remote_hash = match Self::compute_dir_hash(&remote_skill_dir) {
                    Ok(h) => h,
                    Err(e) => {
                        log::warn!("计算远程哈希失败 {}: {e}", skill.id);
                        continue;
                    }
                };

                let local_base = if skill.is_project() {
                    // 项目级：以中央库规范存储目录为基准（新旧布局均可解析），
                    // 避免只分发到非 .claude 工具时旧位置缺失导致误报更新
                    Self::skill_storage_dir(db, skill)
                        .ok()
                        .and_then(|dir| dir.parent().map(|p| p.to_path_buf()))
                } else {
                    Some(library.clone())
                };
                let local_hash = match local_base.as_deref().map(|base| {
                    Self::local_hash_for_update_check(
                        base,
                        &skill.directory,
                        skill.content_hash.as_deref(),
                    )
                }) {
                    Some(Some((h, freshly_computed))) => {
                        if freshly_computed {
                            if let Err(e) = db.update_skill_hash(&skill.id, &h) {
                                log::warn!("回填内容哈希失败 {}: {e}", skill.id);
                            }
                        }
                        Some(h)
                    }
                    _ => None,
                };

                let commit_changed = latest_commit.is_some() && latest_commit != skill.current_commit;
                let hash_changed = local_hash.as_deref() != Some(&remote_hash);
                let has_update = hash_changed || commit_changed;

                // 回填远端状态
                if let Err(e) = db.update_skill_update_state(
                    &skill.id,
                    latest_commit.as_deref().or(skill.latest_commit.as_deref()),
                    has_update,
                ) {
                    log::warn!("回填更新状态失败 {}: {e}", skill.id);
                }

                if has_update {
                    updates.push(SkillUpdateInfo {
                        id: skill.id.clone(),
                        name: skill.name.clone(),
                        current_hash: local_hash,
                        remote_hash: Some(remote_hash),
                        current_commit: skill.current_commit.clone(),
                        latest_commit: latest_commit.clone(),
                    });
                }
            }
        }

        Ok(updates)
    }

    /// 更新单个 Skill（重新下载并替换本地文件；项目级同样支持）
    pub async fn update_skill(db: &Database, skill_id: &str) -> Result<SkillRecord> {
        let skill = db
            .get_skill(skill_id)?
            .ok_or_else(|| anyhow!("Skill not found: {skill_id}"))?;

        Self::require_valid_directory(&skill.directory)?;

        let repo_full = skill
            .source_repo
            .clone()
            .ok_or_else(|| anyhow!("Cannot update local skill: {skill_id}"))?;
        let (owner, name) = repo_full
            .split_once('/')
            .ok_or_else(|| anyhow!("Cannot update local skill: {skill_id}"))?;
        let branch = skill
            .source_branch
            .clone()
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| "main".to_string());

        let repo = SkillRepo {
            owner: owner.to_string(),
            name: name.to_string(),
            branch: branch.clone(),
            enabled: true,
        };

        let (temp_guard, used_branch) = github::download_repo_with_timeout(&repo).await?;
        let temp_dir = temp_guard.path();

        let mut remote_dirs: Vec<(String, String)> = Vec::new();
        Self::scan_repo_dir_recursive(temp_dir, temp_dir, name, &mut remote_dirs)?;
        let remote_match = remote_dirs
            .iter()
            .find(|(directory, _)| {
                let remote_install_name = directory.rsplit('/').next().unwrap_or(directory);
                remote_install_name.eq_ignore_ascii_case(&skill.directory)
            })
            .ok_or_else(|| {
                anyhow!(format_skill_error(
                    "SKILL_DIR_NOT_FOUND",
                    &[("path", &skill.directory)],
                    Some("checkRepoUrl"),
                ))
            })?;
        let source = Self::resolve_skill_source_dir(temp_dir, &remote_match.0)?.ok_or_else(|| {
            anyhow!(format_skill_error(
                "SKILL_DIR_NOT_FOUND",
                &[("path", &remote_match.0)],
                Some("checkRepoUrl"),
            ))
        })?;

        let current_commit = github::fetch_latest_commit(owner, name, &used_branch).await;

        // 下载与扫描完成后进入临界区；期间用户可能已卸载，先重读确认
        let _guard = state_write_guard();
        let current = db
            .get_skill(skill_id)?
            .ok_or_else(|| anyhow!("Skill no longer installed: {skill_id}"))?;
        if current.directory != skill.directory || current.source_repo != skill.source_repo {
            return Err(anyhow!("Skill changed during update: {skill_id}"));
        }
        Self::require_valid_directory(&current.directory)?;

        let dest = Self::skill_storage_dir(db, &current)?;
        Self::replace_dest_with_copy(&source, &dest, &current.directory)?;

        // 项目级：刷新各工具项目内目录中的分发（symlink 指向不变则不动，copy 重新替换）
        if current.is_project() {
            if let Some(project_path) = current.project_path.as_ref() {
                let tools = db.list_tool_adapters()?;
                for tool_id in &current.enabled_tools {
                    let Some(tool) = tools.iter().find(|t| &t.id == tool_id) else {
                        continue;
                    };
                    let Some(dest_root) = Self::project_tool_root(tool, project_path) else {
                        continue;
                    };
                    let linked = dest_root.join(&current.directory);
                    // symlink 指向 dest，内容更新自动可见；copy 需要重新替换
                    if (linked.exists() || Self::is_symlink(&linked))
                        && !Self::is_symlink(&linked)
                    {
                        Self::replace_dest_with_copy(&dest, &linked, &current.directory)?;
                    }
                }
            }
        } else {
            // 全局：对所有已启用工具重部署；任一失败则中止，DB 元数据不提交
            // （库内文件已更新，修复工具目录后重试即可，重试走同一原子替换路径）
            let mut redeploy_errors: Vec<String> = Vec::new();
            for tool_id in &current.enabled_tools {
                if let Ok(Some(tool)) = db.get_tool_adapter(tool_id) {
                    if let Err(err) = Self::remove_from_tool(db, &current, &tool) {
                        log::warn!("更新后从工具 {tool_id} 移除旧部署失败（继续重部署）: {err}");
                    }
                    if let Err(err) = Self::deploy_to_tool(db, &current, &tool) {
                        log::warn!("更新后重部署到工具 {tool_id} 失败: {err}");
                        redeploy_errors.push(format!("{tool_id}: {err}"));
                    }
                }
            }
            if !redeploy_errors.is_empty() {
                return Err(anyhow!(
                    "技能库文件已更新，但以下工具重部署失败，请检查工具目录后重试: {}",
                    redeploy_errors.join("; ")
                ));
            }
        }

        let new_hash = Self::compute_dir_hash(&dest).ok();
        let skill_md = dest.join("SKILL.md");
        let (new_name, new_description) =
            Self::read_skill_name_desc(&skill_md, &current.directory);
        let source_url = current.source_url.clone();

        let mut updated = current.clone();
        updated.name = new_name;
        updated.description = new_description;
        updated.display_description = None;
        updated.description_status = "pending".to_string();
        updated.source_branch = Some(used_branch);
        updated.current_commit = current_commit.or(current.current_commit.clone());
        updated.latest_commit = updated.current_commit.clone();
        updated.has_update = false;
        updated.content_hash = new_hash;
        updated.updated_at = chrono::Utc::now().timestamp();
        updated.source_url = source_url;

        if !db.update_skill_metadata(&updated)? {
            return Err(anyhow!("Skill no longer installed: {skill_id}"));
        }

        let record = db
            .get_skill(skill_id)?
            .ok_or_else(|| anyhow!("Skill no longer installed: {skill_id}"))?;
        log::info!("Skill {} 更新成功", record.name);
        Ok(record)
    }

    /// 扫描未受管技能：启用工具目录下含 SKILL.md 且未被全局管理的目录
    pub fn scan_unmanaged(db: &Database) -> Result<Vec<UnmanagedSkill>> {
        let _guard = state_read_guard();
        let managed_skills = db.get_all_skills()?;
        let managed_dirs: HashSet<String> = managed_skills
            .values()
            .filter(|s| !s.is_project())
            .map(|s| s.directory.to_lowercase())
            .collect();

        let tools = db.list_tool_adapters()?;
        let mut unmanaged: HashMap<String, UnmanagedSkill> = HashMap::new();

        for tool in tools.iter().filter(|t| t.is_enabled) {
            let root = Self::tool_root(tool)?;
            let entries = match fs::read_dir(&root) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if dir_name.starts_with('.') || managed_dirs.contains(&dir_name.to_lowercase()) {
                    continue;
                }
                let skill_md = path.join("SKILL.md");
                if !skill_md.exists() {
                    continue;
                }
                let (name, description) = Self::read_skill_name_desc(&skill_md, &dir_name);
                unmanaged
                    .entry(dir_name.clone())
                    .and_modify(|s| s.found_in.push(tool.id.clone()))
                    .or_insert(UnmanagedSkill {
                        directory: dir_name,
                        name,
                        description,
                        found_in: vec![tool.id.clone()],
                        path: path.display().to_string(),
                    });
            }
        }

        Ok(unmanaged.into_values().collect())
    }

    /// 从工具目录导入未受管技能到中央库
    /// git 识别失败时，按目录名（必要时退回 SKILL.md 技能名）在 skills.sh 注册表精确匹配原作者仓库（联网；失败/无匹配 → 本地技能）
    pub async fn import_from_apps(
        db: &Database,
        selections: Vec<ImportSkillSelection>,
    ) -> Result<Vec<SkillRecord>> {
        // 预扫描：定位源目录并识别来源（联网匹配不持有写锁）
        let mut prepared = Vec::new();
        {
            let tools = db.list_tool_adapters()?;
            for selection in selections {
                let dir_name = match Self::require_valid_directory(&selection.directory) {
                    Ok(dir_name) => dir_name,
                    Err(err) => {
                        log::warn!("跳过导入：{err}");
                        continue;
                    }
                };

                // 在启用工具的目录中查找源
                let mut source_path: Option<PathBuf> = None;
                for tool in tools.iter().filter(|t| t.is_enabled) {
                    let candidate = Self::tool_root(tool)?.join(&dir_name);
                    if candidate.is_dir() && candidate.join("SKILL.md").is_file() {
                        source_path = Some(candidate);
                        break;
                    }
                }
                let Some(source) = source_path else {
                    log::warn!("跳过导入 '{dir_name}'：未在任何启用工具目录中找到");
                    continue;
                };

                let git_info = git_detect::detect_github_source(&source);
                let registry_match = if git_info.is_none() {
                    let skill_name = Self::parse_skill_metadata_static(&source.join("SKILL.md"))
                        .ok()
                        .and_then(|m| m.name);
                    Self::match_registry_source(&dir_name, skill_name.as_deref()).await
                } else {
                    None
                };
                prepared.push((selection, dir_name, source, git_info, registry_match));
            }
        }

        let _guard = state_write_guard();
        let library = Self::get_library_dir(db)?;
        let mut imported = Vec::new();

        for (selection, dir_name, source, git_info, registry_match) in prepared {
            // 已受管 → 仅补充工具分发
            let existing_skills = db.get_all_skills()?;
            if let Some(existing) = existing_skills
                .values()
                .find(|s| !s.is_project() && s.directory.eq_ignore_ascii_case(&dir_name))
            {
                let enabled_tools = Self::validated_tool_ids(db, &selection.tool_ids)?;
                let mut updated = existing.clone();
                let added: Vec<String> = enabled_tools
                    .iter()
                    .filter(|id| !updated.enabled_tools.contains(*id))
                    .cloned()
                    .collect();
                let deployed = Self::deploy_to_tools(db, &updated, &added);
                updated.enabled_tools.extend(deployed);
                db.update_skill_enabled_tools(&updated.id, &updated.enabled_tools)?;
                imported.push(updated);
                continue;
            }

            let dest = library.join(&dir_name);
            if !dest.exists() {
                Self::copy_dir_recursive(&source, &dest)?;
            }

            let skill_md = dest.join("SKILL.md");
            let (name, description) = Self::read_skill_name_desc(&skill_md, &dir_name);
            let content_hash = Self::compute_dir_hash(&dest).ok();
            let enabled_tools = Self::validated_tool_ids(db, &selection.tool_ids)?;

            let now = chrono::Utc::now().timestamp();
            let record = SkillRecord {
                id: match (&git_info, &registry_match) {
                    (Some(info), _) => format!("{}:{}", info.repo, dir_name),
                    (None, Some((repo, _))) => format!("{}:{}", repo, dir_name),
                    (None, None) => format!("local:{dir_name}"),
                },
                name: name.clone(),
                display_name: name,
            description,
            display_description: None,
            description_status: "pending".to_string(),
            directory: dir_name.clone(),
                tags: vec![],
                scope: SKILL_SCOPE_GLOBAL.to_string(),
                project_id: None,
                project_path: None,
                source_type: if registry_match.is_some() {
                    "skills_sh".to_string()
                } else {
                    "local".to_string()
                },
                source_repo: git_info
                    .as_ref()
                    .map(|i| i.repo.clone())
                    .or_else(|| registry_match.as_ref().map(|(repo, _)| repo.clone())),
                source_branch: git_info.as_ref().and_then(|i| i.branch.clone()),
                source_subpath: None,
                source_author: git_info
                    .as_ref()
                    .and_then(|i| i.repo.split('/').next().map(|s| s.to_string()))
                    .or_else(|| {
                        registry_match
                            .as_ref()
                            .and_then(|(repo, _)| repo.split('/').next().map(|s| s.to_string()))
                    }),
                source_registry_id: registry_match
                    .as_ref()
                    .map(|(_, registry_id)| registry_id.clone()),
                source_url: git_info.as_ref().map(|i| i.url.clone()).or_else(|| {
                    registry_match
                        .as_ref()
                        .map(|(repo, _)| format!("https://github.com/{repo}"))
                }),
                source_github_detected: git_info.is_some(),
                current_commit: git_info.as_ref().and_then(|i| i.commit.clone()),
                latest_commit: None,
                has_update: false,
                content_hash,
                enabled_tools: enabled_tools.clone(),
                deploy_method: "auto".to_string(),
                installed_at: now,
                updated_at: 0,
                author: None,
                license: None,
            };
            db.save_skill(&record)?;

            let deployed = Self::deploy_to_tools(db, &record, &enabled_tools);
            if deployed.len() != enabled_tools.len() {
                db.update_skill_enabled_tools(&record.id, &deployed)?;
            }
            let mut record = record;
            record.enabled_tools = deployed;
            imported.push(record);
        }

        Ok(imported)
    }

    /// 迁移中央库到新位置：移动所有子目录（rename 优先，失败 copy+delete），
    /// 任一失败整体回滚；成功后持久化设置并对所有启用工具重部署（修 symlink）
    pub fn migrate_library(db: &Database, target: &str) -> Result<MigrationResult> {
        let _guard = state_write_guard();
        let old_dir = Self::get_library_dir(db)?;
        let new_dir = config::expand_tilde(target)?;

        if Self::paths_alias(&old_dir, &new_dir) {
            return Ok(MigrationResult {
                migrated_count: 0,
                skipped_count: 0,
                skipped: vec![],
                errors: vec![],
            });
        }
        if Self::paths_overlap(&old_dir, &new_dir) {
            return Err(anyhow!(
                "迁移目标不能与当前技能库互相包含: {} <-> {}",
                old_dir.display(),
                new_dir.display()
            ));
        }
        fs::create_dir_all(&new_dir)?;

        let mut result = MigrationResult {
            migrated_count: 0,
            skipped_count: 0,
            skipped: vec![],
            errors: vec![],
        };
        let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();

        let entries = fs::read_dir(&old_dir)
            .with_context(|| format!("读取技能库失败: {}", old_dir.display()))?;
        for entry in entries.flatten() {
            let src = entry.path();
            let name = entry.file_name();
            let dst = new_dir.join(&name);
            if dst.exists() || Self::is_symlink(&dst) {
                result.skipped_count += 1;
                result.skipped.push(name.to_string_lossy().into_owned());
                continue;
            }
            let move_result: Result<()> = match fs::rename(&src, &dst) {
                Ok(()) => Ok(()),
                Err(_) => (|| {
                    if src.is_dir() {
                        Self::copy_dir_recursive(&src, &dst)?;
                        fs::remove_dir_all(&src)?;
                    } else {
                        fs::copy(&src, &dst)?;
                        fs::remove_file(&src)?;
                    }
                    Ok(())
                })(),
            };
            match move_result {
                Ok(()) => {
                    result.migrated_count += 1;
                    moved.push((src, dst));
                }
                Err(e) => {
                    result.errors.push(format!("{}: {e}", src.display()));
                    // 整体回滚已移动的条目
                    let mut rollback_failures: Vec<String> = Vec::new();
                    for (src, dst) in moved.iter().rev() {
                        let rollback: Result<()> = if fs::rename(dst, src).is_ok() {
                            Ok(())
                        } else {
                            (|| {
                                if dst.is_dir() {
                                    Self::copy_dir_recursive(dst, src)?;
                                    fs::remove_dir_all(dst)?;
                                } else {
                                    fs::copy(dst, src)?;
                                    fs::remove_file(dst)?;
                                }
                                Ok(())
                            })()
                        };
                        if let Err(err) = rollback {
                            log::error!("迁移回滚失败 {}: {err}", dst.display());
                            rollback_failures.push(format!("{}: {err}", dst.display()));
                        }
                    }
                    if rollback_failures.is_empty() {
                        return Err(anyhow!(
                            "技能库迁移失败并已回滚: {}",
                            result.errors.join("; ")
                        ));
                    }
                    return Err(anyhow!(
                        "技能库迁移失败: {}。回滚未全部完成，请手动检查以下目录: {}",
                        result.errors.join("; "),
                        rollback_failures.join("; ")
                    ));
                }
            }
        }

        // 文件全部移动完成后才持久化设置
        db.set_setting("library_path", target)?;

        // 对所有全局技能的启用工具重部署（修复 symlink 指向）
        let skills = db.get_all_skills()?;
        for record in skills.values().filter(|s| !s.is_project()) {
            for tool_id in &record.enabled_tools {
                if let Ok(Some(tool)) = db.get_tool_adapter(tool_id) {
                    if let Err(err) = Self::deploy_to_tool(db, record, &tool) {
                        result
                            .errors
                            .push(format!("{} -> {tool_id}: {err}", record.directory));
                    }
                }
            }
        }

        if !result.errors.is_empty() {
            log::error!(
                "技能库已迁移到 {}，但重部署失败: {}",
                new_dir.display(),
                result.errors.join("; ")
            );
            return Err(anyhow!(
                "技能库文件已迁移到 {}，但以下工具的重部署失败，请在工具管理中重新启用对应技能: {}",
                new_dir.display(),
                result.errors.join("; ")
            ));
        }

        log::info!(
            "技能库迁移完成: {} 迁移, {} 跳过, {} 错误",
            result.migrated_count,
            result.skipped_count,
            result.errors.len()
        );
        Ok(result)
    }
}

// ========== 视图转换 / 详情 / 设置 / 发现 ==========

/// 时间缺失/越界时的展示占位（0 值不再显示 1970-01-01）
const UNKNOWN_TIME_LABEL: &str = "未知";

/// Unix 秒 → ISO 时间串；0 / 负数 / 越界返回 None（调用方展示"未知"）
fn iso_time(ts: i64) -> Option<String> {
    if ts <= 0 {
        return None;
    }
    chrono::DateTime::from_timestamp(ts, 0).map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

/// 格式化文件大小：<1024 → "890 B"；<1MiB → "4.8 KB"；否则 "2.3 MB"
fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    }
}

impl SkillService {
    /// SkillRecord → 前端 Skill 视图
    pub fn record_to_skill(
        db: &Database,
        record: &SkillRecord,
        tools: &[ToolAdapter],
        projects: &[(i64, String, String, i64)],
        detail: bool,
    ) -> Skill {
        let storage_path = Self::skill_storage_dir(db, record)
            .map(|p| p.display().to_string())
            .unwrap_or_default();

        let project_name = record.project_id.as_deref().and_then(|id| {
            id.parse::<i64>()
                .ok()
                .and_then(|id| projects.iter().find(|p| p.0 == id).map(|p| p.1.clone()))
        });

        let installed_at = iso_time(record.installed_at)
            .unwrap_or_else(|| UNKNOWN_TIME_LABEL.to_string());
        let last_updated = if record.updated_at == 0 {
            installed_at.clone()
        } else {
            iso_time(record.updated_at).unwrap_or_else(|| UNKNOWN_TIME_LABEL.to_string())
        };

        // 无真实 commit 时留空（前端显示 "-"），不再用 content_hash 伪造 local-xxxx
        let current_commit = record.current_commit.clone().unwrap_or_default();

        let deployed_tools: HashMap<String, bool> = tools
            .iter()
            .map(|t| {
                let flagged = record.enabled_tools.iter().any(|id| id == &t.id);
                // DB 标记与落盘双重确认：工具目录被外部删除后不再显示"已部署"。
                // 项目级技能检查项目内目录（由工具本地目录推导），全局检查工具全局目录
                let actually_deployed = flagged
                    && Self::require_valid_directory(&record.directory)
                        .map(|directory| {
                            let dest = if record.is_project() {
                                record
                                    .project_path
                                    .as_deref()
                                    .and_then(|p| Self::project_tool_root(t, p))
                                    .map(|root| root.join(&directory))
                            } else {
                                Self::tool_root(t)
                                    .ok()
                                    .map(|root| root.join(&directory))
                            }
                            .unwrap_or_default();
                            dest.exists() || Self::is_symlink(&dest)
                        })
                        .unwrap_or(false);
                (t.id.clone(), actually_deployed)
            })
            .collect();

        let (documentation, files) = if detail {
            let base = Self::skill_storage_dir(db, record).ok();
            // documentation 只认 SKILL.md：README 是给人看的说明，不是技能清单，
            // 缺失时保持空（前端有占位分支），读取失败记 warn 不静默吞掉
            let documentation = base
                .as_ref()
                .and_then(|dir| match fs::read_to_string(dir.join("SKILL.md")) {
                    Ok(content) => Some(content),
                    Err(e) => {
                        log::warn!(
                            "读取 SKILL.md 失败，documentation 置空: {}: {e}",
                            dir.display()
                        );
                        None
                    }
                })
                .unwrap_or_default();
            let files = base
                .as_ref()
                .and_then(|dir| Self::build_file_tree(dir, dir).ok())
                .unwrap_or_default();
            (documentation, files)
        } else {
            (String::new(), vec![])
        };

        Skill {
            id: record.id.clone(),
            name: record.name.clone(),
            display_name: if record.display_name.is_empty() {
                record.name.clone()
            } else {
                record.display_name.clone()
            },
            directory: record.directory.clone(),
            description: if record.description_status == "ready" {
                record.display_description.clone().unwrap_or_else(|| "简介生成失败，可在设置中重试".to_string())
            } else if record.description_status == "failed" {
                "简介生成失败，可在设置中重试".to_string()
            } else {
                "尚未生成中文简介，请在设置中配置模型后处理".to_string()
            },
            description_status: record.description_status.clone(),
            tags: record.tags.clone(),
            scope: record.scope.clone(),
            project_id: record.project_id.clone(),
            project_name,
            source: SkillSource {
                source_type: record.source_type.clone(),
                url: record.source_url.clone(),
                repo: record.source_repo.clone(),
                branch: record.source_branch.clone(),
                subpath: record.source_subpath.clone(),
                author: record.source_author.clone(),
                registry_id: record.source_registry_id.clone(),
                is_git_hub_detected_from_local: record
                    .source_github_detected
                    .then_some(true),
                download_url: None,
            },
            current_commit,
            latest_commit: record.latest_commit.clone(),
            has_update: record.has_update,
            update_changelog: None,
            installed_at,
            last_updated,
            author: record
                .author
                .clone()
                .or_else(|| record.source_author.clone())
                .unwrap_or_default(),
            license: record.license.clone().unwrap_or_default(),
            documentation,
            files,
            deployed_tools,
            deploy_method: record.deploy_method.clone(),
            storage_path,
        }
    }

    /// 递归构建文件树（跳过隐藏；目录优先再按名字序；path 为正斜杠相对路径）
    fn build_file_tree(dir: &Path, base: &Path) -> Result<Vec<SkillFile>> {
        let mut entries: Vec<_> = fs::read_dir(dir)?
            .flatten()
            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .collect();
        entries.sort_by_key(|e| {
            let is_dir = e.path().is_dir();
            (!is_dir, e.file_name().to_string_lossy().to_lowercase())
        });

        let mut files = Vec::new();
        for entry in entries {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                let children = Self::build_file_tree(&path, base)?;
                let total = Self::dir_size(&path);
                files.push(SkillFile {
                    name,
                    path: rel,
                    size: format_size(total),
                    file_type: "dir".to_string(),
                    children: Some(children),
                });
            } else {
                let size = path.metadata().map(|m| m.len()).unwrap_or(0);
                files.push(SkillFile {
                    name,
                    path: rel,
                    size: format_size(size),
                    file_type: "file".to_string(),
                    children: None,
                });
            }
        }
        Ok(files)
    }

    /// 目录 visible 体积：跳过点开头隐藏文件（.git 等，与 build_file_tree 的可见口径一致），
    /// symlink 不跟随（避免环链与重复计数）
    fn dir_size(dir: &Path) -> u64 {
        let mut total = 0;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with('.') {
                    continue;
                }
                let path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() {
                    total += Self::dir_size(&path);
                } else {
                    total += path.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        total
    }

    /// 技能详情（列表字段 + SKILL.md 原文 + 文件树）
    pub fn get_skill_detail(db: &Database, id: &str) -> Result<Skill> {
        let _guard = state_read_guard();
        let record = db
            .get_skill(id)?
            .ok_or_else(|| anyhow!("Skill not found: {id}"))?;
        let tools = db.list_tool_adapters()?;
        let projects = db.list_skill_projects()?;
        Ok(Self::record_to_skill(db, &record, &tools, &projects, true))
    }

    /// 技能列表（无文档与文件树）
    pub fn list_api_skills(db: &Database) -> Result<Vec<Skill>> {
        let _guard = state_read_guard();
        let records = db.get_all_skills()?;
        let tools = db.list_tool_adapters()?;
        let projects = db.list_skill_projects()?;
        Ok(records
            .values()
            .map(|record| Self::record_to_skill(db, record, &tools, &projects, false))
            .collect())
    }

    /// 工具列表（实时探测目录存在性 + 统计已分发技能数）
    pub fn api_tools(db: &Database) -> Result<Vec<ToolAdapter>> {
        let records = db.get_all_skills()?;
        let mut tools = db.list_tool_adapters()?;
        for tool in &mut tools {
            tool.detected = Self::tool_root(tool).map(|p| p.is_dir()).unwrap_or(false);
            tool.installed_skills_count = records
                .values()
                .filter(|s| s.enabled_tools.iter().any(|id| id == &tool.id))
                .count();
        }
        Ok(tools)
    }

    /// 项目列表（技能计数 + 路径有效性）
    pub fn api_projects(db: &Database) -> Result<Vec<ProjectScope>> {
        let projects = db.list_skill_projects()?;
        let mut result = Vec::new();
        for (id, name, path, created_at) in projects {
            result.push(ProjectScope {
                id: id.to_string(),
                name,
                skill_count: db.count_skills_by_project_path(&path)? as usize,
                path: path.clone(),
                registered_at: iso_time(created_at)
                    .unwrap_or_else(|| UNKNOWN_TIME_LABEL.to_string()),
                is_path_valid: Path::new(&path).is_dir(),
            });
        }
        Ok(result)
    }

    /// 读取应用设置（developer_mode_enabled 为实时探测值）
    pub fn get_settings(db: &Database) -> Result<AppSettings> {
        let library_path = Self::get_library_dir(db)?;
        Ok(AppSettings {
            distribution_method: db
                .get_setting("distribution_method")?
                // 历史值 auto 视为 copy
                .map(|v| if v == "auto" { "copy".to_string() } else { v })
                .filter(|v| ["symlink", "copy"].contains(&v.as_str()))
                .unwrap_or_else(|| "copy".to_string()),
            library_path: config::collapse_tilde(&library_path)?,
            auto_check_update: db
                .get_setting("auto_check_update")?
                .map(|v| v == "true")
                .unwrap_or(true),
            check_interval_days: db
                .get_setting("check_interval_days")?
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(1),
            last_update_check_at: db
                .get_setting("last_update_check_at")?
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0),
            developer_mode_enabled: config::developer_mode_enabled(),
            theme: db
                .get_setting("theme")?
                .unwrap_or_else(|| "light".to_string()),
            locale: db
                .get_setting("locale")?
                .unwrap_or_else(|| "zh".to_string()),
            confirm_on_uninstall: db
                .get_setting("confirm_on_uninstall")?
                .map(|v| v == "true")
                .unwrap_or(true),
        })
    }

    /// 保存应用设置；library_path 变化时先迁移（失败则整体报错不落盘）。
    /// 返回因分发方式变更而需要重新部署的项目级技能 id 列表（无变更则为空）。
    pub fn save_settings(db: &Database, settings: &AppSettings) -> Result<Vec<String>> {
        if !["symlink", "copy"].contains(&settings.distribution_method.as_str()) {
            return Err(anyhow!(
                "无效的 distribution_method: {}",
                settings.distribution_method
            ));
        }

        let previous_method = db
            .get_setting("distribution_method")?
            // 历史值 auto 视为 copy（与 get_settings 归一化口径一致）
            .map(|v| if v == "auto" { "copy".to_string() } else { v })
            .filter(|v| ["symlink", "copy"].contains(&v.as_str()))
            .unwrap_or_else(|| "copy".to_string());

        let current = Self::get_library_dir(db)?;
        let new_raw = settings.library_path.trim();
        let new_dir = if new_raw.is_empty() {
            config::get_default_library_dir()?
        } else {
            config::expand_tilde(new_raw)?
        };
        if !Self::paths_alias(&current, &new_dir) {
            let target = if new_raw.is_empty() {
                config::get_default_library_dir()?.display().to_string()
            } else {
                new_raw.to_string()
            };
            Self::migrate_library(db, &target)?;
        }

        db.set_setting("distribution_method", &settings.distribution_method)?;
        db.set_setting(
            "auto_check_update",
            if settings.auto_check_update { "true" } else { "false" },
        )?;
        db.set_setting(
            "check_interval_days",
            &settings.check_interval_days.to_string(),
        )?;
        db.set_setting("theme", &settings.theme)?;
        db.set_setting("locale", &settings.locale)?;
        db.set_setting(
            "confirm_on_uninstall",
            if settings.confirm_on_uninstall {
                "true"
            } else {
                "false"
            },
        )?;

        // 分发方式变更：存量项目级技能的链接/副本仍是旧方式，交由前端提示一键重部署
        let mut affected = Vec::new();
        if previous_method != settings.distribution_method {
            let skills = db.get_all_skills()?;
            affected = skills
                .into_values()
                .filter(|s| s.is_project())
                .map(|s| s.id)
                .collect();
        }
        Ok(affected)
    }

    /// 按当前全局分发方式重建项目级技能在各工具项目内目录中的链接/副本
    /// （分发方式变更后由前端"一键重部署"触发）；外来内容拒绝覆盖。
    /// 原文件以中央库规范存储目录为源，重建后同步持久化 record.deploy_method
    pub fn redeploy_project_links(db: &Database, ids: &[String]) -> Result<usize> {
        let _guard = state_write_guard();
        let method = Self::get_sync_method(db);
        let method_raw = match method {
            SyncMethod::Symlink => "symlink",
            SyncMethod::Copy => "copy",
            SyncMethod::Auto => "auto",
        };
        let tools = db.list_tool_adapters()?;
        let mut done = 0;
        for id in ids {
            let mut record = db
                .get_skill(id)?
                .ok_or_else(|| anyhow!("Skill not found: {id}"))?;
            if !record.is_project() {
                continue;
            }
            Self::require_valid_directory(&record.directory)?;
            let project_path = record
                .project_path
                .as_deref()
                .ok_or_else(|| anyhow!("项目级 Skill {} 缺少 project_path", record.id))?
                .to_string();
            let source = Self::skill_storage_dir(db, &record)?;
            Self::validate_sync_source_dir(&source, &record.directory)?;

            for tool_id in &record.enabled_tools {
                let Some(tool) = tools.iter().find(|t| &t.id == tool_id) else {
                    continue;
                };
                let Some(dest_root) = Self::project_tool_root(tool, &project_path) else {
                    log::warn!("工具 {} 未配置项目内技能目录，跳过重部署", tool.id);
                    continue;
                };
                let dest = dest_root.join(&record.directory);
                if Self::paths_alias(&source, &dest) {
                    continue;
                }
                match Self::inspect_destination(
                    &source,
                    &dest,
                    &record.directory,
                    DestCheckMode::Redeploy,
                )? {
                    // 已指向 source 或同内容副本：先删旧再按当前方式重建（symlink/copy 切换需要）
                    Some(()) => Self::remove_path(&dest)?,
                    // 不存在：无需处理；悬空 symlink（无数据风险）：移除旧值后再建
                    None => {
                        if Self::is_symlink(&dest) {
                            Self::remove_path(&dest)?;
                        }
                    }
                }
                fs::create_dir_all(&dest_root)?;
                match method {
                    SyncMethod::Symlink => Self::create_symlink(&source, &dest)?,
                    SyncMethod::Copy => Self::copy_dir_recursive(&source, &dest)?,
                    SyncMethod::Auto => {
                        if let Err(err) = Self::create_symlink(&source, &dest) {
                            log::warn!("项目技能 symlink 失败，回退为复制: {err}");
                            Self::copy_dir_recursive(&source, &dest)?;
                        }
                    }
                }
                done += 1;
            }

            // 重建后持久化当前方式，后续 toggle 与新建分发保持一致
            if record.deploy_method != method_raw {
                record.deploy_method = method_raw.to_string();
                db.update_skill_metadata(&record)?;
            }
        }
        Ok(done)
    }

    /// 存量项目级技能存储布局迁移：原文件从 `<project>/.claude/skills/<dir>`
    /// 搬到中央库 `<library>/projects/<项目键>/<dir>`，并在原位置按部署方式重建
    /// （symlink / copy），`enabled_tools` 为空时补 claude-code。
    /// best-effort：逐条独立，失败仅记录日志并跳过——`skill_storage_dir` 的旧版兜底
    /// 保证未迁移完成的安装仍可读、可更新、可卸载。
    /// 返回成功迁移的条数；重复执行幂等（新位置已存在即跳过）。
    pub fn migrate_project_storage_layout(db: &Database) -> Result<usize> {
        let skills = db.get_all_skills()?;
        let mut migrated = 0;
        for record in skills.values().filter(|s| s.is_project()) {
            let directory = match Self::require_valid_directory(&record.directory) {
                Ok(directory) => directory,
                Err(e) => {
                    log::error!("项目存储布局迁移跳过 {}：directory 非法: {e}", record.id);
                    continue;
                }
            };
            let Some(project_path) = record.project_path.as_deref() else {
                log::error!("项目存储布局迁移跳过 {}：缺少 project_path", record.id);
                continue;
            };
            let new_dir = match Self::get_library_dir(db) {
                Ok(lib) => lib
                    .join("projects")
                    .join(Self::project_storage_namespace(project_path))
                    .join(&directory),
                Err(e) => {
                    log::error!("项目存储布局迁移跳过 {}：{e}", record.id);
                    continue;
                }
            };
            if new_dir.exists() {
                continue; // 已是新布局
            }
            let legacy = Self::legacy_project_storage_dir(project_path, &directory);
            if !legacy.exists() {
                continue; // 没有可迁移的原文件（项目目录已不在等情况）
            }

            // 1. 移动原文件到中央库命名空间（rename 优先，跨盘 copy+delete）
            if let Some(parent) = new_dir.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    log::error!("项目存储布局迁移 {} 失败（创建命名空间目录）: {e}", record.id);
                    continue;
                }
            }
            let moved: Result<()> = match fs::rename(&legacy, &new_dir) {
                Ok(()) => Ok(()),
                Err(_) => (|| {
                    Self::copy_dir_recursive(&legacy, &new_dir)?;
                    fs::remove_dir_all(&legacy)?;
                    Ok(())
                })(),
            };
            if let Err(e) = moved {
                log::error!(
                    "项目存储布局迁移 {} 失败（移动原文件 {} -> {}）: {e}",
                    record.id,
                    legacy.display(),
                    new_dir.display()
                );
                continue;
            }

            // 2. 原位置按部署方式重建（失败不致命：原文件已在新位置，仍可读可卸载）
            let rebuilt: Result<()> = (|| {
                if let Some(parent) = legacy.parent() {
                    fs::create_dir_all(parent)?;
                }
                match SyncMethod::from_str(&record.deploy_method) {
                    SyncMethod::Symlink => Self::create_symlink(&new_dir, &legacy)?,
                    SyncMethod::Copy => Self::copy_dir_recursive(&new_dir, &legacy)?,
                    SyncMethod::Auto => {
                        if let Err(err) = Self::create_symlink(&new_dir, &legacy) {
                            log::warn!("项目存储布局迁移 {}：symlink 失败，回退复制: {err}", record.id);
                            Self::copy_dir_recursive(&new_dir, &legacy)?;
                        }
                    }
                }
                Ok(())
            })();
            if let Err(e) = rebuilt {
                log::error!(
                    "项目存储布局迁移 {}：原文件已入中央库，但原位置重建失败: {e}",
                    record.id
                );
            }

            // 3. enabled_tools 为空时补 claude-code（旧安装事实上经 .claude/skills 生效）
            if record.enabled_tools.is_empty() {
                if let Err(e) =
                    db.update_skill_enabled_tools(&record.id, &["claude-code".to_string()])
                {
                    log::warn!("项目存储布局迁移 {}：补默认 enabled_tools 失败: {e}", record.id);
                }
            }
            migrated += 1;
        }
        if migrated > 0 {
            log::info!("项目级技能存储布局迁移完成：{migrated} 条");
        }
        Ok(migrated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, content) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn build_zip_with_symlink(entries: &[(&str, &[u8])], links: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, content) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content).unwrap();
        }
        for (name, target) in links {
            writer
                .add_symlink(*name, *target, SimpleFileOptions::default())
                .unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn extract_repo(bytes: Vec<u8>, dest: &Path) -> Result<()> {
        SkillService::extract_repo_archive(zip::ZipArchive::new(std::io::Cursor::new(bytes))?, dest)
    }

    fn extract_plain(bytes: Vec<u8>, dest: &Path) -> Result<()> {
        SkillService::extract_zip_archive_plain(
            zip::ZipArchive::new(std::io::Cursor::new(bytes))?,
            dest,
        )
    }

    // ========== require_valid_directory ==========

    #[test]
    fn sanitize_install_name_enforces_windows_safe_names() {
        // 合法名放行
        assert_eq!(
            SkillService::sanitize_install_name("my-skill"),
            Some("my-skill".to_string())
        );
        assert_eq!(
            SkillService::sanitize_install_name("  padded  "),
            Some("padded".to_string())
        );
        // 路径分隔符 / 隐藏名 / 点段拒绝
        assert!(SkillService::sanitize_install_name("a/b").is_none());
        assert!(SkillService::sanitize_install_name("a\\b").is_none());
        assert!(SkillService::sanitize_install_name(".hidden").is_none());
        assert!(SkillService::sanitize_install_name(".").is_none());
        assert!(SkillService::sanitize_install_name("..").is_none());
        assert!(SkillService::sanitize_install_name("").is_none());
        assert!(SkillService::sanitize_install_name("   ").is_none());
        // Windows 会静默剥离尾点/尾空格，落盘名与声明名不一致：尾点拒绝，尾空格归一化
        assert!(SkillService::sanitize_install_name("skill.").is_none());
        assert_eq!(
            SkillService::sanitize_install_name("skill "),
            Some("skill".to_string())
        );
        // 非法字符与控制字符
        assert!(SkillService::sanitize_install_name("a<b>c").is_none());
        assert!(SkillService::sanitize_install_name("a:b").is_none());
        assert!(SkillService::sanitize_install_name("a\"b").is_none());
        assert!(SkillService::sanitize_install_name("a|b").is_none());
        assert!(SkillService::sanitize_install_name("a?b").is_none());
        assert!(SkillService::sanitize_install_name("a*b").is_none());
        assert!(SkillService::sanitize_install_name("a\nb").is_none());
        // Windows 保留设备名（大小写不敏感，含带扩展名形式）
        for reserved in ["CON", "con", "Prn", "aux", "NUL", "com1", "LPT9"] {
            assert!(
                SkillService::sanitize_install_name(reserved).is_none(),
                "应拒绝保留名: {reserved}"
            );
        }
        assert!(SkillService::sanitize_install_name("con.txt").is_none());
        // 超长组件（>255 字节）
        assert!(SkillService::sanitize_install_name(&"a".repeat(256)).is_none());
        assert_eq!(
            SkillService::sanitize_install_name(&"a".repeat(255)),
            Some("a".repeat(255))
        );
    }

    #[test]
    fn require_valid_directory_rejects_traversal() {
        assert!(SkillService::require_valid_directory("..").is_err());
        assert!(SkillService::require_valid_directory("../evil").is_err());
        assert!(SkillService::require_valid_directory("a/b").is_err());
        assert!(SkillService::require_valid_directory("a\\b").is_err());
        assert!(SkillService::require_valid_directory(".hidden").is_err());
        assert!(SkillService::require_valid_directory(" padded ").is_err());
        assert!(SkillService::require_valid_directory("").is_err());
        assert_eq!(
            SkillService::require_valid_directory("my-skill").unwrap(),
            "my-skill"
        );
    }

    // ========== compute_dir_hash ==========

    #[test]
    fn compute_dir_hash_is_stable_and_ignores_hidden_files() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("skill");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("SKILL.md"), "# hello").unwrap();
        fs::write(dir.join("sub/a.txt"), "a").unwrap();

        let h1 = SkillService::compute_dir_hash(&dir).unwrap();
        let h2 = SkillService::compute_dir_hash(&dir).unwrap();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);

        // 隐藏文件不计入
        fs::write(dir.join(".hidden"), "x").unwrap();
        assert_eq!(SkillService::compute_dir_hash(&dir).unwrap(), h1);

        // 内容变化 → 哈希变化
        fs::write(dir.join("sub/a.txt"), "b").unwrap();
        assert_ne!(SkillService::compute_dir_hash(&dir).unwrap(), h1);
    }

    #[test]
    fn compute_dir_hash_rejects_excessive_depth() {
        let temp = tempfile::tempdir().unwrap();
        let mut deep = temp.path().join("d0");
        fs::create_dir_all(&deep).unwrap();
        // 超过 32 层深度：必须报错而不是返回 partial hash
        for i in 1..=33 {
            deep = deep.join(format!("d{i}"));
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("SKILL.md"), "deep").unwrap();
        let err = SkillService::compute_dir_hash(temp.path()).expect_err("too deep");
        assert!(
            err.to_string().contains("嵌套超过"),
            "unexpected error: {err}"
        );
    }

    // ========== zip-slip / 预算 ==========

    #[test]
    fn extract_repo_archive_rejects_path_traversal_entries() {
        // 剥掉根目录后剩余 "../evil.txt"：enclosed_name 放行（净深度非负），
        // 第二道 ParentDir 校验必须拦下
        let bytes = build_zip(&[
            ("repo-main/SKILL.md", b"hi"),
            ("repo-main/../evil.txt", b"pwned"),
        ]);
        let temp = tempfile::tempdir().unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        extract_repo(bytes, &dest).unwrap();
        assert!(dest.join("SKILL.md").exists());
        assert!(!temp.path().join("evil.txt").exists());
        assert!(!dest.join("../evil.txt").exists());
    }

    #[test]
    fn extract_zip_archive_plain_rejects_dot_dot_entries() {
        let bytes = build_zip(&[("a/../evil.txt", b"pwned"), ("ok.txt", b"ok")]);
        let temp = tempfile::tempdir().unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        extract_plain(bytes, &dest).unwrap();
        assert!(dest.join("ok.txt").exists());
        assert!(!temp.path().join("evil.txt").exists());
    }

    #[test]
    fn extract_repo_archive_rejects_too_many_entries() {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for i in 0..=MAX_ARCHIVE_ENTRIES {
            writer
                .start_file(format!("repo-main/f{i}.txt"), SimpleFileOptions::default())
                .unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        let temp = tempfile::tempdir().unwrap();
        let err = extract_repo(bytes, temp.path()).expect_err("must reject");
        assert!(err.to_string().contains("ARCHIVE_TOO_MANY_ENTRIES"));
    }

    /// 每次 read 最多返回 4 字节的读取器（用于验证预算在条目中途被卡住）
    struct ChunkedReader {
        data: Vec<u8>,
        pos: usize,
    }
    impl std::io::Read for ChunkedReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let end = (self.pos + 4).min(self.data.len());
            let n = end - self.pos;
            buf[..n].copy_from_slice(&self.data[self.pos..end]);
            self.pos = end;
            Ok(n)
        }
    }

    #[test]
    fn copy_entry_within_budget_stops_before_exceeding_the_limit() {
        // 12 字节分块读入，剩余预算 6：前 4 字节计入并写入，第 8 字节超限
        let mut reader = ChunkedReader {
            data: vec![0u8; 12],
            pos: 0,
        };
        let mut writer = Vec::new();
        let mut total = MAX_ARCHIVE_TOTAL_BYTES - 6;
        let err = SkillService::copy_entry_within_budget(&mut reader, &mut writer, &mut total)
            .expect_err("budget exceeded");
        assert!(err.to_string().contains("ARCHIVE_TOO_LARGE"));
        // 只写入了预算允许的 4 字节，超限部分未写入，预算计数停在允许值
        assert_eq!(writer.len(), 4);
        assert_eq!(total, MAX_ARCHIVE_TOTAL_BYTES - 2);
    }

    #[test]
    fn symlink_materialization_produces_content_copies() {
        let bytes = build_zip_with_symlink(
            &[("repo-main/big.bin", &[7u8; 32 * 1024])],
            &[("repo-main/link.bin", "big.bin")],
        );
        let temp = tempfile::tempdir().unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        extract_repo(bytes, &dest).unwrap();
        // symlink 被物化为内容副本
        let materialized = dest.join("link.bin");
        assert!(materialized.is_file());
        assert!(!SkillService::is_symlink(&materialized));
        assert_eq!(fs::read(&materialized).unwrap(), vec![7u8; 32 * 1024]);
    }

    #[test]
    fn symlink_materialization_is_charged_to_the_archive_budget() {
        // 物化走第二遍独立代码路径；不计费则「一个大文件 + N 个 symlink」能写 N 倍字节
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("base");
        fs::create_dir_all(base.join("payload")).unwrap();
        fs::write(base.join("payload").join("big.bin"), vec![b'x'; 4096]).unwrap();

        let symlinks = vec![(base.join("copy"), "payload".to_string())];
        let mut total_bytes = MAX_ARCHIVE_TOTAL_BYTES - 1024;

        let err = SkillService::resolve_symlinks_in_dir(&base, &symlinks, &mut total_bytes)
            .expect_err("4 KiB 物化在仅剩 1 KiB 预算时必须失败");
        assert!(err.to_string().contains("ARCHIVE_TOO_LARGE"));
    }

    #[test]
    fn directory_materialization_is_charged_to_the_archive_budget() {
        let temp = tempfile::tempdir().unwrap();
        let mut total = MAX_ARCHIVE_TOTAL_BYTES - DIRECTORY_BUDGET_COST;
        let deep = temp.path().join("a/b/c");
        let err = SkillService::create_dir_all_within_budget(&deep, &mut total)
            .expect_err("3 new dirs exceed remaining budget of 1");
        assert!(err.to_string().contains("ARCHIVE_TOO_LARGE"));

        let mut total = 0u64;
        SkillService::create_dir_all_within_budget(&deep, &mut total).unwrap();
        assert!(deep.is_dir());
        assert_eq!(total, 3 * DIRECTORY_BUDGET_COST);
    }

    #[test]
    fn extract_repo_archive_skips_a_symlink_that_contains_itself() {
        // dir/link -> .. 解析后是归档根自身，递归复制会逐层膨胀，必须跳过
        let bytes = build_zip_with_symlink(
            &[("repo-main/dir/f.txt", b"x")],
            &[("repo-main/dir/link", "..")],
        );
        let temp = tempfile::tempdir().unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        extract_repo(bytes, &dest).unwrap();
        assert!(dest.join("dir/f.txt").exists());
        assert!(!dest.join("dir/link").exists());
    }

    #[test]
    fn extract_local_zip_leaves_no_partial_directory_when_it_fails() {
        let base = tempfile::tempdir().unwrap();
        // 构造超限 zip（条目数超限）
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for i in 0..=MAX_ARCHIVE_ENTRIES {
            writer
                .start_file(format!("f{i}.txt"), SimpleFileOptions::default())
                .unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        let zip_path = base.path().join("bomb.zip");
        fs::write(&zip_path, bytes).unwrap();

        let err = SkillService::extract_local_zip_in(&zip_path, base.path())
            .expect_err("must fail");
        assert!(err.to_string().contains("ARCHIVE_TOO_MANY_ENTRIES"));
        // 除了 zip 文件本身，base 里不能有解压残留
        let leftovers: Vec<_> = fs::read_dir(base.path())
            .unwrap()
            .flatten()
            .filter(|e| e.path() != zip_path)
            .collect();
        assert!(leftovers.is_empty(), "残留: {leftovers:?}");
    }

    #[test]
    fn extract_local_zip_rejects_dot_dot_entries() {
        let base = tempfile::tempdir().unwrap();
        let bytes = build_zip(&[("../evil.txt", b"pwned"), ("skill/SKILL.md", b"hi")]);
        let zip_path = base.path().join("evil.zip");
        fs::write(&zip_path, bytes).unwrap();
        let guard = SkillService::extract_local_zip_in(&zip_path, base.path()).unwrap();
        assert!(guard.path().join("skill/SKILL.md").exists());
        assert!(!base.path().join("evil.txt").exists());
    }

    // ========== resolve_skill_source_dir ==========

    fn write_skill(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("SKILL.md"), "---\nname: test\n---\n").unwrap();
    }

    #[test]
    fn resolve_skill_source_dir_returns_repo_root_for_root_level_skill() {
        let temp = tempfile::tempdir().unwrap();
        write_skill(temp.path());
        let found = SkillService::resolve_skill_source_dir(temp.path(), "myrepo").unwrap();
        assert_eq!(found.as_deref(), Some(temp.path()));
    }

    #[test]
    fn resolve_skill_source_dir_returns_direct_nested_directory() {
        let temp = tempfile::tempdir().unwrap();
        write_skill(&temp.path().join("skills/foo"));
        let found = SkillService::resolve_skill_source_dir(temp.path(), "skills/foo").unwrap();
        assert_eq!(found.as_deref(), Some(temp.path().join("skills/foo").as_path()));
    }

    #[test]
    fn resolve_skill_source_dir_falls_back_to_matching_install_name() {
        let temp = tempfile::tempdir().unwrap();
        write_skill(&temp.path().join("catalog/deep/foo"));
        // 声明路径不存在，但末段名能递归命中
        let found = SkillService::resolve_skill_source_dir(temp.path(), "missing/foo").unwrap();
        assert_eq!(
            found.as_deref(),
            Some(temp.path().join("catalog/deep/foo").as_path())
        );
    }

    #[test]
    fn resolve_skill_source_dir_rejects_same_name_wrapper_without_skill_md() {
        let temp = tempfile::tempdir().unwrap();
        // wrapper 目录名匹配但没有 SKILL.md，真实技能在内层
        fs::create_dir_all(temp.path().join("ast-grep")).unwrap();
        write_skill(&temp.path().join("ast-grep/agent-skill"));
        let found = SkillService::resolve_skill_source_dir(temp.path(), "ast-grep/agent-skill")
            .unwrap();
        assert_eq!(
            found.as_deref(),
            Some(temp.path().join("ast-grep/agent-skill").as_path())
        );
    }

    #[test]
    fn resolve_skill_source_dir_returns_none_when_no_skill_md_anywhere() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join("a/b")).unwrap();
        fs::write(temp.path().join("a/b/readme.txt"), "x").unwrap();
        assert!(
            SkillService::resolve_skill_source_dir(temp.path(), "a/b")
                .unwrap()
                .is_none()
        );
    }

    // ========== 仓库坐标校验 ==========

    #[test]
    fn validate_repo_ref_accepts_real_world_coordinates() {
        SkillService::validate_repo_ref("anthropics", "skills", "main").unwrap();
        SkillService::validate_repo_ref("ComposioHQ", "awesome-claude-skills", "master").unwrap();
        SkillService::validate_repo_ref("a", "b.c_d-e", "feature/x.y").unwrap();
        // 空串与 HEAD 是默认分支哨兵
        SkillService::validate_repo_ref("a", "b", "").unwrap();
        SkillService::validate_repo_ref("a", "b", "HEAD").unwrap();
    }

    #[test]
    fn validate_repo_ref_rejects_url_hijacking() {
        assert!(SkillService::validate_repo_ref("evil/owner", "repo", "main").is_err());
        assert!(SkillService::validate_repo_ref("owner", "..", "main").is_err());
        assert!(SkillService::validate_repo_ref("owner", "repo", "../../../releases/download/v1/evil").is_err());
        assert!(SkillService::validate_repo_ref("owner", "repo", "a/./b").is_err());
        assert!(SkillService::validate_repo_ref("owner", "repo", "a%2fb").is_err());
        assert!(SkillService::validate_repo_ref("owner", "repo", "branch#frag").is_err());
        // 连续两点与前导连字符同样是 git 拒绝的引用形态
        assert!(SkillService::validate_repo_ref("owner", "repo", "a..b").is_err());
        assert!(SkillService::validate_repo_ref("owner", "repo", "-x").is_err());
        assert!(SkillService::validate_repo_ref("owner", "repo", "feat/-x").is_err());
    }

    #[test]
    fn assert_github_archive_url_pins_host_and_path() {
        SkillService::assert_github_archive_url(
            "https://github.com/anthropics/skills/archive/refs/heads/main.zip",
            "anthropics",
            "skills",
        )
        .unwrap();
        assert!(SkillService::assert_github_archive_url(
            "https://evil.com/anthropics/skills/archive/refs/heads/main.zip",
            "anthropics",
            "skills",
        )
        .is_err());
        assert!(SkillService::assert_github_archive_url(
            "https://github.com/anthropics/other/archive/refs/heads/main.zip",
            "anthropics",
            "skills",
        )
        .is_err());
        assert!(SkillService::assert_github_archive_url(
            "http://github.com/anthropics/skills/archive/refs/heads/main.zip",
            "anthropics",
            "skills",
        )
        .is_err());
    }

    // ========== 标签 / 项目守卫 ==========

    #[test]
    fn project_skill_id_suffixes_deterministically_on_conflict() {
        let mut skills = IndexMap::new();
        assert_eq!(
            SkillService::project_skill_id("owner/repo:a", &skills, "/p"),
            "owner/repo:a"
        );
        let record = SkillRecord {
            id: "owner/repo:a".to_string(),
            name: "a".to_string(),
            display_name: "a".to_string(),
            description: None,
            display_description: None,
            description_status: "pending".to_string(),
            directory: "a".to_string(),
            tags: vec![],
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_id: None,
            project_path: None,
            source_type: "github".to_string(),
            source_repo: Some("owner/repo".to_string()),
            source_branch: None,
            source_subpath: None,
            source_author: None,
            source_registry_id: None,
            source_url: None,
            source_github_detected: false,
            current_commit: None,
            latest_commit: None,
            has_update: false,
            content_hash: None,
            enabled_tools: vec![],
            deploy_method: "auto".to_string(),
            installed_at: 1,
            updated_at: 0,
            author: None,
            license: None,
        };
        skills.insert(record.id.clone(), record);
        let id1 = SkillService::project_skill_id("owner/repo:a", &skills, "/p");
        let id2 = SkillService::project_skill_id("owner/repo:a", &skills, "/p");
        // 冲突时加后缀且确定性；不同项目路径后缀不同
        assert_eq!(id1, id2);
        assert!(id1.starts_with("owner/repo:a#project:"));
        assert_ne!(id1, "owner/repo:a");
        assert_ne!(
            id1,
            SkillService::project_skill_id("owner/repo:a", &skills, "/other")
        );
    }

    #[test]
    fn ensure_no_global_conflict_rejects_same_name_global_skill() {
        let global = SkillRecord {
            id: "owner/repo:a".to_string(),
            name: "全局技能".to_string(),
            display_name: "全局技能".to_string(),
            description: None,
            display_description: None,
            description_status: "pending".to_string(),
            directory: "dup".to_string(),
            tags: vec![],
            scope: SKILL_SCOPE_GLOBAL.to_string(),
            project_id: None,
            project_path: None,
            source_type: "github".to_string(),
            source_repo: None,
            source_branch: None,
            source_subpath: None,
            source_author: None,
            source_registry_id: None,
            source_url: None,
            source_github_detected: false,
            current_commit: None,
            latest_commit: None,
            has_update: false,
            content_hash: None,
            enabled_tools: vec![],
            deploy_method: "auto".to_string(),
            installed_at: 1,
            updated_at: 0,
            author: None,
            license: None,
        };
        let skills = vec![global];
        let err = SkillService::ensure_no_global_conflict(skills.iter(), "DUP")
            .expect_err("case-insensitive conflict");
        assert!(err.to_string().starts_with(SKILL_GLOBAL_CONFLICT_PREFIX));

        // 不同名放行
        SkillService::ensure_no_global_conflict(skills.iter(), "other").unwrap();
        // 项目级同名不冲突
        let mut project = skills[0].clone();
        project.scope = SKILL_SCOPE_PROJECT.to_string();
        SkillService::ensure_no_global_conflict([project].iter(), "dup").unwrap();
    }

    #[test]
    fn replace_dest_with_copy_rejects_empty_source() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("empty");
        fs::create_dir_all(&source).unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("keep.txt"), "keep").unwrap();
        // 源缺少 SKILL.md → 拒绝且不触碰 dest
        assert!(SkillService::replace_dest_with_copy(&source, &dest, "x").is_err());
        assert!(dest.join("keep.txt").exists());
    }

    #[test]
    fn replace_dest_with_copy_rolls_back_when_final_rename_fails() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "new skill").unwrap();
        let dest = temp.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("keep.txt"), "keep").unwrap();

        // 第一次 rename（dest→backup）放行，第二次（tmp→dest）注入失败
        RENAME_FAIL_AFTER.with(|c| c.set(Some(1)));
        let err = SkillService::replace_dest_with_copy(&source, &dest, "x").unwrap_err();
        RENAME_FAIL_AFTER.with(|c| c.set(None));

        assert!(
            err.to_string().contains("替换 Skill 目录失败"),
            "unexpected error: {err}"
        );
        // dest 回滚为原内容，未被新内容污染
        assert_eq!(fs::read_to_string(dest.join("keep.txt")).unwrap(), "keep");
        assert!(!dest.join("SKILL.md").exists());
        // 无 tmp / backup 暂存残留
        let leftovers: Vec<String> = fs::read_dir(temp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with('.'))
            .collect();
        assert!(leftovers.is_empty(), "暂存目录残留: {leftovers:?}");
    }

    // ========== 主路径：migrate_library / save_settings / check_updates ==========

    fn memory_db_with_library(library: &Path) -> Database {
        let db = Database::memory().unwrap();
        db.set_setting("library_path", &library.display().to_string())
            .unwrap();
        db
    }

    fn test_skill_record(id: &str, directory: &str, scope: &str, project_path: Option<&str>) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: directory.to_string(),
            display_name: directory.to_string(),
            description: None,
            display_description: None,
            description_status: "pending".to_string(),
            directory: directory.to_string(),
            tags: vec![],
            scope: scope.to_string(),
            project_id: project_path.map(|p| p.to_string()),
            project_path: project_path.map(|p| p.to_string()),
            source_type: "github".to_string(),
            source_repo: Some(format!("owner/{id}")),
            source_branch: None,
            source_subpath: None,
            source_author: None,
            source_registry_id: None,
            source_url: None,
            source_github_detected: false,
            current_commit: None,
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

    fn test_tool(id: &str, current_path: &str) -> ToolAdapter {
        ToolAdapter {
            id: id.to_string(),
            name: id.to_string(),
            vendor: "test".to_string(),
            description: String::new(),
            default_path: current_path.to_string(),
            current_path: current_path.to_string(),
            is_builtin: false,
            is_enabled: true,
            installed_skills_count: 0,
            detected: true,
            version: None,
            color: "#000000".to_string(),
        }
    }

    /// 本地技能目录位于 home 之下（如 <home>/.claude/skills）的测试工具：
    /// 项目内目录由本地目录去掉 home 根推导得出（.claude/skills）
    fn test_tool_under_home(id: &str, home: &Path, subdir: &str) -> ToolAdapter {
        test_tool(id, &home.join(subdir).display().to_string())
    }

    fn test_project_meta(install_name: &str, tool_ids: &[&str]) -> ProjectInstallMeta {
        ProjectInstallMeta {
            directory: install_name.to_string(),
            source_type: "github".to_string(),
            source_repo: Some(format!("owner/{install_name}")),
            source_branch: Some("main".to_string()),
            source_subpath: None,
            source_author: None,
            source_registry_id: None,
            source_url: None,
            source_github_detected: false,
            current_commit: None,
            display_name: None,
            input_description: None,
            tags: vec![],
            enabled_tools: tool_ids.iter().map(|s| s.to_string()).collect(),
            deploy_method: "auto".to_string(),
        }
    }

    fn write_source_skill(root: &Path, name: &str) -> PathBuf {
        let source = root.join(format!("src-{name}"));
        fs::create_dir_all(&source).unwrap();
        fs::write(
            source.join("SKILL.md"),
            format!("---\nname: {name}\n---\n\n# {name}\n"),
        )
        .unwrap();
        source
    }

    /// 在中央库 projects 命名空间下找指定技能的原文件目录
    fn find_in_projects_ns(library: &Path, install_name: &str) -> Option<PathBuf> {
        fs::read_dir(library.join("projects"))
            .ok()?
            .flatten()
            .map(|e| e.path().join(install_name))
            .find(|p| p.join("SKILL.md").is_file())
    }

    #[test]
    fn migrate_library_moves_all_entries_and_persists_setting() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old-lib");
        let new = temp.path().join("new-lib");
        fs::create_dir_all(old.join("skill-a")).unwrap();
        fs::write(old.join("skill-a/SKILL.md"), "a").unwrap();
        fs::create_dir_all(old.join("skill-b")).unwrap();
        fs::write(old.join("skill-b/SKILL.md"), "b").unwrap();
        let db = memory_db_with_library(&old);

        let result = SkillService::migrate_library(&db, &new.display().to_string()).unwrap();
        assert_eq!(result.migrated_count, 2);
        assert_eq!(result.skipped_count, 0);
        assert!(new.join("skill-a/SKILL.md").exists());
        assert!(new.join("skill-b/SKILL.md").exists());
        assert!(!old.join("skill-a").exists());
        assert_eq!(
            db.get_setting("library_path").unwrap().unwrap(),
            new.display().to_string()
        );
    }

    #[test]
    fn migrate_library_skips_existing_destination_names() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old-lib");
        let new = temp.path().join("new-lib");
        fs::create_dir_all(old.join("skill-a")).unwrap();
        fs::write(old.join("skill-a/SKILL.md"), "old-a").unwrap();
        fs::create_dir_all(old.join("skill-b")).unwrap();
        fs::write(old.join("skill-b/SKILL.md"), "b").unwrap();
        // 目标已存在同名目录
        fs::create_dir_all(new.join("skill-a")).unwrap();
        fs::write(new.join("skill-a/SKILL.md"), "new-a").unwrap();
        let db = memory_db_with_library(&old);

        let result = SkillService::migrate_library(&db, &new.display().to_string()).unwrap();
        assert_eq!(result.migrated_count, 1);
        assert_eq!(result.skipped_count, 1);
        assert_eq!(result.skipped, vec!["skill-a".to_string()]);
        // 跳过的条目旧目录保持原样，新目录内容不被覆盖
        assert_eq!(
            fs::read_to_string(old.join("skill-a/SKILL.md")).unwrap(),
            "old-a"
        );
        assert_eq!(
            fs::read_to_string(new.join("skill-a/SKILL.md")).unwrap(),
            "new-a"
        );
        assert!(new.join("skill-b/SKILL.md").exists());
    }

    #[test]
    fn migrate_library_reports_redeploy_failure_after_moving_files() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("old-lib");
        let new = temp.path().join("new-lib");
        fs::create_dir_all(old.join("skill-x")).unwrap();
        fs::write(old.join("skill-x/SKILL.md"), "x").unwrap();
        let db = memory_db_with_library(&old);

        // 工具的 current_path 落在一个普通文件之下：create_dir_all 必失败，
        // 用来确定性触发重部署失败分支
        let blocker = temp.path().join("not-a-dir");
        fs::write(&blocker, "x").unwrap();
        let broken_tool = test_tool(
            "broken",
            &blocker.join("tools").display().to_string(),
        );
        db.insert_tool_adapter(&broken_tool, 0).unwrap();

        let mut record = test_skill_record("owner/repo:x", "skill-x", SKILL_SCOPE_GLOBAL, None);
        record.enabled_tools = vec!["broken".to_string()];
        db.save_skill(&record).unwrap();

        let err = SkillService::migrate_library(&db, &new.display().to_string())
            .expect_err("redeploy failure must surface");
        assert!(
            err.to_string().contains("重部署失败"),
            "unexpected error: {err}"
        );
        // 文件已迁移且设置已持久化（先迁移后重部署的语义）
        assert!(new.join("skill-x/SKILL.md").exists());
        assert_eq!(
            db.get_setting("library_path").unwrap().unwrap(),
            new.display().to_string()
        );
    }

    #[test]
    fn save_settings_returns_affected_project_skills_only_on_method_change() {
        let temp = tempfile::tempdir().unwrap();
        let lib = temp.path().join("lib");
        fs::create_dir_all(&lib).unwrap();
        let db = memory_db_with_library(&lib);
        db.set_setting("distribution_method", "symlink").unwrap();
        db.save_skill(&test_skill_record(
            "owner/repo:p",
            "proj-skill",
            SKILL_SCOPE_PROJECT,
            Some("/proj"),
        ))
        .unwrap();
        db.save_skill(&test_skill_record(
            "owner/repo:g",
            "global-skill",
            SKILL_SCOPE_GLOBAL,
            None,
        ))
        .unwrap();

        let mut settings = SkillService::get_settings(&db).unwrap();
        settings.distribution_method = "copy".to_string();
        let affected = SkillService::save_settings(&db, &settings).unwrap();
        // 只有项目级技能受影响；全局技能不随分发方式变更
        assert_eq!(affected, vec!["owner/repo:p".to_string()]);
        assert_eq!(
            db.get_setting("distribution_method").unwrap().unwrap(),
            "copy"
        );

        // 方法不变 → 空列表
        let again = SkillService::save_settings(&db, &settings).unwrap();
        assert!(again.is_empty(), "未变更应返回空列表: {again:?}");
    }

    #[test]
    fn remote_dir_matches_covers_missing_renamed_and_case_diff() {
        let skill = test_skill_record("owner/repo:m", "my-skill", SKILL_SCOPE_GLOBAL, None);
        // 远端缺失：目录改名后不再匹配（check_updates 据此清除 has_update）
        assert!(!SkillService::remote_dir_matches(&skill, "renamed-skill"));
        // 末段名匹配（含大小写差异）
        assert!(SkillService::remote_dir_matches(&skill, "my-skill"));
        assert!(SkillService::remote_dir_matches(&skill, "skills/My-Skill"));
        assert!(SkillService::remote_dir_matches(&skill, "catalog/deep/MY-SKILL"));

        // 有 source_subpath 时按全路径段匹配，末段相同但路径不同不算
        let mut subpathed = skill.clone();
        subpathed.source_subpath = Some("skills/my-skill".to_string());
        assert!(SkillService::remote_dir_matches(&subpathed, "skills/my-skill"));
        assert!(SkillService::remote_dir_matches(&subpathed, "SKILLS/My-Skill"));
        assert!(!SkillService::remote_dir_matches(&subpathed, "other/my-skill"));
    }

    #[test]
    fn inspect_destination_classifies_dangling_symlink_by_mode() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "s").unwrap();
        let skills_dir = temp.path().join("skills");
        fs::create_dir_all(&skills_dir).unwrap();

        // 创建 symlink 需要 Windows 开发者模式/管理员权限；无权限时跳过 symlink 相关断言
        let make_link = |target: &Path, link: &Path| -> bool {
            #[cfg(unix)]
            let result = std::os::unix::fs::symlink(target, link);
            #[cfg(windows)]
            let result = std::os::windows::fs::symlink_dir(target, link);
            match result {
                Ok(()) => true,
                Err(e) => {
                    log::warn!("测试环境无法创建 symlink，跳过相关断言: {e}");
                    false
                }
            }
        };

        // 悬空 symlink：重部署可安全覆盖；卸载按外来内容拒绝
        let linked = skills_dir.join("my-skill");
        if make_link(&temp.path().join("gone"), &linked) {
            assert!(SkillService::inspect_destination(
                &source,
                &linked,
                "my-skill",
                DestCheckMode::Redeploy
            )
            .unwrap()
            .is_none());
            assert!(SkillService::inspect_destination(
                &source,
                &linked,
                "my-skill",
                DestCheckMode::Uninstall
            )
            .is_err());
        }

        // 普通文件：重部署/卸载场景一律按外来内容拒绝（安装分发不走此分类，
        // 由 replace_dest_with_copy 原子替换兜底）
        let file_dest = skills_dir.join("file-skill");
        fs::write(&file_dest, "user data").unwrap();
        assert!(SkillService::inspect_destination(
            &source,
            &file_dest,
            "file-skill",
            DestCheckMode::Redeploy
        )
        .is_err());
        assert!(SkillService::inspect_destination(
            &source,
            &file_dest,
            "file-skill",
            DestCheckMode::Uninstall
        )
        .is_err());

        // 指向 source 的 symlink：所有场景都认领归属
        let good_link = skills_dir.join("good-skill");
        if make_link(&source, &good_link) {
            for mode in [DestCheckMode::Redeploy, DestCheckMode::Uninstall] {
                assert!(
                    SkillService::inspect_destination(&source, &good_link, "good-skill", mode)
                        .unwrap()
                        .is_some(),
                    "指向 source 的链接应被认领: {mode:?}"
                );
            }
        }
    }

    // ========== 项目级安装：中央库命名空间 + 按工具项目内目录分发 ==========

    #[test]
    fn project_storage_namespace_is_stable_and_isolated() {
        // 同一项目键稳定；不同项目键不同（含清洗后可能相同的路径）
        assert_eq!(
            SkillService::project_storage_namespace("/home/me/proj"),
            SkillService::project_storage_namespace("/home/me/proj")
        );
        assert_ne!(
            SkillService::project_storage_namespace("/home/me/a"),
            SkillService::project_storage_namespace("/home/me/b")
        );
        // Windows 盘符/冒号被清洗，不进入文件系统
        let ns = SkillService::project_storage_namespace("D:\\01-Projects\\demo");
        assert!(!ns.contains(':'), "命名空间不应含冒号: {ns}");
        assert!(!ns.contains('\\'), "命名空间不应含反斜杠: {ns}");
    }

    #[test]
    fn tool_project_subdir_derives_from_local_path_under_home() {
        let home = config::get_home_dir().expect("home");
        // ~/.claude/skills → .claude/skills（用户规则：去掉 home 根）
        let tool = test_tool("claude", &home.join(".claude/skills").display().to_string());
        assert_eq!(
            SkillService::tool_project_subdir(&tool, &home).as_deref(),
            Some(".claude/skills")
        );
        // ~/.gemini/config/skills → .gemini/config/skills（多级相对路径）
        let tool = test_tool("ag", &home.join(".gemini/config/skills").display().to_string());
        assert_eq!(
            SkillService::tool_project_subdir(&tool, &home).as_deref(),
            Some(".gemini/config/skills")
        );
        // 本地目录不在 home 下 → 不参与项目级分发
        let outside = if cfg!(windows) { r"D:\tools\skills" } else { "/opt/tools/skills" };
        let tool = test_tool("custom", outside);
        assert!(SkillService::tool_project_subdir(&tool, &home).is_none());
        // 等于 home 本身 → 无相对路径
        let tool = test_tool("root", &home.display().to_string());
        assert!(SkillService::tool_project_subdir(&tool, &home).is_none());
    }

    #[test]
    fn install_dir_to_project_stores_in_library_and_deploys_to_each_tool() {
        let temp = tempfile::tempdir().unwrap();
        let library = temp.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let db = memory_db_with_library(&library);
        let home = config::get_home_dir().expect("home");
        let project_root = temp.path().join("proj");
        fs::create_dir_all(&project_root).unwrap();
        let project = (1i64, "proj".to_string(), project_root.display().to_string(), 1);

        let tool_a =
            test_tool_under_home("tool-a", &home, ".claude/skills");
        let tool_b = test_tool_under_home("tool-b", &home, ".codex/skills");
        db.insert_tool_adapter(&tool_a, 0).unwrap();
        db.insert_tool_adapter(&tool_b, 1).unwrap();

        let source = write_source_skill(temp.path(), "my-skill");
        let record = SkillService::install_dir_to_project(
            &db,
            &project,
            &source,
            "my-skill",
            test_project_meta("my-skill", &["tool-a", "tool-b"]),
        )
        .expect("install to project");

        // 原文件入中央库 projects 命名空间
        let stored = find_in_projects_ns(&library, "my-skill").expect("库内命名空间存在原文件");
        assert!(stored.join("SKILL.md").is_file());

        // 两个工具的项目内目录都出现分发（symlink 或 copy 均可，探测内容即可）
        for subdir in [".claude/skills", ".codex/skills"] {
            let dest = project_root.join(subdir).join("my-skill");
            assert!(
                dest.join("SKILL.md").is_file(),
                "{subdir} 应存在分发内容"
            );
        }

        // 记录实际参与分发的工具
        assert_eq!(
            record.enabled_tools,
            vec!["tool-a".to_string(), "tool-b".to_string()]
        );
    }

    #[test]
    fn install_dir_to_project_isolates_same_name_skills_across_projects() {
        let temp = tempfile::tempdir().unwrap();
        let library = temp.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let db = memory_db_with_library(&library);

        let project_a = temp.path().join("proj-a");
        let project_b = temp.path().join("proj-b");
        fs::create_dir_all(&project_a).unwrap();
        fs::create_dir_all(&project_b).unwrap();

        let source = write_source_skill(temp.path(), "dup-skill");
        for (idx, root) in [&project_a, &project_b].iter().enumerate() {
            let project = (idx as i64 + 1, "p".to_string(), root.display().to_string(), 1);
            SkillService::install_dir_to_project(
                &db,
                &project,
                &source,
                "dup-skill",
                test_project_meta("dup-skill", &[]),
            )
            .expect("install to project");
        }

        // 两个项目各有一份原文件，互不覆盖
        let ns_dirs: Vec<PathBuf> = fs::read_dir(library.join("projects"))
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .collect();
        assert_eq!(ns_dirs.len(), 2, "两个项目应有两个命名空间目录");
        for ns in &ns_dirs {
            assert!(ns.join("dup-skill/SKILL.md").is_file());
        }
    }

    #[test]
    fn install_dir_to_project_rolls_back_when_tool_deploy_fails() {
        let temp = tempfile::tempdir().unwrap();
        let library = temp.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let db = memory_db_with_library(&library);
        let home = config::get_home_dir().expect("home");
        let project_root = temp.path().join("proj");
        fs::create_dir_all(&project_root).unwrap();
        let project = (1i64, "proj".to_string(), project_root.display().to_string(), 1);

        // tool-a 正常；tool-b 推导出的项目内目录 <proj>/.codex/skills 被普通文件
        // <proj>/.codex 挡住，create_dir_all 必失败
        let tool_a = test_tool_under_home("tool-a", &home, ".claude/skills");
        let tool_b = test_tool_under_home("tool-b", &home, ".codex/skills");
        db.insert_tool_adapter(&tool_a, 0).unwrap();
        db.insert_tool_adapter(&tool_b, 1).unwrap();
        fs::write(project_root.join(".codex"), "x").unwrap();

        let source = write_source_skill(temp.path(), "my-skill");
        SkillService::install_dir_to_project(
            &db,
            &project,
            &source,
            "my-skill",
            test_project_meta("my-skill", &["tool-a", "tool-b"]),
        )
        .expect_err("部署失败必须整体报错");

        // 整体回滚：库内原文件与已部署条目都被清理，DB 无记录
        assert!(
            find_in_projects_ns(&library, "my-skill").is_none(),
            "库内原文件应被清理"
        );
        assert!(
            !project_root.join(".claude/skills/my-skill").exists(),
            "已部署条目应被回滚"
        );
        assert!(db.get_all_skills().unwrap().is_empty(), "DB 不应留下记录");
    }

    #[test]
    fn uninstall_project_skill_keeps_foreign_files_in_legacy_locations() {
        let temp = tempfile::tempdir().unwrap();
        let library = temp.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let db = memory_db_with_library(&library);
        let home = config::get_home_dir().expect("home");
        let project_root = temp.path().join("proj");
        fs::create_dir_all(&project_root).unwrap();
        let project = (1i64, "proj".to_string(), project_root.display().to_string(), 1);

        let tool_a =
            test_tool_under_home("tool-a", &home, ".claude/skills");
        db.insert_tool_adapter(&tool_a, 0).unwrap();

        let source = write_source_skill(temp.path(), "my-skill");
        let record = SkillService::install_dir_to_project(
            &db,
            &project,
            &source,
            "my-skill",
            test_project_meta("my-skill", &["tool-a"]),
        )
        .expect("install");

        // 用户在遗留共享位置 <proj>/skills/my-skill 放了自己的普通文件
        let legacy_dir = project_root.join("skills");
        fs::create_dir_all(&legacy_dir).unwrap();
        fs::write(legacy_dir.join("my-skill"), "user data").unwrap();

        SkillService::uninstall(&db, &record.id).expect("uninstall");

        // 库内原文件与工具分发已删；外来文件保留
        assert!(find_in_projects_ns(&library, "my-skill").is_none());
        assert!(!project_root.join(".claude/skills/my-skill").exists());
        assert_eq!(
            fs::read_to_string(legacy_dir.join("my-skill")).unwrap(),
            "user data",
            "外来文件必须保留"
        );
        assert!(db.get_skill(&record.id).unwrap().is_none(), "DB 行已删");
    }

    #[test]
    fn toggle_tool_project_scope_deploys_and_removes_single_tool() {
        let temp = tempfile::tempdir().unwrap();
        let library = temp.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let db = memory_db_with_library(&library);
        let home = config::get_home_dir().expect("home");
        let project_root = temp.path().join("proj");
        fs::create_dir_all(&project_root).unwrap();
        let project = (1i64, "proj".to_string(), project_root.display().to_string(), 1);

        let tool_a =
            test_tool_under_home("tool-a", &home, ".claude/skills");
        let tool_b = test_tool_under_home("tool-b", &home, ".codex/skills");
        db.insert_tool_adapter(&tool_a, 0).unwrap();
        db.insert_tool_adapter(&tool_b, 1).unwrap();

        let source = write_source_skill(temp.path(), "my-skill");
        let record = SkillService::install_dir_to_project(
            &db,
            &project,
            &source,
            "my-skill",
            test_project_meta("my-skill", &["tool-a"]),
        )
        .expect("install");
        assert!(!project_root.join(".codex/skills/my-skill").exists());

        // 开启 tool-b：只影响 tool-b 的项目内目录
        SkillService::toggle_tool(&db, &record.id, "tool-b", true).expect("toggle on");
        assert!(
            project_root
                .join(".codex/skills/my-skill")
                .join("SKILL.md")
                .is_file()
        );
        assert!(
            project_root
                .join(".claude/skills/my-skill")
                .join("SKILL.md")
                .is_file()
        );

        // 关闭 tool-a：只移除 tool-a 的分发
        SkillService::toggle_tool(&db, &record.id, "tool-a", false).expect("toggle off");
        assert!(!project_root.join(".claude/skills/my-skill").exists());
        assert!(
            project_root
                .join(".codex/skills/my-skill")
                .join("SKILL.md")
                .is_file()
        );

        let updated = db.get_skill(&record.id).unwrap().expect("record");
        assert_eq!(updated.enabled_tools, vec!["tool-b".to_string()]);
        // 原文件仍在中央库
        assert!(find_in_projects_ns(&library, "my-skill").is_some());
    }

    #[test]
    fn migrate_project_storage_layout_moves_original_and_rebuilds() {
        let temp = tempfile::tempdir().unwrap();
        let library = temp.path().join("library");
        fs::create_dir_all(&library).unwrap();
        let db = memory_db_with_library(&library);
        let project_root = temp.path().join("proj");
        fs::create_dir_all(&project_root).unwrap();
        let project_key = project_root.display().to_string();

        // 旧布局：原文件直接在 <proj>/.claude/skills/old-skill
        let legacy = project_root.join(".claude/skills/old-skill");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("SKILL.md"), "---\nname: old-skill\n---\n").unwrap();
        let record = test_skill_record(
            "owner/repo:old",
            "old-skill",
            SKILL_SCOPE_PROJECT,
            Some(&project_key),
        );
        assert!(record.enabled_tools.is_empty());
        db.save_skill(&record).unwrap();

        let migrated = SkillService::migrate_project_storage_layout(&db).expect("migrate");
        assert_eq!(migrated, 1, "应迁移 1 条");

        // 新位置有原文件
        let ns = library
            .join("projects")
            .join(SkillService::project_storage_namespace(&project_key));
        assert!(
            ns.join("old-skill/SKILL.md").is_file(),
            "原文件应入中央库命名空间"
        );

        // 旧位置按部署方式重建（symlink 或 copy 均可）
        assert!(legacy.join("SKILL.md").is_file(), "旧位置应重建为链接/副本");

        // enabled_tools 为空时补 claude-code
        let updated = db.get_skill(&record.id).unwrap().expect("record");
        assert_eq!(updated.enabled_tools, vec!["claude-code".to_string()]);

        // 幂等：再次执行不重复迁移
        assert_eq!(
            SkillService::migrate_project_storage_layout(&db).unwrap(),
            0
        );
    }
}
