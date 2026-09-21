import { useEffect } from 'react';
import type { AppLocale } from '../types';
import { useAppState } from './useAppState';

const ENGLISH_TEXT = new Map<string, string>([
  ['\u5DF2\u5B89\u88C5\u6280\u80FD', 'Installed skills'],
  ['\u53D1\u73B0\u4E0E\u5BFC\u5165', 'Discover & import'],
  ['\u8BBE\u7F6E', 'Settings'],
  ['\u5E38\u89C4', 'General'],
  ['AI \u5DE5\u5177', 'AI tools'],
  ['\u9879\u76EE\u5DE5\u7A0B', 'Projects'],
  ['\u6A21\u578B\u670D\u52A1', 'Model services'],
  ['\u5173\u4E8E\u8F6F\u4EF6', 'About'],
  ['\u591A\u7EF4\u7B5B\u9009', 'Filters'],
  ['\u91CD\u7F6E', 'Reset'],
  ['\u751F\u6548\u8303\u56F4', 'Scope'],
  ['\u65B0\u5EFA\u9879\u76EE', 'New project'],
  ['\u5168\u90E8\u6280\u80FD', 'All skills'],
  ['\u5168\u5C40\u53EF\u7528', 'Global'],
  ['\u9879\u76EE\u4E13\u5C5E\u6280\u80FD', 'Project skills'],
  ['\u6280\u80FD\u6807\u7B7E', 'Skill tags'],
  ['\u6E05\u9664', 'Clear'],
  ['\u6682\u65E0\u6807\u7B7E', 'No tags'],
  ['\u754C\u9762\u8BED\u8A00\u4E0E\u5916\u89C2', 'Language & appearance'],
  ['\u754C\u9762\u8BED\u8A00', 'Interface language'],
  ['\u7B80\u4F53\u4E2D\u6587\u754C\u9762\u8BED\u8A00', 'Simplified Chinese interface'],
  ['\u5916\u89C2\u4E3B\u9898', 'Appearance'],
  ['\u4EAE\u8272\u6A21\u5F0F', 'Light mode'],
  ['\u6697\u8272\u6A21\u5F0F', 'Dark mode'],
  ['\u8DDF\u968F\u7CFB\u7EDF', 'Follow system'],
  ['\u6280\u80FD\u5206\u53D1\u540C\u6B65\u65B9\u5F0F', 'Skill distribution'],
  ['\u7B26\u53F7\u94FE\u63A5 (Symlink)', 'Symbolic link'],
  ['\u6587\u4EF6\u590D\u5236 (Copy)', 'Copy files'],
  ['\u6280\u80FD\u4ED3\u5E93\u7269\u7406\u5B58\u50A8\u8DEF\u5F84', 'Skill library location'],
  ['\u9009\u62E9\u65B0\u8DEF\u5F84\u5E76\u8FC1\u79FB', 'Choose a new location'],
  ['\u6B63\u5728\u8FC1\u79FB...', 'Migrating...'],
  ['\u7248\u672C\u66F4\u65B0\u68C0\u6D4B\u4E0E\u5378\u8F7D', 'Updates & uninstall'],
  ['\u81EA\u52A8\u68C0\u6D4B\u6280\u80FD\u66F4\u65B0', 'Check for updates automatically'],
  ['\u68C0\u6D4B\u95F4\u9694\uFF08\u5929\uFF09', 'Check interval (days)'],
  ['\u5378\u8F7D\u524D\u9700\u8981\u4E8C\u6B21\u786E\u8BA4', 'Confirm before uninstalling'],
  ['\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E', 'Restore defaults'],
  ['\u6279\u91CF\u542F\u7528\u6216\u505C\u7528', 'Enable or disable'],
  ['\u9009\u62E9\u6279\u91CF\u542F\u7528\u6216\u505C\u7528\u5DE5\u5177:', 'Choose a tool:'],
  ['\u6682\u65E0\u542F\u7528\u7684 AI \u5DE5\u5177', 'No enabled AI tools'],
  ['\u542F\u7528', 'Enable'],
  ['\u505C\u7528', 'Disable'],
  ['\u751F\u6210\u7B80\u4ECB', 'Generate description'],
  ['\u5BFC\u51FA\u5206\u4EAB\u94FE\u63A5', 'Export share link'],
  ['\u6279\u91CF\u5378\u8F7D', 'Uninstall selected'],
  ['\u53D6\u6D88\u9009\u62E9', 'Clear selection'],
  ['\u5173\u95ED\u901A\u77E5', 'Dismiss notification'],
  ['\u641C\u7D22\u6280\u80FD\u540D\u79F0\u3001\u63CF\u8FF0\u3001\u6807\u7B7E\u6216\u4ED3\u5E93...', 'Search skills, descriptions, tags, or repositories...'],
  ['\u5168\u9009\u5F53\u524D', 'Select all'],
  ['\u5168\u5C40', 'Global'],
  ['\u5C1A\u672A\u751F\u6210\u4E2D\u6587\u7B80\u4ECB\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E\u6A21\u578B\u540E\u5904\u7406', 'No description generated. Configure a model in Settings.'],
  ['\u6B63\u5728\u52A0\u8F7D SkillsDock \u6570\u636E...', 'Loading SkillsDock data...'],
  ['\u6B63\u5728\u8BFB\u53D6\u6280\u80FD\u4ED3\u5E93\u3001\u5DE5\u5177\u9002\u914D\u5668\u4E0E\u8BBE\u7F6E', 'Reading the skill library, tool adapters, and settings'],
  ['\u66F4\u65B0\u4E2D...', 'Updating...'],
  ['\u68C0\u67E5\u66F4\u65B0', 'Check for updates'],
  ['\u5168\u9009', 'Select all'],
  ['\u53D6\u6D88\u5168\u9009', 'Clear selection'],
  ['\u6E05\u9664\u9009\u62E9', 'Clear selection'],
  ['\u672A\u627E\u5230\u7B26\u5408\u6761\u4EF6\u7684\u6280\u80FD', 'No matching skills found'],
  ['\u91CD\u7F6E\u6240\u6709\u7B5B\u9009', 'Reset all filters'],
  ['\u53D1\u73B0\u65B0\u6280\u80FD', 'Discover skills'],
  ['设置分类', 'Settings categories'],
  ['技能仓库作为单一事实源，目标工具目录内建立透明符号链接。更新一次处处生效，零额外存储开销。', 'The skill library is the single source of truth. Symbolic links in tool directories apply each update everywhere without extra storage.'],
  ['将文件完整拷贝至各工具配置目录。适用于 Windows 系统无法开启开发者模式或权限受限环境。', 'Copies complete files to each tool directory. Use this when Windows Developer Mode is unavailable or permissions are restricted.'],
  ['在 Windows 设置中开启 ', 'Enable '],
  ['开发者模式', 'Developer Mode'],
  [' 后，普通非管理员权限即可创建符号链接。', ' in Windows Settings to create symbolic links without administrator access.'],
  ['所有安装与导入的技能文件集中存放在此目录下。支持修改路径并将现有技能自动迁移至新目录。', 'All installed and imported skills are stored here. Changing this location automatically migrates existing skills.'],
  ['打开应用时，若距上次检测已超过设定间隔，则在后台静默比对远端 Git 提交。', 'When opening the app, remote Git commits are checked in the background after the selected interval.'],
  ['打开应用时，若距上次检测已超过该间隔才自动检查更新。建议不小于 1 天。', 'Updates are checked only after this interval has elapsed. At least one day is recommended.'],
  ['卸载即彻底删除且无备份，建议保持开启以防误操作。', 'Uninstalling permanently deletes files without a backup. Keep this enabled to prevent mistakes.'],
  ['技能仓库文件及链接映射已成功迁移至新目录（迁移 ', 'The skill library and link mappings were migrated to the new location (migrated '],
  [' 项', ' items'],
  ['，跳过 ', ', skipped '],
  ['）！', ')!'],
  ['LLM 技能描述处理配置', 'LLM skill description settings'],
  ['使用 OpenAI Chat Completions 兼容接口，将已安装技能的英文描述翻译、中文描述压缩为约 20 词左右的精简简介。', 'Uses an OpenAI Chat Completions-compatible API to translate English descriptions and condense Chinese descriptions into short summaries.'],
  ['提供商名称', 'Provider name'],
  ['本地模型', 'Local model'],
  ['模型名称', 'Model name'],
  ['隐藏 API Key', 'Hide API key'],
  ['显示 API Key', 'Show API key'],
  ['生成简介语言', 'Description language'],
  ['中文简介', 'Chinese description'],
  ['英文简介', 'English description'],
  ['请先点击“测试连接”并测试成功后再保存', 'Test the connection successfully before saving'],
  ['保存模型配置', 'Save model settings'],
  ['保存中...', 'Saving...'],
  ['测试中...', 'Testing...'],
  ['测试连接', 'Test connection'],
  ['专为 AI 开发者打造的 Skills 集中管理与跨工具分发桌面客户端。', 'A desktop app for AI developers to centrally manage skills and distribute them across tools.'],
  ['配置向导', 'Setup guide'],
  ['开源社区与仓库', 'Open-source community & repository'],
  ['GitHub 仓库', 'GitHub repository'],
  ['问题与需求', 'Issues & requests'],
  ['提交缺陷反馈与功能建议', 'Submit bug reports and feature requests'],
  ['Releases 日志', 'Release notes'],
  ['查看版本发布与变更记录', 'View releases and change history'],
  ['原作者 / 维护者', 'Author / maintainer'],
  ['开源许可证', 'Open-source license'],
  ['本地数据主权保障', 'Local data sovereignty'],
  ['SkillsDock 遵循 Local-First 原则，无云端服务器中转，无用户隐私数据上传，零遥测打点。所有配置文件、技能仓库、项目工程映射与工具符号链接仅保存在您的个人电脑中。', 'SkillsDock is local-first: no cloud relay, no private data uploads, and no telemetry. Configuration, skill libraries, project mappings, and symbolic links stay on your computer.'],
  ['搜索 skills.sh 公共注册表（至少 2 个字符）...', 'Search the skills.sh public registry (at least 2 characters)...'],
  ['从 GitHub 仓库克隆技能定义至技能仓库', 'Clone skill definitions from a GitHub repository into the skill library'],
  ['解析他人分享的技能链接 / Bundle 清单，批量纳管至技能仓库', 'Import shared skill links or bundles into the skill library'],
  ['开源社区推荐', 'Community picks'],
  ['Github 仓库', 'GitHub repository'],
  ['分享链接', 'Share link'],
  ['搜索 skills.sh 公共注册表', 'Search the skills.sh public registry'],
  ['在上方输入关键词（至少 2 个字符），即可检索社区技能并一键安装', 'Enter at least 2 characters above to find and install community skills.'],
  ['正在搜索 skills.sh 公共注册表...', 'Searching the skills.sh public registry...'],
  ['没有找到与', 'No skills found for '],
  ['维护方:', 'Maintainer:'],
  ['已安装', 'Installed'],
  ['安装技能', 'Install skill'],
  ['添加自定义 Git 技能源', 'Add a custom Git skill source'],
  ['填写任意公开或私有 Git 仓库，系统将克隆技能定义文件至技能仓库并支持自动更新检测。', 'Enter any public or private Git repository. Its skill definitions are cloned into the library and checked for updates.'],
  ['GitHub 仓库路径 (owner/repo 或 HTTPS URL)', 'GitHub repository path (owner/repo or HTTPS URL)'],
  ['例如: anthropics/skills-kit 或 https://github.com/my-org/agent-tools', 'For example: anthropics/skills-kit or https://github.com/my-org/agent-tools'],
  ['Git 分支 (Branch)', 'Git branch'],
  ['技能所在子目录 (Subpath)', 'Skill subdirectory'],
  ['安装', 'Install'],
  ['导入分享链接 / Bundle 清单', 'Import a share link / bundle'],
  ['输入他人分享的技能链接（例如以', 'Enter a shared skill link (for example, one starting with'],
  ['开头），系统将解析其中包含的技能清单。', ') and the app will parse the included skills.'],
  ['分享链接 URL', 'Share link URL'],
  ['正在解析分享链接...', 'Parsing share link...'],
  ['解析链接', 'Parse link'],
  ['解析出', 'Parsed '],
  ['个技能，逐个进入安装向导：', ' skills. Open the install wizard for each:'],
  ['全局', 'Global'],
  ['本地 (关联 GitHub)', 'Local (linked to GitHub)'],
  ['本地技能', 'Local skill'],
  ['有可用更新', 'Update available'],
  ['正在更新中...', 'Updating...'],
  ['更新中', 'Updating'],
  ['更新', 'Update'],
  ['正在生成简介...', 'Generating description...'],
  ['简介生成失败，点击重新生成', 'Description generation failed. Click to try again.'],
  ['使用 LLM 重新生成简介', 'Regenerate description with LLM'],
  ['使用 LLM 生成简介', 'Generate description with LLM'],
  ['管理标签分类', 'Manage tags'],
  ['彻底卸载该技能', 'Uninstall this skill permanently'],
  ['分发状态:', 'Distribution:'],
  ['暂无启用的 AI 工具', 'No enabled AI tools'],
  ['已选择', 'Selected'],
  ['批量启用或停用', 'Enable or disable'],
  ['选择批量启用或停用工具:', 'Choose a tool to enable or disable:'],
  ['启用', 'Enable'],
  ['停用', 'Disable'],
  ['生成简介', 'Generate description'],
  ['导出分享链接', 'Export share link'],
  ['批量卸载', 'Uninstall selected'],
  ['取消选择', 'Clear selection'],
  ['最小化', 'Minimize'],
  ['还原', 'Restore'],
  ['最大化', 'Maximize'],
  ['关闭', 'Close'],
  ['本地运行中', 'Running locally'],
  ['Anthropic 官方终端智能体，支持读取项目上下文与自动化工作流', 'Anthropic’s official terminal agent with project-context access and automated workflows.'],
  ['OpenAI 编程辅助 CLI 与开发工作区技能引擎', 'OpenAI coding assistant CLI and development-workspace skill engine.'],
  ['Google 官方新一代 AI 智能体终端开发平台与多智能体工作流引擎', 'Google’s next-generation AI agent terminal platform and multi-agent workflow engine.'],
  ['开源本地代码智能体套件，与多模型路由无缝对接', 'Open-source local coding agent suite with seamless multi-model routing.'],
  ['开源自主多平台 AI 智能体，支持 Telegram/Discord 本地自动化与工作流', 'Open-source autonomous multi-platform AI agent with local Telegram and Discord automation workflows.'],
  ['Nous Research 自主进化智能体，具备持久记忆与自主技能生成', 'Nous Research self-evolving agent with persistent memory and autonomous skill generation.'],
  ['安装技能并分发至工具', 'Install skill and distribute to tools'],
  ['正在安装并建立分发链接...', 'Installing and creating distribution links...'],
  ['1. 下载并解压至技能仓库 → 2. 写入本地索引 → 3. 分发到目标工具目录', '1. Download and extract to the skill library → 2. Update the local index → 3. Distribute to target tool directories'],
  ['安装失败：', 'Installation failed:'],
  ['安全提示：', 'Security notice:'],
  ['此技能来自外部第三方源（', 'This skill comes from an external third-party source ('],
  ['）。客户端纯本地运行，不拦截脚本，请确保您信任该仓库及其指令规范。', '). The app runs locally and does not intercept scripts. Ensure you trust this repository and its instructions.'],
  ['1. 选择生效作用域', '1. Choose a scope'],
  ['全局作用域 (Global)', 'Global scope'],
  ['对本机所有工程及终端窗口通用生效', 'Available to all projects and terminal sessions on this computer'],
  ['项目专属 (Project)', 'Project scope'],
  ['仅在选定的代码项目文件夹下生效', 'Available only in the selected project folder'],
  ['选择已注册的目标项目：', 'Choose a registered project:'],
  ['尚未注册任何项目，请先在「项目工程」页注册本地工程目录。', 'No projects are registered. Register a local project directory first.'],
  ['2. 选择启用的 AI 工具', '2. Choose enabled AI tools'],
  ['暂无启用的 AI 工具，可安装后在「AI 工具」页启用并分发', 'No AI tools are enabled. Enable and distribute to a tool after installation.'],
  ['分发方式:', 'Distribution method:'],
  ['符号链接 (Symlink · 零冗余即时同步)', 'Symbolic link (instant sync, no duplication)'],
  ['文件复制 (Copy)', 'Copy files'],
  ['切换为', 'Switch to '],
  ['文件复制', 'Copy files'],
  ['符号链接', 'Symbolic link'],
  ['正在安装...', 'Installing...'],
  ['确认安装并启用', 'Install and enable'],
  ['管理分类标签', 'Manage tags'],
  ['新建标签', 'New tag'],
  ['输入新标签名称，按回车添加...', 'Enter a tag name and press Enter...'],
  ['添加', 'Add'],
  ['快捷选取已有标签 (', 'Quickly select existing tags ('],
  ['已绑定标签 (', 'Assigned tags ('],
  ['暂未设置标签', 'No tags assigned'],
  ['移除标签', 'Remove tag'],
  ['完成', 'Done'],
  ['导出技能共享链接', 'Export skill share link'],
  ['复制链接即可与团队成员共享当前技能配置', 'Copy the link to share the current skill configuration with your team.'],
  ['分享链接地址', 'Share link address'],
  ['正在生成分享链接...', 'Generating share link...'],
  ['已复制', 'Copied'],
  ['复制链接', 'Copy link'],
  ['该落地页链接仅包含技能的公开 Git 仓库地址与版本号，不包含您本地的私有路径或密钥信息，安全合规。', 'This link contains only public Git repository addresses and versions. It does not include local private paths or key information.'],
  ['确认彻底删除', 'Delete permanently'],
  ['正在卸载...', 'Uninstalling...'],
  ['纯本地技能不可逆警告：', 'Irreversible local-skill warning:'],
  ['包含来自本地导入且未关联远程 Git 的私有技能。一旦删除，将无法通过网络重新安装，需自行备份源文件。', 'This includes privately imported skills without a linked remote Git source. Once deleted, they cannot be reinstalled over the network. Back up the original files yourself.'],
  ['远端来源技能卸载后，您随时可从 GitHub 仓库或公共注册表重新一键安装。', 'Skills from remote sources can be reinstalled any time from GitHub or the public registry.'],
  ['添加自定义工具', 'Add custom tool'],
  ['官方适配', 'Official adapter'],
  ['本地技能目录:', 'Local skill directory:'],
  ['目录当前不可访问', 'Directory is currently unavailable'],
  ['选择本地技能文件夹', 'Choose local skill folder'],
  ['该目录当前不可访问，请检查路径或重新选择。', 'This directory is unavailable. Check the path or choose another one.'],
  ['已纳管', 'Managed'],
  ['个技能', ' skills'],
  ['移除工具', 'Remove tool'],
  ['添加自定义 AI 工具', 'Add custom AI tool'],
  ['输入工具名称及其在本机的 Skills 扫描目录即可快速接入技能仓库分发网络。', 'Enter a tool name and its local skills scan directory to connect it to the skill distribution network.'],
  ['工具名称', 'Tool name'],
  ['技能目录路径', 'Skill directory path'],
  ['选择文件夹', 'Choose folder'],
  ['描述信息 (可选)', 'Description (optional)'],
  ['校验路径中...', 'Validating path...'],
  ['保存并启用', 'Save and enable'],
  ['确认移除', 'Remove'],
  ['首次配置向导 (', 'Initial setup guide ('],
  ['初次使用请完成配置', 'Complete the initial setup'],
  ['欢迎使用 SkillsDock', 'Welcome to SkillsDock'],
  ['告别技能在多个 AI 编程工具间的重复复制与版本脱节。本客户端以技能仓库为单一事实源，实现一处更新、全工具即时同步。', 'Avoid duplicate copies and version drift across AI coding tools. SkillsDock uses one skill library as the source of truth, synchronizing updates everywhere.'],
  ['核心心智模型', 'Core concept'],
  ['所有安装或导入的技能集中存放于您指定的本地技能仓库目录中，通过透明符号链接映射至各个终端 AI 编程工具，免去冗余复制。', 'All installed or imported skills live in your chosen local library and are linked transparently to AI coding tools, avoiding redundant copies.'],
  ['配置技能仓库物理路径', 'Configure skill library location'],
  ['设置技能包的统一本地存储目录及与目标 AI 工具的分发方式，后续可随时在设置中修改。', 'Set the local storage directory and distribution method for AI tools. You can change these later in Settings.'],
  ['技能仓库物理存储路径:', 'Skill library location:'],
  ['系统将自动创建该目录，所有从开源社区或 Git 导入的技能均纳管于此。', 'This directory is created automatically and manages every skill imported from the community or Git.'],
  ['跨工具分发方式:', 'Cross-tool distribution method:'],
  ['符号链接 (推荐)', 'Symbolic link (recommended)'],
  ['零磁盘冗余，技能仓库更新后各工具即刻生效。', 'No disk duplication. Skill library updates apply to every tool immediately.'],
  ['直接拷贝完整文件，适用于权限受限环境。', 'Copies complete files for restricted environments.'],
  ['已自动识别的 AI 目标工具', 'Detected AI target tools'],
  ['系统已探测到下列工具的技能目录，可一键建立跨工具联动分发：', 'The following tool skill directories were detected and can be linked for cross-tool distribution:'],
  ['未检测到任何 AI 工具，可稍后在「AI 工具」页添加自定义适配器', 'No AI tools were detected. You can add a custom adapter later in AI tools.'],
  ['已就绪', 'Ready'],
  ['未检测到目录', 'Directory not detected'],
  ['扫描与迁移存量孤立技能', 'Scan and migrate existing unmanaged skills'],
  ['自动探测各个工具现存未受管的技能包，统一迁移至新配置的技能仓库中。', 'Automatically find unmanaged skills in each tool and migrate them to the configured skill library.'],
  ['重新扫描', 'Scan again'],
  ['未发现未受管的存量技能，各工具目录已是干净状态。', 'No unmanaged skills were found. All tool directories are clean.'],
  ['发现', 'Found '],
  ['个未受管技能：', ' unmanaged skills:'],
  ['处', ' locations'],
  ['一键迁移并纳入技能仓库管理', 'Migrate all into the skill library'],
  ['上一步', 'Back'],
  ['步骤 1 / ', 'Step 1 / '],
  ['跳过向导', 'Skip guide'],
  ['下一步', 'Next'],
  ['技能导入中...', 'Importing skills...'],
  ['完成并开启管理', 'Finish and start managing'],
  ['刷新路径状态', 'Refresh path status'],
  ['注册中...', 'Registering...'],
  ['尚未注册任何项目', 'No projects registered'],
  ['注册本地工程目录后，即可将技能安装为该项目专属，仅在此项目中生效。', 'Register a local project directory to install skills that apply only to that project.'],
  ['注册于', 'Registered '],
  ['移除项目注册', 'Remove project registration'],
  ['项目根目录路径:', 'Project root directory:'],
  ['项目路径已失效（目录不存在或不可访问），项目级技能将暂停生效。', 'This project path is invalid or unavailable. Project-scoped skills are paused.'],
  ['专属技能纳管:', 'Managed project skills:'],
  ['查看此项目专属技能', 'View this project’s skills'],
]);

