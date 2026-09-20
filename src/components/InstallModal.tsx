import React, { useState, useEffect } from 'react';
import { 
  X, 
  Download, 
  ShieldAlert, 
  Globe, 
  FolderGit2, 
  Check, 
  Sparkles, 
  Layers,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { DiscoverySkillItem } from '../types';
import { ToolAdapter, ProjectScope, ToolId, ScopeType } from '../types';
import { ToolBrandIcon } from './icons/BrandIcons';
import { useAppState } from '../hooks/useAppState';

interface InstallModalProps {
  item: DiscoverySkillItem | null;
  tools: ToolAdapter[];
  projects: ProjectScope[];
  onClose: () => void;
  onConfirmInstall: (params: {
    item: DiscoverySkillItem;
    scope: ScopeType;
    projectId?: string;
    selectedTools: Record<ToolId, boolean>;
    deployMethod: 'symlink' | 'copy';
  }) => void;
  /** 安装命令执行中（真实后端进度，由外部 mutation 驱动） */
  isInstalling?: boolean;
  /** 安装失败信息（展示后可返回配置页重试） */
  installError?: string | null;
}

export const InstallModal: React.FC<InstallModalProps> = ({
  item,
  tools,
  projects,
  onClose,
  onConfirmInstall,
  isInstalling = false,
  installError = null,
}) => {
  // 应用设置（react-query 缓存；数据未就绪时回落默认行为）
  const { data: appState } = useAppState();

  const [step, setStep] = useState<'config' | 'installing'>('config');
  const [scope, setScope] = useState<ScopeType>('global');
  const [projectId, setProjectId] = useState<string>(projects[0]?.id || '');
  // 默认勾选所有已启用的工具
  const [selectedTools, setSelectedTools] = useState<Record<ToolId, boolean>>(() =>
    Object.fromEntries(tools.filter((t) => t.isEnabled).map((t) => [t.id, true])),
  );
  // 部署方式默认值取自全局设置，设置未就绪时回落 symlink
  const [deployMethod, setDeployMethod] = useState<'symlink' | 'copy'>(
    () => appState?.settings?.distributionMethod ?? 'symlink',
  );

  // 安装失败时回到配置页以便调整重试
  useEffect(() => {
    if (installError) setStep('config');
  }, [installError]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isInstalling) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isInstalling]);

  if (!item) return null;

  const toggleTool = (toolId: ToolId) => {
    setSelectedTools((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  const handleStartInstall = () => {
    // 防护：安装进行中或项目作用域未选项目时不允许提交
    if (isInstalling) return;
    if (scope === 'project' && !projectId) return;
    setStep('installing');
    onConfirmInstall({
      item,
      scope,
      projectId: scope === 'project' ? projectId : undefined,
      selectedTools,
      deployMethod,
    });
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isInstalling) onClose();
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs shadow-indigo-500/20">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">安装技能并分发至工具</h3>
              <p className="text-[11px] text-slate-500 font-mono">
                {item.repo || item.author}
              </p>
            </div>
          </div>
          {!isInstalling && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
              title="关闭 (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs">
          {step === 'installing' ? (
            <div className="py-10 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 animate-spin">
                <Sparkles className="w-7 h-7" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">正在安装并建立分发链接...</h4>
                <p className="text-slate-500 text-xs mt-1 font-mono">
                  1. 下载并解压至技能仓库 → 2. 写入本地索引 → 3. 分发到目标工具目录
                </p>
              </div>
              <div className="w-72 mx-auto bg-slate-100 rounded-full h-2.5 overflow-hidden relative">
                <div className="progress-indeterminate bg-indigo-600" />
              </div>
            </div>
          ) : (
            <>
              {/* Skill Brief Banner */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <span>{item.displayName}</span>
                    {/* latestCommit 实际可能是分支名：仅 7-40 位十六进制 SHA 才展示为 commit，分支名按分支展示，空值不渲染 */}
                    {item.latestCommit && (
                      <span className="font-mono text-[10px] bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded-md">
                        {/^[0-9a-f]{7,40}$/i.test(item.latestCommit)
                          ? `commit ${item.latestCommit}`
                          : `分支 ${item.latestCommit}`}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-600 mt-1 text-xs leading-relaxed">{item.description}</p>
                </div>
              </div>

              {/* Install Error Banner */}
              {installError && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200/80 text-rose-900 text-[11px] leading-relaxed whitespace-pre-wrap">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">安装失败：</span>
                    {installError}
                  </div>
                </div>
              )}

              {/* Source Safety Disclaimer */}
              <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/80 text-amber-900 text-[11px] leading-relaxed">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">安全提示：</span>
                  此技能来自外部第三方源（{item.repo || item.author}）。客户端纯本地运行，不拦截脚本，请确保您信任该仓库及其指令规范。
                </div>
              </div>

              {/* Scope Selection */}
              <div className="space-y-2">
                <label className="font-bold text-slate-800 block text-xs">
                  1. 选择生效作用域
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setScope('global')}
                    className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all ${
                      scope === 'global'
                        ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <Globe className={`w-4 h-4 mt-0.5 ${scope === 'global' ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <div>
                      <div className="font-bold text-slate-900">全局作用域 (Global)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">对本机所有工程及终端窗口通用生效</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('project')}
                    className={`p-3.5 rounded-2xl border text-left flex items-start gap-3 transition-all ${
                      scope === 'project'
                        ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <FolderGit2 className={`w-4 h-4 mt-0.5 ${scope === 'project' ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <div>
                      <div className="font-bold text-slate-900">项目专属 (Project)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">仅在选定的代码项目文件夹下生效</div>
                    </div>
                  </button>
                </div>

                {scope === 'project' && (
                  <div className="mt-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <label className="text-[11px] text-slate-600 font-semibold block mb-1.5">
                      选择已注册的目标项目：
                    </label>
                    {projects.length === 0 ? (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-lg px-3 py-2">
                        尚未注册任何项目，请先在「项目工程」页注册本地工程目录。
                      </div>
                    ) : (
                      <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500/20"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.path})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Target Tools Selection */}
              <div className="space-y-2">
                <label className="font-bold text-slate-800 block text-xs">
                  2. 选择启用的 AI 工具
                </label>
                {scope === 'project' ? (
                  // 项目作用域下后端不做工具部署（仅记录偏好），此处仅作说明
                  <div className="p-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 text-[11px] text-slate-500 leading-relaxed">
                    项目技能将直接通过项目内 .claude/skills 与 skills 目录链接生效，无需选择工具。
                  </div>
                ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {tools.filter((t) => t.isEnabled).length === 0 ? (
                    <div className="col-span-full py-3 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      暂无启用的 AI 工具，可安装后在「AI 工具」页启用并分发
                    </div>
                  ) : (
                    tools.filter((t) => t.isEnabled).map((tool) => {
                    const isChecked = !!selectedTools[tool.id];
                    return (
                      <div
                        key={tool.id}
                        onClick={() => toggleTool(tool.id)}
                        className={`p-3 rounded-2xl border cursor-pointer flex items-center justify-between transition-all ${
                          isChecked
                            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 font-semibold shadow-2xs'
                            : 'bg-slate-50/70 border-slate-200 text-slate-600 hover:bg-slate-100/60'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <ToolBrandIcon toolId={tool.id} size={18} />
                          <span className="text-xs">{tool.name}</span>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] ${
                            isChecked ? 'bg-emerald-600 border border-emerald-600' : 'border border-slate-300 bg-white'
                          }`}
                        >
                          {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                      </div>
                    );
                    })
                  )}
                </div>
                )}
              </div>

              {/* Distribution Method Confirmation */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span className="text-slate-600">分发方式:</span>
                  <span className="font-bold text-slate-800">
                    {deployMethod === 'symlink' ? '符号链接 (Symlink · 零冗余即时同步)' : '文件复制 (Copy)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDeployMethod(deployMethod === 'symlink' ? 'copy' : 'symlink')}
                  className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline"
                >
                  切换为{deployMethod === 'symlink' ? '文件复制' : '符号链接'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {step !== 'installing' && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-end gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleStartInstall}
              disabled={isInstalling || (scope === 'project' && !projectId)}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
              title={scope === 'project' && !projectId ? '请先选择目标项目' : undefined}
            >
              {isInstalling ? (
                <span>正在安装...</span>
              ) : (
                <>
                  <span>确认安装并启用</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
