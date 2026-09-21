import type { AppState, ToolAdapter, Skill } from '../../types';

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

const initialTools: ToolAdapter[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    description: 'Anthropic 官方终端智能体，支持读取项目上下文与自动化工作流',
    defaultPath: '~/.claude/skills',
    currentPath: '~/.claude/skills',
    isBuiltin: true,
    isEnabled: true,
    installedSkillsCount: 15,
    detected: true,
    color: '#D97757',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    vendor: 'OpenAI',
    description: 'OpenAI 编程辅助 CLI 与开发工作区技能引擎',
    defaultPath: '~/.codex/skills',
    currentPath: '~/.codex/skills',
    isBuiltin: true,
    isEnabled: true,
    installedSkillsCount: 15,
    detected: true,
    color: '#10A37F',
  },
  {
    id: 'antigravity-cli',
    name: 'Antigravity CLI',
    vendor: 'Google',
    description: 'Google 官方新一代 AI 智能体终端开发平台与多智能体工作流引擎',
    defaultPath: '~/.gemini/config/skills',
    currentPath: '~/.gemini/config/skills',
    isBuiltin: true,
    isEnabled: true,
    installedSkillsCount: 15,
    detected: true,
    color: '#4285F4',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'OpenCode',
    description: '开源本地代码智能体套件，与多模型路由无缝对接',
    defaultPath: '~/.opencode/skills',
    currentPath: '~/.opencode/skills',
    isBuiltin: true,
    isEnabled: false,
    installedSkillsCount: 0,
    detected: false,
    color: '#0284C7',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    vendor: 'OpenClaw',
    description: '开源自主多平台 AI 智能体，支持 Telegram/Discord 本地自动化与工作流',
    defaultPath: '~/.openclaw/skills',
    currentPath: '~/.openclaw/skills',
    isBuiltin: true,
    isEnabled: false,
    installedSkillsCount: 0,
    detected: false,
    color: '#E11D48',
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    vendor: 'Nous Research',
    description: 'Nous Research 自主进化智能体，具备持久记忆与自主技能生成',
    defaultPath: '~/.hermes/skills',
    currentPath: '~/.hermes/skills',
    isBuiltin: true,
    isEnabled: false,
    installedSkillsCount: 0,
    detected: false,
    color: '#7C3AED',
  },
];

const initialSkills: Skill[] = [
  {
    id: 'skill-academic-paper-reviewer',
    name: 'academic-paper-reviewer',
    displayName: 'Academic Paper Reviewer',
    directory: 'academic-paper-reviewer',
    description: '多视角学术论文审稿评测智能体组，支持期刊匹配度诊断与盲审模拟。',
    descriptionStatus: 'ready',
    tags: ['科研', '论文审阅', '审稿'],
    scope: 'global',
    source: { type: 'local' },
    currentCommit: 'a1b2c3d',
    hasUpdate: false,
    installedAt: '2026-09-01T10:00:00Z',
    lastUpdated: '2026-09-20T12:00:00Z',
    author: 'DeepMind Team',
    license: 'MIT',
    documentation: '# Academic Paper Reviewer\n\n多视角学术论文审稿工作流套件。',
    files: [{ name: 'SKILL.md', path: 'SKILL.md', size: '3.2 KB', type: 'file' }],
    deployedTools: { 'claude-code': true, codex: true, 'antigravity-cli': true },
    deployMethod: 'symlink',
    storagePath: '~/.skillsdock/academic-paper-reviewer',
  },
  {
    id: 'skill-deep-research',
    name: 'deep-research',
    displayName: 'Deep Research Team',
    directory: 'deep-research',
    description: '13 角色多阶段深度调研编排管线，覆盖前沿技术摸底与多源文献互证。',
    descriptionStatus: 'ready',
    tags: ['研究', '深度调研', '自动化'],
    scope: 'global',
    source: { type: 'github', repo: 'skills/deep-research' },
    currentCommit: 'f4e3d2c',
    hasUpdate: false,
    installedAt: '2026-09-10T14:30:00Z',
    lastUpdated: '2026-09-21T08:00:00Z',
    author: 'AI Research Lab',
    license: 'Apache-2.0',
    documentation: '# Deep Research Team\n\n深度研究与多源事实核查流水线。',
    files: [{ name: 'SKILL.md', path: 'SKILL.md', size: '4.8 KB', type: 'file' }],
    deployedTools: { 'claude-code': true, codex: true, 'antigravity-cli': true },
    deployMethod: 'symlink',
    storagePath: '~/.skillsdock/deep-research',
  },
];

let mockState: AppState = {
  skills: initialSkills,
  tools: initialTools,
  projects: [],
  settings: {
    distributionMethod: 'symlink',
    libraryPath: '~/.skillsdock',
    autoCheckUpdate: true,
    checkIntervalDays: 1,
    lastUpdateCheckAt: Math.floor(Date.now() / 1000),
    developerModeEnabled: true,
    theme: 'system',
    locale: 'zh',
    confirmOnUninstall: true,
  },
  llmConfig: {
    providerName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    language: 'zh',
  },
  repos: [
    {
      owner: 'anthropics',
      name: 'skills',
      branch: 'main',
      enabled: true,
    },
  ],
  onboardingCompleted: true,
  homeDir: '~',
};

export async function handleMockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  switch (command) {
    case 'get_app_state':
      return JSON.parse(JSON.stringify(mockState)) as T;

    case 'complete_onboarding':
      mockState.onboardingCompleted = true;
      return undefined as T;

    case 'toggle_tool_adapter': {
      const toolId = args?.toolId as string;
      const enabled = args?.enabled as boolean;
      const tool = mockState.tools.find((t) => t.id === toolId);
      if (tool) {
        tool.isEnabled = enabled;
      }
      return true as T;
    }

    case 'update_tool_path': {
      const toolId = args?.toolId as string;
      const newPath = args?.newPath as string;
      const tool = mockState.tools.find((t) => t.id === toolId);
      if (tool) {
        tool.currentPath = newPath;
      }
      return true as T;
    }

    case 'save_settings': {
      const newSettings = args?.settings as AppState['settings'];
      if (newSettings) {
        mockState.settings = { ...mockState.settings, ...newSettings };
      }
      return true as T;
    }

    case 'check_updates':
    case 'check_all_updates':
      return [] as T;

    case 'discover_available_skills':
    case 'search_skills_sh':
      return [] as T;

    case 'validate_tool_path':
      return { valid: true, exists: true, isDir: true } as T;

    case 'get_skill_detail': {
      const skillId = args?.skillId as string;
      const skill = mockState.skills.find((s) => s.id === skillId) || mockState.skills[0];
      return JSON.parse(JSON.stringify(skill)) as T;
    }

    default:
      return true as T;
  }
}