const CHINESE_TEXT = new Map<string, string>();
for (const [zh, en] of ENGLISH_TEXT) {
  if (!CHINESE_TEXT.has(en)) CHINESE_TEXT.set(en, zh);
}

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
let observerStarted = false;

function translatedValue(source: string, locale: AppLocale) {
  const trimmed = source.trim();
  if (locale !== 'en') {
    const translated = CHINESE_TEXT.get(trimmed);
    return translated ? source.replace(trimmed, translated) : source;
  }
  const translated = ENGLISH_TEXT.get(trimmed);
  if (translated) return source.replace(trimmed, translated);

  const updateMatch = trimmed.match(/^\u6709\s*(\d+)\s*\u9879\u5F85\u66F4\u65B0$/);
  if (updateMatch) return source.replace(trimmed, `${updateMatch[1]} updates available`);

  const updateAllMatch = trimmed.match(/^\u5168\u90E8\u66F4\u65B0\s*\((\d+)\)$/);
  if (updateAllMatch) return source.replace(trimmed, `Update all (${updateAllMatch[1]})`);

  const showingMatch = trimmed.match(/^\u663E\u793A\s*(\d+)\s*\/\s*(\d+)\s*\u9879$/);
  if (showingMatch) return source.replace(trimmed, `Showing ${showingMatch[1]} / ${showingMatch[2]}`);

  const distributionMatch = trimmed.match(/^\u5206\u53D1\u72B6\u6001\uFF1A\s*(\d+)\s*\/\s*(\d+)\s*\u5DE5\u5177\u5DF2\u542F\u7528$/);
  if (distributionMatch) {
    return source.replace(trimmed, `Distribution: ${distributionMatch[1]} / ${distributionMatch[2]} tools enabled`);
  }

  return source;
}

