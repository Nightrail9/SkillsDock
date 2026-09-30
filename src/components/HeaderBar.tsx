import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

const runWindowAction = (action: () => Promise<unknown>, context: string) => {
  try {
    action().catch((error) => console.warn(`${context} failed:`, error));
  } catch (error) {
    console.warn(`${context} failed:`, error);
  }
};

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
      const sync = () => win.isMaximized()
        .then((v) => !disposed && setIsMaximized(v))
        .catch((error) => console.warn('Failed to read window maximize state:', error));
      sync();
      win.onResized(sync).then((u) => {
        if (disposed) u();
        else unlisten = u;
      }).catch((error) => console.warn('Failed to subscribe to window resize:', error));
    } catch (error) {
      console.warn('Failed to initialize window controls:', error);
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 无边框窗口：空白区域按住拖动，双击切换最大化；交互控件不触发
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const handleBackdropMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.clientY >= 56) return;
      if (!(event.target instanceof Element) || !event.target.matches('[data-window-modal-backdrop]')) return;
      runWindowAction(() => getCurrentWindow().startDragging(), 'Modal window drag');
    };
    const handleBackdropDoubleClick = (event: MouseEvent) => {
      if (event.clientY >= 56) return;
      if (!(event.target instanceof Element) || !event.target.matches('[data-window-modal-backdrop]')) return;
      runWindowAction(() => getCurrentWindow().toggleMaximize(), 'Modal window maximize');
    };
    document.addEventListener('mousedown', handleBackdropMouseDown, true);
    document.addEventListener('dblclick', handleBackdropDoubleClick, true);
    return () => {
      document.removeEventListener('mousedown', handleBackdropMouseDown, true);
      document.removeEventListener('dblclick', handleBackdropDoubleClick, true);
    };
  }, []);

  const isInteractiveTarget = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest('button, a, input, select, [role="button"]');
  const handleDragMouseDown = (e: React.MouseEvent) => {
    if (!isTauriEnvironment() || e.button !== 0 || isInteractiveTarget(e)) return;
    runWindowAction(() => getCurrentWindow().startDragging(), 'Window drag');
  };
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (!isTauriEnvironment() || isInteractiveTarget(e)) return;
    runWindowAction(() => getCurrentWindow().toggleMaximize(), 'Window maximize');
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
    <>
    <header
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
      onDoubleClick={handleDoubleClick}
      className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 select-none shrink-0 sticky top-0 z-30"
    >
      <div className="h-14 pl-5 flex items-center justify-between gap-6">
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
        <nav className="flex items-center gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/70 shadow-inner">
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

        {/* Right: Window Controls placeholder keeps the navigation centered. */}
        <div aria-hidden="true" className="w-[132px] h-14 shrink-0" />
      </div>
    </header>
    {createPortal(
      <div className="fixed top-0 right-0 z-[60] h-14 w-[132px] pointer-events-none select-none">
        <div className="flex h-full items-stretch pointer-events-auto">
          <button
            onClick={() => {
              if (isTauriEnvironment()) {
                runWindowAction(() => getCurrentWindow().minimize(), 'Window minimize');
              }
            }}
            className="w-11 flex items-center justify-center text-slate-500/70 hover:bg-white/20 active:bg-white/35 hover:text-slate-700 transition-colors"
            title={isEnglish ? 'Minimize' : '\u6700\u5c0f\u5316'}
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (isTauriEnvironment()) {
                runWindowAction(() => getCurrentWindow().toggleMaximize(), 'Window maximize');
              }
            }}
            className="w-11 flex items-center justify-center text-slate-500/70 hover:bg-white/20 active:bg-white/35 hover:text-slate-700 transition-colors"
            title={isMaximized
              ? (isEnglish ? 'Restore' : '\u8fd8\u539f')
              : (isEnglish ? 'Maximize' : '\u6700\u5927\u5316')}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => {
              if (isTauriEnvironment()) {
                runWindowAction(() => getCurrentWindow().close(), 'Window close');
              }
            }}
            className="w-11 flex items-center justify-center text-slate-500/70 hover:bg-red-500/55 active:bg-red-600/70 hover:text-white transition-colors"
            title={isEnglish ? 'Close' : '\u5173\u95ed'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>,
      document.body,
    )}
    </>
  );
};
