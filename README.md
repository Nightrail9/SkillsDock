# 技能坞 SkillDock

专为 AI 开发者打造的 Skills 集中管理与跨工具分发桌面客户端。

一个中央技能库，一处管理，按需分发到 Claude Code、Codex、Gemini CLI、OpenCode 等所有 AI 编程工具。

## 功能特性

- **中央技能库**：所有技能集中存储在本机单一目录，作为唯一事实源
- **一键分发/停用**：以软链接（失败自动回退复制）方式将技能投递到各 AI 工具的技能目录
- **发现与安装**：内置推荐 GitHub 仓库、自定义仓库源、skills.sh 公共注册表搜索、本地导入（自动识别 GitHub 来源）、URL/ZIP 安装
- **更新检测**：以 Git 提交号（短 SHA）为版本标识，自动后台检测，单个/批量更新
- **项目作用域**：技能可安装到具体项目，与全局技能隔离
- **标签与批量管理**：标签筛选、批量启停/打标签/更新/卸载
- **工具适配管理**：内置主流工具适配 + 自定义工具（名称 + 技能目录即可接入）
- **分享链接**：将技能或技能清单生成链接，他人可一键导入
- **本地优先**：无账号、无云端依赖，全部数据存储在本机（`~/.skilldock/`）

## 技术栈

- 前端：React 19 + Vite + Tailwind CSS 4 + TanStack Query
- 后端：Rust + Tauri v2（SQLite 持久化，rusqlite bundled）

## 运行与构建

**前置要求**：Node.js（见 `.nvmrc` 或 20+）、Rust 工具链（1.85+，[rustup](https://rustup.rs)）

```bash
# 安装依赖
npm install

# 开发调试（启动 Vite + Tauri 桌面窗口，支持热更新）
npm run tauri:dev

# 仅前端类型检查 / 构建
npm run lint
npm run build

# 后端测试
cd src-tauri && cargo test

# 编译发布版安装包
# 产物按平台输出到 src-tauri/target/release/bundle/（指定 --target 时在 src-tauri/target/<triple>/ ）
npm run tauri:build                 # 按宿主机平台构建 tauri.conf.json 中 targets 的对应子集

# Windows 本机（NSIS + MSI + 绿色便携 zip）
npm run tauri:build -- --bundles nsis,msi

# Linux（Debian/Ubuntu/Fedora 等，x86_64 + aarch64 的 deb/rpm/AppImage）
# 方式一：Docker（跨平台、环境隔离；Docker 配置文件见 src-tauri/docker/）
docker build -t skilldock-linux-builder src-tauri/docker
docker run --rm -v "$(pwd):/work" skilldock-linux-builder amd64
docker run --rm -v "$(pwd):/work" skilldock-linux-builder aarch64

# 方式二：WSL2 Ubuntu（网络访问 Docker Hub 受限时使用，需先安装依赖：
# libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
# libssl-dev patchelf xdg-utils rpm gcc-aarch64-linux-gnu，以及 Node 与 Rust 工具链）
CARGO_TARGET_DIR=~/target-linux src-tauri/docker/build.sh amd64
CARGO_TARGET_DIR=~/target-linux src-tauri/docker/build.sh aarch64   # aarch64 需先移除 amd64 版 dev 包
# 产物汇总到 dist-release/linux/{x86_64,aarch64}/

# macOS（dmg / app.tar.gz，Intel + Apple Silicon）
# 本仓库不含 macOS 打包机，由 GitHub Actions 在 push v* 标签时自动构建，见 .github/workflows/release-macos.yml
```

## 数据位置

- 中央技能库：`~/.skilldock/skills/`（可在设置中迁移）
- 数据库：`~/.skilldock/skilldock.db`

## 产品需求

本产品按「Skills Manager PRD v0.2」实现（中央技能库 + 分发的单一事实源模型，卸载即删无备份，首发 Windows + 中文界面）。
