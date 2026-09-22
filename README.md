<div align="center">
  <img src="./app-icon.png" width="104" alt="SkillDock 图标">
  <h1>SkillDock</h1>
  <p><strong>一个本地技能库，统一管理并按需分发到你的 AI 编程工具。</strong></p>
  <p><a href="./README.md">简体中文</a> · <a href="./README_EN.md">English</a></p>
  <p>
    <a href="https://github.com/Nightrail9/SkillsDock/releases/latest"><img src="https://img.shields.io/github/v/release/Nightrail9/SkillsDock?display_name=tag&sort=semver" alt="最新版本"></a>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-667eea" alt="支持平台">
    <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri" alt="Tauri 2">
    <img src="https://img.shields.io/badge/local--first-yes-10b981" alt="本地优先">
  </p>
  <p>
    <a href="#下载安装">下载安装</a> ·
    <a href="#核心能力">核心能力</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#参与开发">参与开发</a>
  </p>
</div>

![SkillDock 已安装技能界面](./docs/assets/skilldock-overview.png)

SkillDock 是面向 AI 开发者的跨平台 Skills 管理桌面客户端。它把分散在不同工具目录中的技能收拢到一个本地中央仓库，再通过文件复制或符号链接分发到 Claude Code、OpenAI Codex、Antigravity CLI、OpenCode、OpenClaw、Hermes Agent，以及你添加的自定义工具。

安装一次，统一更新；需要在哪个工具或项目中使用，再从 SkillDock 启用。

## 为什么使用 SkillDock

- **避免重复维护**：技能文件集中存放，不再手工复制到多个工具目录。
- **看清分发状态**：每张技能卡直接显示已启用的工具，支持单项与批量操作。
- **隔离全局与项目技能**：既能维护全局技能，也能为具体项目配置独立技能集。
- **保留本地控制权**：无需账号，数据库、技能文件与设置均保存在本机。
- **接入更多工具**：除内置适配器外，只需填写名称和技能目录即可添加自定义工具。

## 核心能力

### 统一技能库

所有安装或导入的技能默认进入 `~/.skilldock/skills/`。技能名称、来源、标签、版本和工具分发状态由 SkillDock 统一维护。

### 多来源发现与安装

