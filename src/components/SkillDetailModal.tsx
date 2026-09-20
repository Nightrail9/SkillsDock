import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  X, 
  GitBranch, 
  ExternalLink, 
  RefreshCw, 
  Share2, 
  Trash2, 
  FileText, 
  FolderTree, 
  Calendar, 
  User, 
  Shield, 
  FolderGit2,
  Globe,
  Tag as TagIcon,
  Layers,
  Check
} from 'lucide-react';
import { Skill, ToolAdapter, ToolId, SkillFile } from '../types';
import { ToolBrandIcon } from './icons/BrandIcons';
import { useSkillDetail } from '../hooks/useSkills';

/** 递归扁平化文件树为列表（带缩进层级） */
function flattenFiles(files: SkillFile[], depth = 0): { file: SkillFile; depth: number }[] {
  const out: { file: SkillFile; depth: number }[] = [];
  for (const file of files) {
    out.push({ file, depth });
    if (file.type === 'dir' && file.children) {
      out.push(...flattenFiles(file.children, depth + 1));
    }
  }
  return out;
}

interface SkillDetailModalProps {
  skill: Skill | null;
  tools: ToolAdapter[];
  onClose: () => void;
  onToggleToolDeploy: (skillId: string, toolId: ToolId) => void;
  onUpdate: (skill: Skill) => void;
  onShare: (skill: Skill) => void;
  onUninstall: (skill: Skill) => void;
  onAddTag: (skillId: string, newTag: string) => void;
  onRemoveTag: (skillId: string, tagToRemove: string) => void;
  isUpdating?: boolean;
}

