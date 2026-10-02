import React from 'react';
import {
  Bot,
  FolderGit2,
  Globe,
  Tag as TagIcon,
  LibraryBig,
  Plus,
  RotateCcw,
  Send,
} from 'lucide-react';
import { AppLocale, ScopeType, ToolAdapter, ToolId } from '../types';


interface InstalledFilterSidebarProps {
  selectedScope: 'all' | ScopeType | string; // 'all' | 'global' | projectId
  onSelectScope: (scope: 'all' | ScopeType | string) => void;
  projectList: { id: string; name: string; count: number }[];
  globalCount: number;
  allTags: { name: string; count: number }[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  tools: ToolAdapter[];
  toolCounts: Record<ToolId, number>;
  selectedTools: ToolId[];
  onToggleTool: (toolId: ToolId) => void;
  pendingSkillCount: number;
  onOpenSkillScheduler: () => void;
  hasSearchQuery: boolean;
  onResetFilters: () => void;
  onOpenRegisterProject: () => void;
  locale?: AppLocale;
}

export const Sidebar: React.FC<InstalledFilterSidebarProps> = ({
  selectedScope,
  onSelectScope,
  projectList,
  globalCount,
  allTags,
  selectedTags,
  onToggleTag,
  onClearTags,
  tools,
  toolCounts,
  selectedTools,
  onToggleTool,
  pendingSkillCount,
  onOpenSkillScheduler,
  hasSearchQuery,
  onResetFilters,
  onOpenRegisterProject,
  locale = 'zh',
}) => {
  const isEnglish = locale === 'en';
  const hasActiveFilters =
    selectedScope !== 'all' ||
    selectedTags.length > 0 ||
    selectedTools.length > 0 ||
    hasSearchQuery;

  return (
    <aside className="w-64 bg-slate-50/80 border-r border-slate-200/80 flex flex-col select-none h-full shrink-0">
      {/* Top Header of Sidebar（与右侧工具栏同高，保证底部横线对齐） */}
      <div className="h-[61px] px-4 border-b border-slate-200/70 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800 tracking-tight">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <LibraryBig className="w-4 h-4" />
          </div>
          <span>{isEnglish ? 'Skill Library' : '技能库'}</span>
        </div>

        {hasActiveFilters && (
          <button
            onClick={onResetFilters}
            className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-medium transition-colors hover:underline"
            title={isEnglish ? 'Reset all filters' : '重置所有筛选条件'}
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>{isEnglish ? 'Reset' : '重置'}</span>
          </button>
        )}
      </div>

      <div className="p-3.5 space-y-6 overflow-y-auto flex-1">
        {/* Section 1: Scope & Projects */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <span>{isEnglish ? 'Scope' : '作用范围'}</span>
            <button
              onClick={onOpenRegisterProject}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium normal-case flex items-center gap-0.5 hover:underline"
              title="新建并关联本地工程目录"
            >
              <Plus className="w-3 h-3" />
              <span>{isEnglish ? 'New project' : '新建项目'}</span>
            </button>
          </div>

          <div className="space-y-1">
            {/* 全局技能 */}
            <button
              onClick={() => onSelectScope('global')}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium flex items-center justify-between transition-colors border focus:outline-none focus-visible:outline-none focus:ring-0 ${
                selectedScope === 'global'
                  ? 'bg-white text-indigo-600 font-semibold shadow-xs border-slate-200'
                  : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Globe className={`w-3.5 h-3.5 ${selectedScope === 'global' ? 'text-indigo-600' : 'text-slate-400'}`} />
                <span>{isEnglish ? 'Global' : '全局可用'}</span>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-medium ${
                selectedScope === 'global' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200/60 text-slate-500'
              }`}>
                {globalCount}
              </span>
            </button>

            {/* 项目列表 */}
            {projectList.map((project) => {
              const isSelected = selectedScope === project.id;
              return (
                <button
                  key={project.id}
                  onClick={() => onSelectScope(project.id)}
                  className={`w-full text-left px-3 py-1.5 rounded-xl text-sm font-medium flex items-center justify-between transition-colors truncate border focus:outline-none focus-visible:outline-none focus:ring-0 ${
                    isSelected
                      ? 'bg-white text-indigo-600 font-semibold shadow-xs border-slate-200'
                      : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 border-transparent'
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
        </div>

        {/* Section 2: Tags Filter */}
        <div className="space-y-2 pt-3 border-t border-slate-200/70">
          <div className="flex items-center justify-between px-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <span className="flex items-center gap-1.5">
              <TagIcon className="w-3.5 h-3.5" />
              <span>{isEnglish ? 'Skill tags' : '技能标签'}</span>
            </span>
            {selectedTags.length > 0 && (
              <button
                onClick={onClearTags}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium normal-case hover:underline focus:outline-none focus-visible:outline-none focus:ring-0"
              >
                {isEnglish ? 'Clear' : '清除'} ({selectedTags.length})
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 px-1 max-h-[260px] overflow-y-auto">
            {allTags.length === 0 ? (
              <span className="text-xs text-slate-400 italic px-1">{isEnglish ? 'No tags' : '暂无标签'}</span>
            ) : (
              allTags.map((t) => {
                const isSelected = selectedTags.includes(t.name);
                return (
                  <button
                    key={t.name}
                    onClick={() => onToggleTag(t.name)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm transition-colors border focus:outline-none focus-visible:outline-none focus:ring-0 ${
                      isSelected
                        ? 'bg-indigo-600 text-white font-medium shadow-xs border-indigo-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900 shadow-2xs'
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

        {/* Section 3: AI tool deployment */}
        <div className="space-y-2 pt-3 border-t border-slate-200/70">
          <div className="flex items-center gap-1.5 px-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
            <Bot className="w-3.5 h-3.5" />
            <span>{isEnglish ? 'AI tools' : 'AI 工具'}</span>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {tools.map((tool) => {
              const isSelected = selectedTools.includes(tool.id);
              return (
                <button
                  key={tool.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onToggleTool(tool.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors border ${
                    isSelected
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      : 'border-transparent text-slate-600 hover:bg-slate-200/50'
                  }`}
                  title={tool.isEnabled
                    ? (isEnglish ? 'Tool is enabled' : '工具已启用')
                    : (isEnglish ? 'Tool is disabled' : '工具未启用')}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${tool.isEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <span className="truncate">{tool.name}</span>
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">{toolCounts[tool.id] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 4: Skills waiting for distribution */}
        <div className="space-y-1.5 pt-3 border-t border-slate-200/70">
          <button
            type="button"
            onClick={onOpenSkillScheduler}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-600 hover:bg-slate-200/60 hover:text-indigo-700 transition-colors"
            title={isEnglish ? 'Schedule skills not distributed to any AI tool' : '调度尚未分发到任何 AI 工具的技能'}
          >
            <span className="flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              <span>{isEnglish ? 'Undistributed skills' : '待调度技能'}</span>
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-500 font-mono">
              {pendingSkillCount}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
};
