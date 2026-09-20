/**
 * 后端结构化错误解析（移植自 cc-switch，改为纯中文文案，不依赖 i18n）。
 *
 * 后端错误为 JSON 字符串：{ code, context: Record<string,string>, suggestion? }
 * 也可能带 `SKILL_GLOBAL_CONFLICT:` / `SKILL_PROJECT_NOT_EMPTY:` 等前缀文本。
 */

/** 后端错误前缀：同名技能已全局安装 */
export const SKILL_GLOBAL_CONFLICT_PREFIX = 'SKILL_GLOBAL_CONFLICT:';
/** 后端错误前缀：项目下还有技能，无法移除 */
export const SKILL_PROJECT_NOT_EMPTY_PREFIX = 'SKILL_PROJECT_NOT_EMPTY:';

export function errorToString(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

/** 判断错误是否为「同名技能已全局安装」 */
export function isSkillGlobalConflictError(error: unknown): boolean {
  return errorToString(error).includes(SKILL_GLOBAL_CONFLICT_PREFIX);
}

/** 判断错误是否为「项目下还有技能，无法移除」 */
export function isSkillProjectNotEmptyError(error: unknown): boolean {
  return errorToString(error).includes(SKILL_PROJECT_NOT_EMPTY_PREFIX);
}

/** 结构化错误对象 */
export interface SkillError {
  code: string;
  context: Record<string, string>;
  suggestion?: string;
}

/**
 * 尝试解析后端返回的错误字符串。
 * 是 JSON 结构化错误时返回解析结果，否则返回 null。
 */
export function parseSkillError(errorString: string): SkillError | null {
  try {
    const parsed = JSON.parse(errorString);
    if (parsed && typeof parsed === 'object' && parsed.code && parsed.context) {
      return parsed as SkillError;
    }
  } catch {
    // 非 JSON 格式
  }
  return null;
}

function interpolate(template: string, context: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in context ? context[key] : match,
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  SKILL_NOT_FOUND: '未找到技能「{name}」，它可能已被卸载。',
  MISSING_REPO_INFO: '该技能缺少仓库来源信息，无法执行此操作。',
  DOWNLOAD_TIMEOUT: '下载超时（{url}），请稍后重试。',
  DOWNLOAD_FAILED: '下载失败（{url}）。',
  SKILL_DIR_NOT_FOUND: '未在压缩包或仓库中找到技能目录「{directory}」。',
  SKILL_DIRECTORY_CONFLICT: '技能目录「{directory}」已存在，请先卸载同名技能。',
  EMPTY_ARCHIVE: '下载的压缩包为空或内容无效。',
  INVALID_REPO_REF: '仓库引用「{repo}」无效，请检查 owner/repo 格式。',
  ARCHIVE_TOO_LARGE: '压缩包体积超出安全限制（{size}）。',
  ARCHIVE_TOO_MANY_ENTRIES: '压缩包内文件数量超出安全限制（{count}）。',
  GET_HOME_DIR_FAILED: '无法获取用户主目录路径。',
  NO_SKILLS_IN_ZIP: 'ZIP 压缩包中没有发现任何有效技能（缺少 SKILL.md）。',
  SKILL_GLOBAL_CONFLICT: '同名技能已全局安装，请先卸载后再试。',
  SKILL_PROJECT_NOT_EMPTY: '该项目下仍存在专属技能，请先卸载或迁移这些技能。',
  PATH_NOT_FOUND: '路径不存在：{path}。',
  PATH_NOT_WRITABLE: '路径不可写：{path}，请检查目录权限。',
  INVALID_SHARE_LINK: '分享链接无效或已损坏，无法解析。',
  SHARE_LOCAL_SKILL: '纯本地技能没有远端来源，无法生成分享链接。',
  PROJECT_PATH_INVALID: '项目路径无效或已失效：{path}。',
};

const SUGGESTION_MESSAGES: Record<string, string> = {
  checkNetwork: '建议：请检查网络连接后重试。',
  checkProxy: '建议：如使用代理，请确认代理配置可用。',
  retryLater: '建议：稍后重试，远端服务可能暂时不可用。',
  checkRepoUrl: '建议：请检查仓库地址与分支名是否正确。',
  checkPermission: '建议：请检查目录读写权限，或以开发者模式启用符号链接。',
  uninstallFirst: '建议：请先卸载已存在的同名技能。',
  checkZipContent: '建议：请确认 ZIP 包内包含带 SKILL.md 的技能目录。',
  http403: '远端返回 403：可能触发限流或仓库为私有，请稍后重试。',
  http404: '远端返回 404：仓库或路径不存在，请核对来源地址。',
  http429: '远端返回 429：请求过于频繁（限流），请稍后再试。',
};

/**
 * 将后端错误格式化为中文可读消息。
 * 非结构化错误原样返回；空错误返回 fallback。
 */
export function formatSkillErrorMessage(error: unknown, fallback = '操作失败，请重试'): string {
  const raw = errorToString(error);
  if (!raw) return fallback;

  const parsed = parseSkillError(raw);
  if (!parsed) return raw;

  const template = ERROR_MESSAGES[parsed.code];
  let message = template ? interpolate(template, parsed.context) : `${parsed.code}: ${raw}`;

  if (parsed.suggestion) {
    const suggestion = SUGGESTION_MESSAGES[parsed.suggestion] ?? parsed.suggestion;
    message += `\n${suggestion}`;
  }
  return message;
}