export const SkillDetailModal: React.FC<SkillDetailModalProps> = ({
  skill,
  tools,
  onClose,
  onToggleToolDeploy,
  onUpdate,
  onShare,
  onUninstall,
  onAddTag,
  onRemoveTag,
  isUpdating = false,
}) => {
  const [activeTab, setActiveTab] = useState<'doc' | 'files'>('doc');
  const [tagInput, setTagInput] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const enabledTools = tools.filter((t) => t.isEnabled);
  const isProject = skill?.scope === 'project';

  // 打开详情时拉取真实 documentation / files（列表接口中这两个字段可为空）
  const detailQuery = useSkillDetail(skill?.id);
  const detail = detailQuery.data ?? skill;
  const fileList = flattenFiles(detail?.files ?? []);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!skill) return null;

  const handleSaveTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (tagInput.trim()) {
      onAddTag(skill.id, tagInput.trim());
      setTagInput('');
      setIsAddingTag(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200/80 flex items-start justify-between bg-slate-50/70">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">{skill.displayName}</h2>
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
                {skill.name}
              </span>
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1">
                <GitBranch className="w-3 h-3 text-indigo-500" />
                <span>SHA: {skill.currentCommit || '-'}</span>
              </span>
              {skill.scope === 'global' ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Globe className="w-3 h-3" />
                  全局可用
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                  <FolderGit2 className="w-3 h-3" />
                  项目: {skill.projectName}
                </span>
              )}
              {skill.descriptionStatus !== 'ready' && (
                <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-lg border ${
                  skill.descriptionStatus === 'failed'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {skill.descriptionStatus === 'failed' ? '简介生成失败，可在设置重试' : '中文简介等待生成'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">{skill.description}</p>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Update alert if available */}
        {skill.hasUpdate && (
          <div className="bg-amber-50 px-6 py-3.5 border-b border-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse"></span>
              <div>
                <div className="text-xs font-bold text-amber-900">
                  发现远端新版本: commit <span className="font-mono">{skill.latestCommit}</span>
                </div>
                {skill.updateChangelog && (
                  <div className="text-xs text-amber-800 mt-0.5">{skill.updateChangelog}</div>
                )}
              </div>
            </div>
            <button
              onClick={() => onUpdate(skill)}
              disabled={isUpdating}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? '正在更新...' : '立即一键更新'}</span>
            </button>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 text-xs">
            <div>
              <div className="text-slate-400 mb-1 flex items-center gap-1">
                <User className="w-3 h-3" />
                <span>作者 / 维护团队</span>
              </div>
              <div className="font-semibold text-slate-800">{skill.author}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-1 flex items-center gap-1">
                <Shield className="w-3 h-3" />
                <span>开源协议</span>
              </div>
              <div className="font-semibold text-slate-800">{skill.license}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>安装时间</span>
              </div>
              <div className="font-semibold text-slate-800 font-mono">{skill.installedAt}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-1 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                <span>来源渠道</span>
              </div>
              {skill.source.url ? (
                <a
                  href={skill.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-indigo-600 hover:underline flex items-center gap-1 truncate"
                >
                  <span className="truncate">{skill.source.repo || '访问页面'}</span>
                </a>
              ) : (
                <span className="font-semibold text-slate-700">本地技能导入</span>
              )}
            </div>
          </div>

          {/* Tool Deployments Matrix inside Detail Modal */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                <span>目标工具分发生效状态</span>
              </span>
              <span className="text-[11px] text-slate-400">
                {isProject
                  ? '点击即可在项目内工具目录中建立或移除分发'
                  : '点击即可建立或移除符号链接'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {enabledTools.length === 0 ? (
                <div className="col-span-full py-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  暂无启用的 AI 工具，请在“AI 工具”设置中先开启对应工具
                </div>
              ) : (
                enabledTools.map((tool) => {
                  const isDeployed = !!skill.deployedTools[tool.id];
                  return (
                    <button
                      key={tool.id}
                      onClick={() => onToggleToolDeploy(skill.id, tool.id)}
                      className={`p-3 rounded-2xl border text-left flex items-center justify-between transition-all ${
                        isDeployed
                          ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 shadow-2xs font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-white'
                      }`}
                      title={
                        isProject
                          ? isDeployed
                            ? `${tool.name}: 已分发到项目内技能目录 (点击停止分发)`
                            : `${tool.name}: 未分发 (点击分发到项目内技能目录)`
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-2">
                        <ToolBrandIcon toolId={tool.id} size={18} />
                        <span className="text-xs">{tool.name}</span>
                      </div>
                      <div
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                          isDeployed ? 'bg-emerald-600 text-white' : 'border border-slate-300'
                        }`}
                      >
                        {isDeployed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Tags management */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <TagIcon className="w-3.5 h-3.5 text-indigo-600" />
                <span>分类标签</span>
              </span>
              {!isAddingTag && (
                <button
                  onClick={() => setIsAddingTag(true)}
                  className="text-indigo-600 hover:text-indigo-800 text-xs font-semibold hover:underline"
                >
                  + 添加标签
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 text-xs bg-slate-100/90 text-slate-700 px-3 py-1 rounded-lg border border-slate-200 font-medium"
                >
                  <span>#{tag}</span>
                  <button
                    onClick={() => onRemoveTag(skill.id, tag)}
                    className="ml-1 text-slate-400 hover:text-rose-600 transition-colors"
                    title="移除标签"
                  >
                    ×
                  </button>
                </span>
              ))}

              {isAddingTag && (
                <form onSubmit={handleSaveTag} className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    autoFocus
                    placeholder="标签名称..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 w-32"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingTag(false)}
                    className="px-2 py-1 bg-slate-200 text-slate-700 rounded-lg text-xs hover:bg-slate-300"
                  >
                    取消
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Documentation & File Tree Tabs */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <div className="bg-slate-100/70 border-b border-slate-200 px-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('doc')}
                  className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                    activeTab === 'doc'
                      ? 'border-indigo-600 text-indigo-700 bg-white shadow-2xs'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>SKILL.md 文档预览</span>
                </button>
                <button
                  onClick={() => setActiveTab('files')}
                  className={`px-4 py-2.5 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors ${
                    activeTab === 'files'
                      ? 'border-indigo-600 text-indigo-700 bg-white shadow-2xs'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FolderTree className="w-3.5 h-3.5" />
                  <span>文件清单 ({detailQuery.isError ? '-' : (detail?.files.length ?? 0)})</span>
                </button>
              </div>
            </div>

            <div className="p-5 bg-white min-h-[220px] max-h-[360px] overflow-y-auto text-xs">
              {detailQuery.isError ? (
                <div className="py-10 text-center space-y-3">
                  <p className="text-rose-600 font-semibold">读取技能详情失败</p>
                  <p className="text-slate-500 break-all">
                    {detailQuery.error instanceof Error
                      ? detailQuery.error.message
                      : String(detailQuery.error)}
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <button
                      onClick={() => detailQuery.refetch()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>重试</span>
                    </button>
                    <button
                      onClick={onClose}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              ) : activeTab === 'doc' ? (
                detailQuery.isLoading ? (
                  <div className="py-10 text-center text-slate-400">正在读取 SKILL.md 文档...</div>
                ) : detail?.documentation ? (
                  <div className="markdown-doc">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {detail.documentation}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="py-10 text-center text-slate-400">该技能未提供说明文档</div>
                )
              ) : detailQuery.isLoading ? (
                <div className="py-10 text-center text-slate-400">正在读取文件清单...</div>
              ) : fileList.length === 0 ? (
                <div className="py-10 text-center text-slate-400">暂无文件清单</div>
              ) : (
                <div className="space-y-1.5 font-mono text-xs">
                  {fileList.map(({ file, depth }) => (
                    <div key={file.path} className="flex items-center justify-between py-1.5 px-3 rounded-xl hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 16}px` }}>
                        {file.type === 'dir' ? (
                          <span className="text-amber-500 font-bold">📁 {file.name}/</span>
                        ) : (
                          <span className="text-slate-700">📄 {file.name}</span>
                        )}
                      </div>
                      <span className="text-slate-400 text-[11px]">{file.size}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <button
            onClick={() => onUninstall(skill)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>彻底卸载技能</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onShare(skill)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <Share2 className="w-3.5 h-3.5 text-slate-500" />
              <span>生成分享链接</span>
            </button>
            <button
              onClick={onClose}
              className="px-5 py-1.5 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-xs"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
