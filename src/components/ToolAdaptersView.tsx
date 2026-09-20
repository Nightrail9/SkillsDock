import React, { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { 
  Plus, 
  CheckCircle2, 
  Trash2, 
  FolderOpen
} from 'lucide-react';
import { ToolAdapter, AddToastFn } from '../types';
import { ToolBrandIcon } from './icons/BrandIcons';
import {
  useAddToolAdapter,
  useUpdateToolAdapter,
  useDeleteToolAdapter,
  useToggleToolEnabled,
} from '../hooks/useTools';
import { toolsApi } from '../lib/api';
import { useAppState } from '../hooks/useAppState';
import { collapseHomePath } from '../lib/utils/pathDisplay';
import { errorToString } from '../lib/errors/skillErrorParser';

interface ToolAdaptersViewProps {
  tools: ToolAdapter[];
  addToast: AddToastFn;
}

export const ToolAdaptersView: React.FC<ToolAdaptersViewProps> = ({
  tools,
  addToast,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  // 待确认移除的工具（点击「移除工具」后先弹确认框）
  const [toolPendingDelete, setToolPendingDelete] = useState<ToolAdapter | null>(null);

  const addToolMutation = useAddToolAdapter();
  const updateToolMutation = useUpdateToolAdapter();
  const deleteToolMutation = useDeleteToolAdapter();
  const toggleToolMutation = useToggleToolEnabled();
  const homeDir = useAppState().data?.homeDir;

  const handleToggleEnabled = (tool: ToolAdapter) => {
    toggleToolMutation.mutate(
      { id: tool.id, enabled: !tool.isEnabled },
      {
        onSuccess: () => addToast('info', `已${tool.isEnabled ? '停用' : '启用'}工具适配「${tool.name}」`),
        onError: (err) => addToast('error', '工具状态切换失败', errorToString(err)),
      },
    );
  };

  /** Tauri 原生目录选择 + 后端路径校验 + 更新 */
  const handlePickFolder = async (tool: ToolAdapter) => {
    let selected: string | null = null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: `选择 ${tool.name} 的技能目录`,
      });
      if (typeof result === 'string') selected = result;
    } catch (err) {
      addToast('error', '无法打开目录选择器', errorToString(err));
      return;
    }
    if (!selected) return;

    try {
      const validation = await toolsApi.validateToolPath(selected);
      if (!validation.valid) {
        addToast('warning', '路径校验未通过', validation.message || `目录不可用：${selected}`);
        return;
      }
    } catch (err) {
      addToast('error', '路径校验失败', errorToString(err));
      return;
    }

    updateToolMutation.mutate(
      { id: tool.id, name: tool.name, skillsDir: selected },
      {
        onSuccess: () => addToast('success', '已更新工具技能目录路径', selected),
        onError: (err) => addToast('error', '更新工具路径失败', errorToString(err)),
      },
    );
  };

  /** 确认后执行移除：后端会同步清除该工具在全部分发状态中的记录 */
  const handleDeleteTool = (tool: ToolAdapter) => {
    deleteToolMutation.mutate(tool.id, {
      onSuccess: () => addToast('info', `已移除自定义工具适配「${tool.name}」`),
      onError: (err) => addToast('error', '移除工具失败', errorToString(err)),
      onSettled: () => setToolPendingDelete(null),
    });
  };

  const handlePickCustomPath = async () => {
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: '选择自定义工具的技能目录',
      });
      if (typeof result === 'string') setCustomPath(result);
    } catch (err) {
      addToast('error', '无法打开目录选择器', errorToString(err));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customPath.trim()) return;

    setIsValidating(true);
    try {
      const validation = await toolsApi.validateToolPath(customPath.trim());
      if (!validation.valid) {
        addToast('warning', '路径校验未通过', validation.message || `目录不可用：${customPath}`);
        return;
      }
    } catch (err) {
      addToast('error', '路径校验失败', errorToString(err));
      return;
    } finally {
      setIsValidating(false);
    }

    addToolMutation.mutate(
      {
        name: customName.trim(),
        vendor: 'Custom',
        description: customDesc.trim() || '用户自定义 AI 编程智能体工具',
        skillsDir: customPath.trim(),
        color: '#6366F1',
      },
      {
        onSuccess: (created) => {
          addToast('success', `已添加自定义工具适配「${created.name}」`);
          setCustomName('');
          setCustomDesc('');
          setCustomPath('');
          setShowAddModal(false);
        },
        onError: (err) => addToast('error', '添加自定义工具失败', errorToString(err)),
      },
    );
  };

  const isBusy =
    addToolMutation.isPending ||
    updateToolMutation.isPending ||
    deleteToolMutation.isPending ||
    toggleToolMutation.isPending ||
    isValidating;

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Compact Top Action Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
        <div className="text-xs text-slate-500 font-medium">
          已纳管 <strong className="text-slate-800 font-bold">{tools.length}</strong> 个 AI 编程工具
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl transition-colors shadow-xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>添加自定义工具</span>
        </button>
      </div>

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className={`p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between ${
              tool.isEnabled
                ? 'bg-white border-slate-200/90 shadow-xs hover:shadow-md hover:border-slate-300'
                : 'bg-slate-50/80 border-slate-200/80 opacity-70'
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <ToolBrandIcon toolId={tool.id} size={26} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{tool.name}</h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold font-mono">
                        {tool.vendor}
                      </span>
                      {tool.isBuiltin && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold">
                          官方适配
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 leading-relaxed">{tool.description}</div>
                  </div>
                </div>

                {/* Master Switch */}
                <button
                  onClick={() => handleToggleEnabled(tool)}
                  disabled={isBusy}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50 ${
                    tool.isEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                  role="switch"
                  aria-checked={tool.isEnabled}
                  title={tool.isEnabled ? '点击停用该工具' : '点击启用该工具'}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      tool.isEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Path & Stats */}
              <div className="space-y-2 text-xs pt-3 border-t border-slate-100">
                <div>
                  <span className="text-slate-400 text-[11px] font-semibold">本地技能目录:</span>
                  <div className="flex items-center gap-2 mt-1">
                    <code
                      className={`font-mono text-[11px] px-2.5 py-1.5 rounded-lg flex-1 truncate border ${
                        tool.detected
                          ? 'bg-slate-100/90 text-slate-800 border-slate-200/60'
                          : 'bg-amber-50 text-amber-800 border-amber-200/70'
                      }`}
                      title={tool.detected ? tool.currentPath : '目录当前不可访问'}
                    >
                      {collapseHomePath(tool.currentPath, homeDir)}
                    </code>
                    <button
                      type="button"
                      onClick={() => handlePickFolder(tool)}
                      disabled={isBusy}
                      className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 rounded-lg border border-slate-200/80 hover:border-indigo-200 transition-colors shrink-0 shadow-2xs cursor-pointer disabled:opacity-50"
                      title="选择本地技能文件夹"
                      aria-label="选择本地技能文件夹"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {!tool.detected && (
                    <div className="text-[10px] text-amber-700 mt-1">该目录当前不可访问，请检查路径或重新选择。</div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-3 mt-3 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>已纳管 {tool.installedSkillsCount} 个技能</span>
              </div>

              {!tool.isBuiltin && (
                <button
                  onClick={() => setToolPendingDelete(tool)}
                  disabled={isBusy}
                  className="text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 text-xs hover:underline disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>移除工具</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Custom Tool Modal */}
      {showAddModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false);
          }}
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-slate-900">添加自定义 AI 工具</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              输入工具名称及其在本机的 Skills 扫描目录即可快速接入技能仓库分发网络。
            </p>

            <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">工具名称</label>
                <input
                  type="text"
                  required
                  placeholder="例如: Cline / Roo Code / Cursor"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">技能目录路径</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    placeholder="例如: C:\Users\you\.cline\skills"
                    value={customPath}
                    onChange={(e) => setCustomPath(e.target.value)}
                    className="flex-1 p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    type="button"
                    onClick={handlePickCustomPath}
                    className="p-2.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-slate-200 transition-colors shrink-0"
                    title="选择文件夹"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">描述信息 (可选)</label>
                <input
                  type="text"
                  placeholder="例如: VS Code 智能体编程插件"
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 text-xs font-semibold"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white rounded-xl font-bold shadow-xs text-xs flex items-center gap-1.5"
                >
                  {(isValidating || addToolMutation.isPending) && (
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{isValidating ? '校验路径中...' : addToolMutation.isPending ? '保存中...' : '保存并启用'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Tool Confirm Modal */}
      {toolPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleteToolMutation.isPending) {
              setToolPendingDelete(null);
            }
          }}
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  确认移除工具适配「{toolPendingDelete.name}」？
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {toolPendingDelete.installedSkillsCount > 0
                    ? `该工具将从 ${toolPendingDelete.installedSkillsCount} 个技能的分发状态中移除，已建立的链接映射会被同步清除。`
                    : '移除后，该工具在所有技能中的分发状态与链接映射将被同步清除，且不再参与跨工具同步。'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setToolPendingDelete(null)}
                disabled={deleteToolMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTool(toolPendingDelete)}
                disabled={deleteToolMutation.isPending}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
              >
                {deleteToolMutation.isPending && (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                <span>{deleteToolMutation.isPending ? '正在移除...' : '确认移除'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
