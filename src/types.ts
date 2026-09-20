export type ToolId = string;

export type ScopeType = 'global' | 'project';

/** 单个技能的实际分发方式（Skill.deployMethod；'auto' = symlink 优先失败回退 copy，为后端存量记录的主要值） */
export type SkillDeployMethod = 'symlink' | 'copy' | 'auto';

/** 设置项分发方式（后端 save_settings 仅接受这两个值） */
export type DistributionMethod = 'symlink' | 'copy';

export type MainNavTab = 'installed' | 'discovery' | 'tools' | 'projects' | 'settings';

export interface ToolAdapter {
  id: ToolId;
  name: string;
  vendor: string;
  description: string;
  defaultPath: string;
  currentPath: string;
  isBuiltin: boolean;
  isEnabled: boolean; // whether this tool adapter is active in the app
  installedSkillsCount: number;
  detected: boolean;
  version?: string;
  color: string;
}

export interface SkillSource {
  type: 'github' | 'skills_sh' | 'local' | 'url_zip';
  url?: string;
  repo?: string; // e.g. "anthropics/skills-kit"
  branch?: string;
  subpath?: string;
  author?: string;
  registryId?: string; // for skills.sh
  isGitHubDetectedFromLocal?: boolean; // PRD 3.4
  downloadUrl?: string;
}

export interface SkillFile {
  name: string;
  path: string;
  size: string;
  type: 'file' | 'dir';
  children?: SkillFile[];
}

export interface Skill {
  id: string;
  name: string;
  displayName: string;
  /** 中央库内的目录名（skills.sh 来源匹配坐标之一） */
  directory: string;
  description: string;
  tags: string[];
  scope: ScopeType;
  projectId?: string; // if scope === 'project'
  projectName?: string;
  source: SkillSource;
  currentCommit: string; // short SHA, e.g. "7f3b19a"
  latestCommit?: string; // if update available, e.g. "9a2c4e1"
  hasUpdate: boolean;
  updateChangelog?: string;
  installedAt: string;
  lastUpdated: string;
  author: string;
  license: string;
  documentation: string; // Raw SKILL.md markdown text; 列表接口可为空，由 get_skill_detail 填充
  files: SkillFile[];
  deployedTools: Record<ToolId, boolean>; // toolId -> is deployed / enabled
  deployMethod: SkillDeployMethod;
  storagePath: string;
}

export interface ProjectScope {
  id: string;
  name: string;
  path: string;
  skillCount: number;
  registeredAt: string;
  isPathValid: boolean;
}

export interface AppSettings {
  distributionMethod: DistributionMethod;
  libraryPath: string;
  autoCheckUpdate: boolean;
  checkIntervalDays: number;
  /** 上次成功检查更新的 Unix 秒时间戳（0 = 从未检查；后端维护，前端只读） */
  lastUpdateCheckAt: number;
  developerModeEnabled: boolean; // for Windows symlink
  theme: 'light';
  confirmOnUninstall: boolean;
}

// ========== 后端契约类型（Tauri commands serde JSON，camelCase） ==========

/** 首屏一次性取全的应用状态（get_app_state） */
export interface AppState {
  skills: Skill[];
  tools: ToolAdapter[];
  projects: ProjectScope[];
  settings: AppSettings;
  repos: SkillRepo[];
  /** 新手指引是否已完成/跳过（false 时首次启动自动弹出引导） */
  onboardingCompleted: boolean;
  /** 用户主目录（用于把绝对路径折叠为 ~/... 展示） */
  homeDir: string;
}

/** 技能仓库源（discover_available_skills 的来源池） */
export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

export interface AddSkillRepoRequest {
  owner: string;
  name: string;
  branch?: string;
}

/** 发现页可安装技能项（discover_available_skills / search_skills_sh / install_skill_unified 入参） */
export interface DiscoverySkillItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  sourceType: 'featured' | 'skills_sh' | 'github';
  stars: number;
  downloads: string;
  repo?: string;
  branch?: string;
  subpath?: string;
  registryId?: string;
  tags: string[];
  latestCommit: string;
  verified: boolean;
  isInstalled: boolean;
}

export interface SkillsShSearchResult {
  skills: DiscoverySkillItem[];
  totalCount: number;
}

/** 统一安装请求（install_skill_unified 的公共部分） */
export interface InstallRequest {
  scope: ScopeType;
  projectId?: string;
  toolIds: ToolId[];
  deployMethod: SkillDeployMethod;
}

/** Skill 更新信息（check_skill_updates） */
export interface SkillUpdateInfo {
  id: string;
  name: string;
  currentCommit?: string;
  latestCommit: string;
}

/** 未受管技能（scan_unmanaged_skills，用于新手引导迁移） */
export interface UnmanagedSkill {
  directory: string;
  name: string;
  description?: string;
  foundIn: string[];
  path: string;
}

/** 导入已有技能时提交的启用选择（import_skills_from_apps；directory 为技能目录名，来自 UnmanagedSkill.directory） */
export interface ImportSkillSelection {
  directory: string;
  toolIds: ToolId[];
}

/** 分享链接解析出的技能条目（parse_share_link） */
export interface ShareSkillEntry {
  name: string;
  displayName?: string;
  description?: string;
  sourceType: 'github' | 'skills_sh';
  repo?: string;
  branch?: string;
  subpath?: string;
  registryId?: string;
  tags: string[];
}

export interface ShareLinkParseResult {
  v: number;
  skills: ShareSkillEntry[];
}

/** 项目路径实查结果（check_project_paths） */
export interface ProjectPathStatus {
  id: string;
  path: string;
  isPathValid: boolean;
}

/** 工具路径校验结果（validate_tool_path） */
export interface ToolPathValidation {
  valid: boolean;
  message?: string;
}

/** 中央库迁移结果（migrate_library；errors 为空 = 全部成功） */
export interface MigrateLibraryResult {
  migratedCount: number;
  skippedCount: number;
  /** 因目标已存在同名条目而跳过的目录名 */
  skipped: string[];
  errors: string[];
}

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export type AddToastFn = (type: ToastType, title: string, description?: string) => void;
