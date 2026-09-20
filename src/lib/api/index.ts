import { invokeCommand } from './client';
import type {
  AddSkillRepoRequest,
  AppSettings,
  AppState,
  DiscoverySkillItem,
  ImportSkillSelection,
  InstallRequest,
  MigrateLibraryResult,
  ProjectPathStatus,
  ProjectScope,
  ScopeType,
  ShareLinkParseResult,
  Skill,
  SkillUpdateInfo,
  SkillsShSearchResult,
  ToolAdapter,
  ToolId,
  ToolPathValidation,
  UnmanagedSkill,
} from '../../types';

// ========== 应用状态 ==========

export const appStateApi = {
  /** 首屏一次性取全：skills + tools + projects + settings + repos */
  get(): Promise<AppState> {
    return invokeCommand('get_app_state');
  },

  /** 新手指引完成/跳过后置标记，之后启动不再自动弹出 */
  completeOnboarding(): Promise<void> {
    return invokeCommand('complete_onboarding');
  },
};

// ========== 技能管理 ==========

export const skillsApi = {
  /** 技能详情（填充真实 documentation 与 files 文件树） */
  getDetail(id: string): Promise<Skill> {
    return invokeCommand('get_skill_detail', { id });
  },

  /** 切换技能在某个工具上的分发启用状态（后端返回 void） */
  toggleTool(id: string, toolId: ToolId, enabled: boolean): Promise<void> {
    return invokeCommand('toggle_skill_tool', { id, toolId, enabled });
  },

  /** 批量设置技能标签（整体替换语义），返回更新条数 */
  setTags(ids: string[], tags: string[]): Promise<number> {
    return invokeCommand('set_skill_tags', { ids, tags });
  },

  /** 卸载技能（卸载即删，无备份） */
  uninstall(id: string): Promise<void> {
    return invokeCommand('uninstall_skill', { id });
  },

  /** 检查全部技能更新（同时刷新 latestCommit / hasUpdate） */
  checkUpdates(): Promise<SkillUpdateInfo[]> {
    return invokeCommand('check_skill_updates');
  },

  /** 更新单个技能至远端最新提交 */
  updateSkill(id: string): Promise<Skill> {
    return invokeCommand('update_skill', { id });
  },

  /** 统一安装（发现页条目：GitHub 仓库 / skills.sh） */
  installUnified(skill: DiscoverySkillItem, req: InstallRequest): Promise<Skill> {
    return invokeCommand('install_skill_unified', { skill, ...req });
  },

  /** 回填无来源技能的 skills.sh 注册表来源，返回成功回填的条数 */
  backfillSources(): Promise<number> {
    return invokeCommand('backfill_skill_sources');
  },

  /** 解析分享链接 */
  parseShareLink(url: string): Promise<ShareLinkParseResult> {
    return invokeCommand('parse_share_link', { url });
  },

  /** 生成分享链接 */
  createShareLink(ids: string[]): Promise<string> {
    return invokeCommand('create_share_link', { ids });
  },
};

// ========== 发现与搜索 ==========

export const discoveryApi = {
  /** 搜索 skills.sh 公共注册表 */
  searchSkillsSh(query: string, limit: number, offset: number): Promise<SkillsShSearchResult> {
    return invokeCommand('search_skills_sh', { query, limit, offset });
  },
};

// ========== AI 工具适配器 ==========

export interface AddToolAdapterRequest {
  name: string;
  vendor: string;
  description: string;
  skillsDir: string;
  color?: string;
}

export interface UpdateToolAdapterRequest {
  id: ToolId;
  name?: string;
  description?: string;
  skillsDir?: string;
  color?: string;
}

export const toolsApi = {
  /** 后端签名为单参数 input: {name, vendor?, description?, path, color?, isEnabled?} */
  addToolAdapter(req: AddToolAdapterRequest): Promise<ToolAdapter> {
    return invokeCommand('add_tool_adapter', {
      input: {
        name: req.name,
        vendor: req.vendor,
        description: req.description,
        path: req.skillsDir,
        color: req.color,
      },
    });
  },

  /** 后端签名为单参数 input（input.id 必填）；skillsDir 映射为 path */
  updateToolAdapter(req: UpdateToolAdapterRequest): Promise<ToolAdapter> {
    return invokeCommand('update_tool_adapter', {
      input: {
        id: req.id,
        name: req.name,
        description: req.description,
        path: req.skillsDir,
        color: req.color,
      },
    });
  },

  deleteToolAdapter(id: ToolId): Promise<void> {
    return invokeCommand('delete_tool_adapter', { id });
  },

  toggleToolEnabled(id: ToolId, enabled: boolean): Promise<void> {
    return invokeCommand('toggle_tool_enabled', { id, enabled });
  },

  /** 校验技能目录路径是否存在/可写 */
  validateToolPath(path: string): Promise<ToolPathValidation> {
    return invokeCommand('validate_tool_path', { path });
  },
};

// ========== 项目作用域 ==========

export const projectsApi = {
  addProject(path: string): Promise<ProjectScope> {
    return invokeCommand('add_skill_project', { path });
  },

  /** 移除项目注册；cleanup 为 true 时同时清理项目目录下已分发的技能文件 */
  removeProject(id: string, cleanup: boolean): Promise<void> {
    return invokeCommand('remove_skill_project', { id, cleanup });
  },

  /** 实查所有项目路径有效性（返回 {id, path, isPathValid}[]） */
  checkPaths(): Promise<ProjectPathStatus[]> {
    return invokeCommand('check_project_paths');
  },
};

// ========== 仓库源 ==========

export const reposApi = {
  /** 后端签名为单参数 repo: {owner, name, branch, enabled}（四字段必填），返回 void */
  addRepo(req: AddSkillRepoRequest): Promise<void> {
    return invokeCommand('add_skill_repo', {
      repo: { owner: req.owner, name: req.name, branch: req.branch ?? 'main', enabled: true },
    });
  },
};

// ========== 设置 ==========

export const settingsApi = {
  getSettings(): Promise<AppSettings> {
    return invokeCommand('get_settings');
  },

  updateSettings(settings: AppSettings): Promise<void> {
    return invokeCommand('update_settings', { settings });
  },

  /** 迁移中央技能库至新目录 */
  migrateLibrary(target: string): Promise<MigrateLibraryResult> {
    return invokeCommand('migrate_library', { target });
  },
};

// ========== 新手引导 / 存量迁移 ==========

export const onboardingApi = {
  /** 扫描各工具目录中未受管的技能 */
  scanUnmanaged(): Promise<UnmanagedSkill[]> {
    return invokeCommand('scan_unmanaged_skills');
  },

  /** 将选中的未受管技能导入技能仓库 */
  importFromApps(selections: ImportSkillSelection[]): Promise<Skill[]> {
    return invokeCommand('import_skills_from_apps', { selections });
  },
};

export type { ScopeType };