function translateDocument(locale: AppLocale) {
  if (!document.body) return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.parentElement?.closest('[data-no-translate]')) continue;
    const source = originalText.get(node) ?? node.nodeValue ?? '';
    if (!originalText.has(node)) originalText.set(node, source);
    const translated = translatedValue(source, locale);
    if (node.nodeValue !== translated) node.nodeValue = translated;
  }

  document.querySelectorAll<HTMLElement>('[title], [placeholder], [aria-label]').forEach((element) => {
    if (element.closest('[data-no-translate]')) return;
    const attributes = originalAttributes.get(element) ?? new Map<string, string>();
    originalAttributes.set(element, attributes);
    for (const name of ['title', 'placeholder', 'aria-label']) {
      const source = attributes.get(name) ?? element.getAttribute(name);
      if (source === null) continue;
      attributes.set(name, source);
      const translated = translatedValue(source, locale);
      if (element.getAttribute(name) !== translated) element.setAttribute(name, translated);
    }
  });
}

function ensureTranslationObserver() {
  if (observerStarted) return;
  observerStarted = true;
}

export function applyLocale(locale: AppLocale) {
  const root = document.documentElement;
  root.lang = locale === 'en' ? 'en' : 'zh-CN';
  root.setAttribute('data-locale', locale);
  ensureTranslationObserver();
  translateDocument(locale);
}

export function useLocale(locale: AppLocale) {
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);
}

export function useTranslation() {
  const locale = useAppState().data?.settings.locale ?? 'zh';
  return {
    locale,
    t: (zh: string, en: string) => (locale === 'en' ? en : zh),
  };
}
