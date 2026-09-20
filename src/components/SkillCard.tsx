import React from 'react';
import { 
  GitBranch, 
  RefreshCw, 
  Tag as TagIcon, 
  Trash2, 
  ExternalLink,
  FolderGit2,
  Globe,
  Layers
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Skill, ToolAdapter, ToolId } from '../types';
import { ToolBrandIcon } from './icons/BrandIcons';

/** 来源渠道图标（替代原"查看详情"入口；详情改由点击技能名打开） */
function SourceChannelIcon({ skill }: { skill: Skill }) {
  const { source } = skill;
  const url =
    source.url ?? (source.repo ? `https://github.com/${source.repo}` : undefined);

  const label = (() => {
    switch (source.type) {
      case 'github':
        return `来源: GitHub ${source.repo ?? ''}`;
      case 'skills_sh':
        return `来源: skills.sh 社区${source.repo ? ` (${source.repo})` : ''}`;
      case 'url_zip':
        return '来源: URL 直链安装';
      default:
        return source.isGitHubDetectedFromLocal
          ? `来源: 本地导入（关联 GitHub ${source.repo ?? ''}）`
          : '来源: 本地技能';
    }
  })();

  return (
    <button
      onClick={() => {
        if (url) openUrl(url).catch(() => {});
      }}
      disabled={!url}
      className={`p-1.5 rounded-lg transition-colors text-slate-500 ${
        url ? 'hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer' : 'opacity-60 cursor-default'
      }`}
      title={url ? `${label}（点击打开）` : label}
    >
      <ExternalLink className="w-4 h-4" />
    </button>
  );
}

interface SkillCardProps {
  skill: Skill;
  tools: ToolAdapter[];
  isSelected: boolean;
  onToggleSelect: (skillId: string) => void;
  onToggleToolDeploy: (skillId: string, toolId: ToolId) => void;
  onOpenDetail: (skill: Skill) => void;
  onUpdateSingle: (skill: Skill) => void;
  onOpenTagEdit?: (skill: Skill) => void;
  onUninstallSingle: (skill: Skill) => void;
  isUpdating?: boolean;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  tools,
  isSelected,
  onToggleSelect,
  onToggleToolDeploy,
  onOpenDetail,
  onUpdateSingle,
  onOpenTagEdit,
  onUninstallSingle,
  isUpdating = false,
}) => {
  const enabledTools = tools.filter((t) => t.isEnabled);
  const deployedCount = enabledTools.filter((t) => !!skill.deployedTools[t.id]).length;

  return (
    <div
      className={`group relative bg-white rounded-2xl border transition-all duration-200 p-5 ${
        isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-500/15 shadow-sm bg-indigo-50/15'
          : 'border-slate-200/85 hover:border-slate-300 hover:shadow-md'
      }`}
    >
      {/* Top row: Checkbox, Name, Badges & Actions */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Selection Checkbox for Batch Mode */}
          <div className="pt-0.5">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(skill.id)}
              className="w-4 h-4 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer accent-indigo-600 transition-transform active:scale-95"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h3
                onClick={() => onOpenDetail(skill)}
                className="text-sm font-bold text-slate-900 hover:text-indigo-600 cursor-pointer transition-colors truncate"
                title={skill.displayName}
              >
                {skill.displayName}
              </h3>

              {/* Version & Git Commit Hash */}
              <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200/70">
                <GitBranch className="w-2.5 h-2.5 text-slate-400" />
                <span>{skill.currentCommit}</span>
              </span>

              {/* Scope Badge */}
              {skill.scope === 'global' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                  <Globe className="w-2.5 h-2.5" />
                  全局
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200/70">
                  <FolderGit2 className="w-2.5 h-2.5" />
                  {skill.projectName || skill.projectId}
                </span>
              )}

              {/* Source Badge */}
              {skill.source.type === 'github' && (
                <span className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200/60 font-mono">
                  GH: {skill.source.repo}
                </span>
              )}

              {skill.source.type === 'skills_sh' && (
                <span className="text-[10px] text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200/60 font-medium">
                  skills.sh
                </span>
              )}

              {skill.source.type === 'local' && (
                skill.source.isGitHubDetectedFromLocal ? (
                  <span className="text-[10px] text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-md border border-cyan-200/60 font-medium" title={`来源: ${skill.source.repo} (本地克隆识别)`}>
                    本地 (关联 GitHub)
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60 font-medium">
                    本地技能
                  </span>
                )
              )}

              {/* Update Available indicator */}
              {skill.hasUpdate && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse"></span>
                  <span>可更新至 {skill.latestCommit}</span>
                </span>
              )}
            </div>

            <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
              {skill.description}
            </p>
          </div>
        </div>

        {/* Action icons right corner */}
        <div className="flex items-center gap-1 shrink-0">
          {skill.hasUpdate && (
            <button
              onClick={() => onUpdateSingle(skill)}
              disabled={isUpdating}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white transition-colors shadow-xs"
              title="一键更新至远程最新提交"
            >
              <RefreshCw className={`w-3 h-3 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>更新</span>
            </button>
          )}

          <SourceChannelIcon skill={skill} />

          <button
            onClick={() => onOpenTagEdit?.(skill)}
            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="管理标签分类"
          >
            <TagIcon className="w-4 h-4" />
          </button>

          <button
            onClick={() => onUninstallSingle(skill)}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
            title="彻底卸载该技能"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tags section */}
      {skill.tags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3 pl-7">
          {skill.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] text-slate-500 bg-slate-100/90 hover:bg-slate-200/80 px-2 py-0.5 rounded-md font-medium transition-colors"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Target Tools Distribution Matrix & Sync Indicator */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 pl-7">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          <span>分发状态:</span>
          <span className="font-semibold text-slate-700">
            {deployedCount} / {enabledTools.length} 工具已启用
          </span>
        </div>

        {/* Model Tools Quick Toggle Badges with Official Logos and active indicators */}
        <div className="flex items-center gap-2 flex-wrap">
          {enabledTools.length === 0 ? (
            <span className="text-[11px] text-slate-400 italic">暂无启用的 AI 工具</span>
          ) : (
            enabledTools.map((tool) => {
              const isDeployed = !!skill.deployedTools[tool.id];
              return (
                <button
                  key={tool.id}
                  onClick={() => onToggleToolDeploy(skill.id, tool.id)}
                  className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-all border ${
                    isDeployed
                      ? 'bg-emerald-50/80 border-emerald-300/90 text-emerald-950 font-medium shadow-2xs hover:bg-emerald-100/80'
                      : 'bg-slate-50 border-slate-200/80 text-slate-400 hover:text-slate-700 hover:border-slate-300'
                  }`}
                  title={
                    isDeployed
                      ? `${tool.name}: 已在目标工具目录建立分发链接 (点击停用)`
                      : `${tool.name}: 未启用 (点击在工具中分发)`
                  }
                >
                  <ToolBrandIcon toolId={tool.id} size={15} />
                  <span className="text-[11px] font-medium">{tool.name}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      isDeployed ? 'bg-emerald-600' : 'bg-slate-300 group-hover:bg-slate-400'
                    }`}
                  />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