- 搜索 [skills.sh](https://skills.sh/) 公共注册表
- 输入 GitHub 仓库，自动探测其中包含 `SKILL.md` 的技能
- 从本地文件夹、URL 或 ZIP 压缩包导入
- 解析 SkillDock 分享链接或 Bundle 清单并批量安装

#### skills.sh 社区搜索

![SkillDock skills.sh 社区技能搜索](./docs/assets/skilldock-discovery-market.png)

#### GitHub 仓库导入

![SkillDock GitHub 仓库技能导入](./docs/assets/skilldock-discovery-github.png)

### 跨工具分发

支持文件复制和符号链接两种方式。macOS 与 Linux 可直接使用符号链接；Windows 可使用文件复制，或在管理员权限、开发者模式可用时选择符号链接。

内置适配器：

| 工具 | 默认技能目录 |
| --- | --- |
| Claude Code | `~/.claude/skills` |
| OpenAI Codex | `~/.codex/skills` |
| Antigravity CLI | `~/.gemini/config/skills` |
| OpenCode | `~/.opencode/skills` |
| OpenClaw | `~/.openclaw/skills` |
| Hermes Agent | `~/.hermes/skills` |

默认路径可在设置中修改，也可以添加任意自定义工具和技能目录。

### 更新、标签与批量管理

- 以 Git 提交号跟踪技能版本并检查上游更新
- 按名称、描述、标签、仓库和作用域筛选
- 批量启用、停用、更新、打标签和卸载
- 为单个技能或技能集合生成分享链接

### 项目作用域

注册本地项目后，可将技能安装到项目范围，并分发到各工具对应的项目技能目录。项目技能与全局技能分开存储和管理。

### 中英文界面与简介处理

界面支持简体中文和英文，并可配置 OpenAI Chat Completions 兼容接口，为已安装技能生成精简中文简介。模型服务配置为可选项，不影响本地技能管理功能。

## 下载安装

从 [GitHub Releases](https://github.com/Nightrail9/SkillsDock/releases/latest) 下载适合当前系统的安装包。

| 系统 | 推荐文件 | 说明 |
| --- | --- | --- |
| Windows 10 / 11 x64 | `SkillDock_*_x64-setup.exe` | 普通用户推荐，缺少 WebView2 时安装程序会自动处理 |
| Windows 企业部署 | `SkillDock_*_x64_en-US.msi` | 适合组策略、Intune 或静默批量安装 |
| Windows 便携使用 | `SkillDock-*-x64-green.zip` | 解压即用，无需安装 |
| macOS 12+ | `SkillDock_*_x64.dmg` 或 `SkillDock_*_aarch64.dmg` | Intel 选择 x64，Apple Silicon 选择 aarch64 |
| Debian / Ubuntu | `SkillDock_*_amd64.deb` 或 `SkillDock_*_arm64.deb` | 按 CPU 架构选择 |
| Fedora / RHEL / openSUSE | `SkillDock-*.x86_64.rpm` 或 `SkillDock-*.aarch64.rpm` | 按 CPU 架构选择 |
| 其他较新的 Linux 发行版 | `SkillDock_*_amd64.AppImage` 或 `SkillDock_*_aarch64.AppImage` | 单文件运行 |

> [!NOTE]
> 当前 macOS 构建未签名。首次启动时，请右键应用并选择“打开”，再确认运行。

> [!NOTE]
> Linux 构建依赖 WebKit2GTK 4.1、GTK3 和 glibc 2.39 或更高版本，建议使用 Ubuntu 24.04+、Debian 13+、Fedora 40+ 或同代发行版。

## 快速开始

1. 打开“发现与导入”，从 skills.sh、GitHub、本地目录、URL 或 ZIP 安装技能。
2. 回到“已安装技能”，点击技能卡底部的工具按钮，将技能分发到目标工具。
3. 使用左侧标签与作用域筛选技能，或多选后执行批量操作。
4. 如需项目级隔离，在“设置 → 项目工程”中注册项目，再将技能安装到该项目。
5. 在“设置 → 常规”中选择文件复制或符号链接，并按需修改中央技能库位置。

## 数据与隐私

SkillDock 无需账号，也不依赖云端数据库。

| 数据 | 默认位置 |
| --- | --- |
| 中央技能库 | `~/.skilldock/skills/` |
| 本地数据库 | `~/.skilldock/skilldock.db` |
| 应用数据目录 | `~/.skilldock/` |

分享链接只包含可公开定位技能所需的仓库地址与版本信息，不包含本地路径或 API Key。可选的模型服务 API Key 仅保存在本机。

> [!WARNING]
> 卸载技能会删除中央库中的对应技能文件，当前没有自动备份。建议保留卸载二次确认，并自行备份重要的本地技能。

## 参与开发

### 环境要求

- Node.js 20.19+ 或 22.12+
- Rust 1.85 或更高版本，可通过 [rustup](https://rustup.rs/) 安装
- 当前系统对应的 [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)

### 本地运行

```bash
npm install
npm run tauri:dev
```

仅启动浏览器预览：

```bash
npm run dev
```

### 检查与测试

```bash
# TypeScript 类型检查
npm run lint

# 前端生产构建
npm run build

# Rust 后端测试
cd src-tauri
cargo test
```

### 构建安装包

```bash
# 构建当前平台在 tauri.conf.json 中配置的安装包
npm run tauri:build

# Windows NSIS 与 MSI
npm run tauri:build -- --bundles nsis,msi
```

Linux 双架构构建脚本位于 `src-tauri/docker/`，macOS 双架构发布流程位于 `.github/workflows/release-macos.yml`。

## 技术栈

- React 19、TypeScript、Vite 8、Tailwind CSS 4
- TanStack Query
- Tauri 2、Rust
- SQLite，使用 `rusqlite` bundled 持久化

## 致谢

- [CC Switch](https://github.com/farion1231/cc-switch)，提供了跨工具 Skills 管理实现上的重要参考。
- [Skills Manager](https://github.com/xingkongliang/skills-manager)，为统一技能库与多工具分发的产品设计提供了参考。

## 许可证

项目元数据声明采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)。
