import { createRoot } from 'react-dom/client';
import {
  ArrowDownRight,
  ArrowRight,
  ExternalLink,
  Github,
  Layers3,
  LockKeyhole,
  Menu,
  PackageCheck,
  Search,
  Workflow,
} from 'lucide-react';
import './site.css';
import packageJson from '../package.json';

const RELEASE_URL = 'https://github.com/Nightrail9/SkillsDock/releases/latest';
const REPOSITORY_URL = 'https://github.com/Nightrail9/SkillsDock';
const APP_VERSION = packageJson.version;
const WINDOWS_DOWNLOAD_URL = `${RELEASE_URL}/download/SkillDock_${APP_VERSION}_x64-setup.exe`;

const supportedTools = ['Claude Code', 'Codex', 'Antigravity', 'OpenCode', 'OpenClaw', 'Hermes Agent', '自定义适配工具'];

const workflowSteps = [
  {
    title: '收集技能',
    description: '从 GitHub、skills.sh、本地文件夹或 ZIP 导入。',
    icon: Search,
  },
  {
    title: '选择范围',
    description: '设为全局可用，或只关联需要它的项目。',
    icon: Layers3,
  },
  {
    title: '继续工作',
    description: '将技能部署到你启用的 AI 工具目录。',
    icon: Workflow,
  },
];

function Site() {
  return (
    <>
      <a className="skip-link" href="#main-content">跳转到主要内容</a>
      <header className="site-header" id="top">
        <a className="brand" href="#top" aria-label="SkillDock 首页">
          <img src="./app-icon.png" alt="" />
          <span>SkillDock</span>
        </a>

        <nav className="desktop-nav" aria-label="主导航">
          <a href="#features">产品能力</a>
          <a href="#workflow">如何工作</a>
          <a href="#privacy">隐私与数据</a>
        </nav>

        <details className="mobile-nav">
          <summary aria-label="打开导航菜单"><Menu size={19} /></summary>
          <nav aria-label="移动端主导航">
            <a href="#features" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>产品能力</a>
            <a href="#workflow" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>如何工作</a>
            <a href="#privacy" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>隐私与数据</a>
          </nav>
        </details>

        <a className="button button-primary header-cta" href="#download">获取 SkillDock</a>
      </header>

      <main id="main-content" tabIndex={-1}>
      <section className="hero section-wrap" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">AI 技能的本地管理工具</p>
          <h1 id="hero-title">一个技能库，<br /><span>连接常用 AI 工具。</span></h1>
          <p className="hero-description">
            集中整理技能，再按工具与项目分发。少做重复配置，让每个工作区保持清楚。
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#download">
              获取 SkillDock <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className="text-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              <Github size={17} aria-hidden="true" />
              查看 GitHub
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
        </div>

        <figure className="hero-visual">
          <img
            className="product-shot"
            src="./skilldock-overview.png"
            alt="SkillDock 桌面界面，展示技能库筛选、项目范围和 AI 工具分发状态"
            fetchPriority="high"
          />
          <figcaption>在一个地方查看技能、项目与工具的关联</figcaption>
        </figure>
      </section>

      <section className="tool-section" aria-labelledby="tool-title">
        <div className="tool-section-inner section-wrap">
          <h2 id="tool-title">技能可以分发到</h2>
          <ul className="tool-list">
            {supportedTools.map((tool) => <li key={tool}>{tool}</li>)}
          </ul>
        </div>
      </section>

      <section className="feature-section section-wrap" id="features" aria-labelledby="feature-title">
        <div className="section-intro">
          <h2 id="feature-title">收进一个库，<br />再按需要分发。</h2>
          <p>来源、标签、工具和项目集中管理。要用哪些技能，由你决定。</p>
        </div>

        <div className="feature-story">
          <div className="feature-visual">
            <img
              src="./skill-routing.png"
              alt="技能从中央库分发到不同工作区和 AI 工具的抽象示意图"
              loading="lazy"
            />
          </div>
          <div className="feature-copy">
            <p className="eyebrow">集中整理，按需使用</p>
            <h3>同一份技能，<br />用在合适的位置。</h3>
            <p>从仓库、技能市场或本地文件导入。技能原文件保存在中央库，再按启用的工具与项目部署。</p>
            <ul className="feature-points">
              <li><PackageCheck size={18} aria-hidden="true" /><span><b>统一维护</b><small>更新、标签和来源都在一个地方管理</small></span></li>
              <li><Layers3 size={18} aria-hidden="true" /><span><b>区分范围</b><small>通用技能与项目专属技能分别管理</small></span></li>
              <li><Workflow size={18} aria-hidden="true" /><span><b>灵活分发</b><small>按工具选择复制或符号链接</small></span></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
        <div className="workflow-inner section-wrap">
          <div className="workflow-heading">
            <h2 id="workflow-title">从收集到使用，<br />步骤清楚。</h2>
            <p>技能库由你管理，分发范围也由你选择。</p>
          </div>
          <ol className="steps-list">
            {workflowSteps.map(({ title, description, icon: Icon }) => (
              <li className="step-row" key={title}>
                <Icon size={20} aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
                <ArrowDownRight className="step-arrow" size={18} aria-hidden="true" />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="privacy-section section-wrap" id="privacy" aria-labelledby="privacy-title">
        <div className="privacy-icon"><LockKeyhole size={22} aria-hidden="true" /></div>
        <div className="privacy-copy">
          <h2 id="privacy-title">数据保存在你的设备上。</h2>
          <p>SkillDock 不需要账号，也不依赖云端数据库。使用模型服务时，API Key 会发送给你配置的服务。</p>
        </div>
        <a className="text-link privacy-link" href={`${REPOSITORY_URL}/blob/main/README.md#数据与隐私`} target="_blank" rel="noreferrer">
          了解数据与隐私 <ArrowRight size={15} aria-hidden="true" />
        </a>
      </section>

      <section className="download-section" id="download" aria-labelledby="download-title">
        <div className="download-inner section-wrap">
          <div>
          <h2 id="download-title">开始整理你的技能库。</h2>
            <p className="download-description">选择适合你设备的版本，查看安装包与发行说明。</p>
          </div>
          <div className="download-actions">
            <a className="button button-primary" href={WINDOWS_DOWNLOAD_URL}>
              下载 Windows 版 <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a className="button button-secondary" href={RELEASE_URL} target="_blank" rel="noreferrer">
              选择 macOS 版本 <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      </main>

      <footer className="site-footer section-wrap">
        <a className="brand footer-brand" href="#top">
          <img src="./app-icon.png" alt="" />
          <span>SkillDock</span>
        </a>
        <p>技能集中管理，按需分发。</p>
        <nav className="footer-links" aria-label="更多链接">
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub</a>
          <a href={RELEASE_URL} target="_blank" rel="noreferrer">更新日志</a>
          <a href={`${REPOSITORY_URL}/blob/main/README.md#快速开始`} target="_blank" rel="noreferrer">快速开始</a>
        </nav>
        <span className="copyright">© 2026 SkillDock，Apache-2.0</span>
      </footer>
    </>
  );
}

const root = document.getElementById('site-root');
if (!root) throw new Error('官网挂载点 #site-root 不存在');

createRoot(root).render(<Site />);
