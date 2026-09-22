import React, { useEffect, useState } from 'react';
import {
  Package,
  Compass,
  Settings as SettingsIcon,
  Minus,
  Square,
  Minimize2,
  X,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AppLocale, MainNavTab } from '../types';
import { SkillDockLogo } from './icons/BrandIcons';
import { isTauriEnvironment } from '../lib/api/mockData';

interface HeaderBarProps {
  totalSkillsCount: number;
  updateAvailableCount: number;
  locale?: AppLocale;
  currentTab: MainNavTab;
  onSelectTab: (tab: MainNavTab) => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  totalSkillsCount,
  updateAvailableCount,
  locale = 'zh',
  currentTab,
  onSelectTab,
}) => {
  const isEnglish = locale === 'en';
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      const win = getCurrentWindow();
      const sync = () => win.isMaximized().then((v) => !disposed && setIsMaximized(v)).catch(() => {});
      sync();
      win.onResized(sync).then((u) => {
        if (disposed) u();
        else unlisten = u;
      }).catch(() => {});
    } catch {
      // not in tauri window
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 无边框窗口：空白区域按住拖动，双击切换最大化；交互控件不触发
  const isInteractiveTarget = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest('button, a, input, select, [role="button"]');
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (!isTauriEnvironment() || e.button !== 0 || isInteractiveTarget(e)) return;
    try {
      getCurrentWindow().startDragging().catch(() => {});
    } catch {}
  };
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!isTauriEnvironment() || isInteractiveTarget(e)) return;
    try {
      getCurrentWindow().toggleMaximize().catch(() => {});
    } catch {}
  };

  const navItems: { id: MainNavTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    {
      id: 'installed',
      label: isEnglish ? 'Installed skills' : '已安装技能',
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
      label: isEnglish ? 'Discover & import' : '发现与导入',
      icon: <Compass className="w-4 h-4" />,
    },
    {
      id: 'settings',
      label: isEnglish ? 'Settings' : '设置',
      icon: <SettingsIcon className="w-4 h-4" />,
    },
  ];

  return (
    <header
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      onDoubleClick={handleDoubleClick}
      className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 select-none shrink-0 sticky top-0 z-30"
    >
      <div className="h-14 pl-5 flex items-center justify-between gap-4">
        {/* Left: Brand Identity */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="cursor-default select-none">
            <SkillDockLogo size={36} />
          </div>
          <div className="flex items-center">
            <span className="brand-wordmark font-extrabold text-[18px] tracking-[-0.015em] font-['Nunito',system-ui,sans-serif] antialiased select-none">
              SkillsDock
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
                className={`relative flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm transition-colors duration-150 focus:outline-none focus-visible:outline-none focus:ring-0 border ${
                  isActive
                    ? 'bg-white text-indigo-600 font-semibold shadow-xs border-slate-200/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50 font-medium border-transparent'
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
              onClick={() => {
                if (isTauriEnvironment()) {
                  try { getCurrentWindow().minimize().catch(() => {}); } catch {}
                }
              }}
              className="w-11 flex items-center justify-center text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 transition-colors"
              title="最小化"
            >
              <Minus className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (isTauriEnvironment()) {
                  try { getCurrentWindow().toggleMaximize().catch(() => {}); } catch {}
                }
              }}
              className="w-11 flex items-center justify-center text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 transition-colors"
              title={isMaximized ? '还原' : '最大化'}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => {
                if (isTauriEnvironment()) {
                  try { getCurrentWindow().close().catch(() => {}); } catch {}
                }
              }}
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
