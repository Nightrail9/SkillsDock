import React from 'react';
import { 
  FolderGit2, 
  Globe, 
  Tag as TagIcon, 
  Filter, 
  Plus, 
  RotateCcw,
  Layers
} from 'lucide-react';
import { ScopeType } from '../types';

interface InstalledFilterSidebarProps {
  selectedScope: 'all' | ScopeType | string; // 'all' | 'global' | projectId
  onSelectScope: (scope: 'all' | ScopeType | string) => void;
  projectList: { id: string; name: string; count: number }[];
  globalCount: number;
  totalCount: number;
  allTags: { name: string; count: number }[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  onOpenRegisterProject: () => void;
}

export const Sidebar: React.FC<InstalledFilterSidebarProps> = ({
  selectedScope,
  onSelectScope,
  projectList,
  globalCount,
  totalCount,
  allTags,
  selectedTags,
  onToggleTag,
  onClearTags,
  onOpenRegisterProject,
}) => {
  const hasActiveFilters = selectedScope !== 'all' || selectedTags.length > 0;

  return (
    <aside className="w-64 bg-slate-50/80 border-r border-slate-200/80 flex flex-col select-none h-full shrink-0">
      {/* Top Header of Sidebar（与右侧工具栏同高，保证底部横线对齐） */}
      <div className="h-[61px] px-4 border-b border-slate-200/70 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 tracking-tight">
          <div className="w-5 h-5 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Filter className="w-3 h-3" />
          </div>
          <span>多维筛选</span>
        </div>

        {hasActiveFilters && (
          <button
            onClick={() => {
              onSelectScope('all');
              onClearTags();
            }}
            className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium transition-colors hover:underline"
            title="一键重置所有作用域与标签筛选"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>重置</span>
          </button>
        )}
      </div>

      <div className="p-3.5 space-y-6 overflow-y-auto flex-1">
        {/* Section 1: Scope & Projects */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <span>生效范围</span>
            <button
              onClick={onOpenRegisterProject}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium normal-case flex items-center gap-0.5 hover:underline"
              title="新建并关联本地工程目录"
            >
              <Plus className="w-3 h-3" />
              <span>新建项目</span>
            </button>
          </div>

          <div className="space-y-1">
            {/* 全部技能 */}
            <button
              onClick={() => onSelectScope('all')}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium flex items-center justify-between transition-all ${
                selectedScope === 'all'
                  ? 'bg-white text-indigo-600 font-semibold shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Layers className={`w-3.5 h-3.5 ${selectedScope === 'all' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>全部技能</span>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-medium ${
                selectedScope === 'all' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200/60 text-slate-500'
              }`}>
                {totalCount}
              </span>
            </button>

            {/* 全局技能 */}
            <button
              onClick={() => onSelectScope('global')}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium flex items-center justify-between transition-all ${
                selectedScope === 'global'
                  ? 'bg-white text-indigo-600 font-semibold shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Globe className={`w-3.5 h-3.5 ${selectedScope === 'global' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>全局可用</span>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-medium ${
                selectedScope === 'global' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200/60 text-slate-500'
              }`}>
                {globalCount}
              </span>
            </button>

            {/* 项目列表 */}
            {projectList.length > 0 && (
              <div className="pt-2">
                <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  项目专属技能
                </div>
                {projectList.map((project) => {
                  const isSelected = selectedScope === project.id;
                  return (
                    <button
                      key={project.id}
                      onClick={() => onSelectScope(project.id)}
                      className={`w-full text-left px-3 py-1.5 rounded-xl text-sm font-medium flex items-center justify-between transition-all truncate ${
                        isSelected
                          ? 'bg-white text-indigo-600 font-semibold shadow-xs border border-slate-200'
                          : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
                      }`}
                      title={project.name}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FolderGit2 className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                        <span className="truncate">{project.name}</span>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-medium shrink-0 ${
                        isSelected ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200/60 text-slate-500'
                      }`}>
                        {project.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Tags Filter */}
        <div className="space-y-2 pt-3 border-t border-slate-200/70">
          <div className="flex items-center justify-between px-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <span className="flex items-center gap-1.5">
              <TagIcon className="w-3.5 h-3.5" />
              <span>技能标签</span>
            </span>
            {selectedTags.length > 0 && (
              <button
                onClick={onClearTags}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium normal-case hover:underline"
              >
                清除 ({selectedTags.length})
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 px-1 max-h-[260px] overflow-y-auto">
            {allTags.length === 0 ? (
              <span className="text-xs text-slate-400 italic px-1">暂无标签</span>
            ) : (
              allTags.map((t) => {
                const isSelected = selectedTags.includes(t.name);
                return (
                  <button
                    key={t.name}
                    onClick={() => onToggleTag(t.name)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm transition-all ${
                      isSelected
                        ? 'bg-indigo-600 text-white font-medium shadow-xs ring-1 ring-indigo-700'
                        : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900 shadow-2xs'
                    }`}
                  >
                    <span>#{t.name}</span>
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${
                        isSelected ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {t.count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
