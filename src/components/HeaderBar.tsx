import React, { useEffect, useState } from 'react';
import {
  Package,
  Compass,
  Bot,
  FolderGit2,
  Settings as SettingsIcon,
  Minus,
  Square,
  Minimize2,
  X,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ToolAdapter, MainNavTab } from '../types';
import { SkillDockLogo } from './icons/BrandIcons';

interface HeaderBarProps {
  tools: ToolAdapter[];
  totalSkillsCount: number;
  updateAvailableCount: number;
  projectsCount: number;
  currentTab: MainNavTab;
  onSelectTab: (tab: MainNavTab) => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  tools,
  totalSkillsCount,
  updateAvailableCount,
  projectsCount,
  currentTab,
  onSelectTab,
}) => {
  const activeToolsCount = tools.filter((t) => t.isEnabled && t.detected).length;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const win = getCurrentWindow();
    const sync = () => win.isMaximized().then((v) => !disposed && setIsMaximized(v)).catch(() => {});
    sync();
    win.onResized(sync).then((u) => {
      if (disposed) u();
      else unlisten = u;
    }).catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 无边框窗口：空白区域按住拖动，双击切换最大化；交互控件不触发
  const isInteractiveTarget = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest('button, a, input, select, [role="button"]');
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || isInteractiveTarget(e)) return;
    getCurrentWindow().startDragging().catch(() => {});
  };
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isInteractiveTarget(e)) return;
    getCurrentWindow().toggleMaximize().catch(() => {});
  };

  const navItems: { id: MainNavTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'installed',
      label: '已安装技能',
      icon: <Package className="w-4 h-4" />,
      badge: (
        <span className="flex items-center gap-1">
          {updateAvailableCount > 0 && (
            <span
              className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"
              title={`${updateAvailableCount} 个可用更新`}
            />
          )}
          <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold transition-colors ${
            currentTab === 'installed'
              ? 'bg-indigo-100 text-indigo-700'
              : 'bg-slate-200/80 text-slate-600'
          }`}>
            {totalSkillsCount}
          </span>
        </span>
      ),
    },
    {
      id: 'discovery',
      label: '发现与导入',
      icon: <Compass className="w-4 h-4" />,
    },
    {
      id: 'tools',
      label: 'AI 工具',
      icon: <Bot className="w-4 h-4" />,
      badge: (
        <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium transition-colors ${
          currentTab === 'tools'
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-slate-200/80 text-slate-600'
        }`}>
          {activeToolsCount}/{tools.length}
        </span>
      ),
    },
    {
      id: 'projects',
      label: '项目工程',
      icon: <FolderGit2 className="w-4 h-4" />,
      badge: projectsCount > 0 ? (
        <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium transition-colors ${
          currentTab === 'projects'
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-slate-200/80 text-slate-600'
        }`}>
          {projectsCount}
        </span>
      ) : undefined,
    },
    {
      id: 'settings',
      label: '设置',
      icon: <SettingsIcon className="w-4 h-4" />,
    },
  ];

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      onDoubleClick={handleDoubleClick}
      className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 select-none shrink-0 sticky top-0 z-30 transition-all"
    >
      <div className="h-14 pl-5 flex items-center justify-between gap-4">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative group cursor-default">
            <SkillDockLogo size={36} />
            <div
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white shadow-2xs"
              title="本地运行中"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-slate-900 text-base tracking-tight font-sans">
              技能坞
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200/70 font-mono">
              v1.2
            </span>
          </div>
        </div>

        {/* Center: Polished Segmented Control Navigation */}
        <nav className="flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/70 shadow-inner">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-white text-indigo-600 font-semibold shadow-xs border border-slate-200/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50 font-medium'
                }`}
              >
                <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
                {item.badge}
              </button>
            );
          })}
        </nav>

        {/* Right: Window Controls */}
        <div className="flex items-center justify-end self-stretch shrink-0">
          <div className="flex items-stretch self-stretch">
            <button
              onClick={() => getCurrentWindow().minimize().catch(() => {})}
              className="w-11 flex items-center justify-center text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 transition-colors"
              title="最小化"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}
              className="w-11 flex items-center justify-center text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 transition-colors"
              title={isMaximized ? '还原' : '最大化'}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => getCurrentWindow().close().catch(() => {})}
              className="w-11 flex items-center justify-center text-slate-500 hover:bg-red-500 hover:text-white transition-colors"
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
