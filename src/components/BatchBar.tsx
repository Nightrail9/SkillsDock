import React, { useState } from 'react';
import { 
  Trash2, 
  X, 
  Power, 
  Share2,
  WandSparkles,
} from 'lucide-react';
import { ToolAdapter, ToolId } from '../types';
import { ToolBrandIcon } from './icons/BrandIcons';
import { useTranslation } from '../hooks/useLocale';

interface BatchBarProps {
  selectedCount: number;
  totalCount?: number;
  tools: ToolAdapter[];
  isPending?: boolean;
  onClearSelection: () => void;
  onSelectAll?: () => void;
  onBatchDeployTool: (toolId: ToolId, enable: boolean) => void;
  onBatchTag?: (tag: string) => void;
  onBatchUninstall: () => void;
  onBatchShare?: () => void;
  onGenerateDescriptions?: () => void;
}

export const BatchBar: React.FC<BatchBarProps> = ({
  selectedCount,
  tools,
  isPending = false,
  onClearSelection,
  onBatchDeployTool,
  onBatchUninstall,
  onBatchShare,
  onGenerateDescriptions,
}) => {
  const { locale, t } = useTranslation();
  const [showDeployDropdown, setShowDeployDropdown] = useState(false);
  const enabledTools = tools.filter((tool) => tool.isEnabled);

  if (selectedCount === 0) return null;

  return (
    <div data-no-translate className="fixed bottom-7 left-1/2 -translate-x-1/2 z-40 bg-slate-900/92 backdrop-blur-xl text-white rounded-2xl shadow-2xl border border-slate-700/80 px-4 py-2.5 flex items-center gap-3.5 text-xs select-none animate-in slide-in-from-bottom-5 duration-200">
      <div className="flex items-center gap-2.5 pr-3.5 border-r border-slate-700/90">
        <span className="w-5 h-5 rounded-full bg-indigo-500 text-white font-bold flex items-center justify-center text-[11px] shadow-xs">
          {selectedCount}
        </span>
        <span className="font-semibold text-slate-200">{locale === 'en' ? `Selected ${selectedCount}` : `已选择 ${selectedCount} 项`}</span>
      </div>

      <div className="flex items-center gap-2 relative">
        <div className="relative">
          <button
            onClick={() => setShowDeployDropdown(!showDeployDropdown)}
            disabled={isPending}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all border disabled:opacity-60 ${
              showDeployDropdown
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-xs'
                : 'bg-slate-800 hover:bg-slate-700/90 text-slate-200 border-slate-700/80'
            }`}
          >
            <Power className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t('批量启用或停用', 'Enable or disable')}</span>
          </button>

          {showDeployDropdown && (
            <div className="absolute bottom-full mb-3 left-0 w-72 bg-white text-slate-800 rounded-2xl shadow-2xl border border-slate-200 p-2.5 space-y-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="text-[11px] font-bold text-slate-400 uppercase px-2.5 py-1">
                {t('选择批量启用或停用工具:', 'Choose a tool to enable or disable:')}
              </div>
              {enabledTools.length === 0 ? (
                <div className="text-center py-2 text-xs text-slate-400">{t('暂无启用的 AI 工具', 'No enabled AI tools')}</div>
              ) : (
                enabledTools.map((tool) => (
                  <div key={tool.id} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-xl transition-colors">
                    <div className="flex items-center gap-2.5">
                      <ToolBrandIcon toolId={tool.id} size={16} />
                      <span className="font-medium text-xs text-slate-800">{tool.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => onBatchDeployTool(tool.id, true)} disabled={isPending} className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 text-[11px] font-semibold transition-colors">{t('启用', 'Enable')}</button>
                      <button onClick={() => onBatchDeployTool(tool.id, false)} disabled={isPending} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 text-[11px] font-semibold transition-colors">{t('停用', 'Disable')}</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {onGenerateDescriptions && (
          <button onClick={onGenerateDescriptions} disabled={isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700/90 text-slate-200 transition-colors border border-slate-700/80 disabled:opacity-60">
            <WandSparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t('生成简介', 'Generate description')}</span>
          </button>
        )}

        {onBatchShare && (
          <button onClick={onBatchShare} disabled={isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors border border-slate-700/80 disabled:opacity-60">
            <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t('导出分享链接', 'Export share link')}</span>
          </button>
        )}

        <button onClick={onBatchUninstall} disabled={isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 active:bg-rose-950 text-rose-200 transition-colors border border-rose-800/60 font-semibold disabled:opacity-60">
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>{t('批量卸载', 'Uninstall selected')}</span>
        </button>
      </div>

      <button onClick={onClearSelection} className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors ml-1" title={t('取消选择', 'Clear selection')}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
