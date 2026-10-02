import React, { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { 
  Plus, 
  CheckCircle2, 
  Trash2, 
  FolderOpen
} from 'lucide-react';
import { AppLocale, ToolAdapter, AddToastFn, UnmanagedSkill } from '../types';
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
import { useScanUnmanagedSkills, useImportSkillsFromApps } from '../hooks/useSkills';

interface ToolAdaptersViewProps {
  tools: ToolAdapter[];
  addToast: AddToastFn;
  locale: AppLocale;
}

const BUILT_IN_TOOL_DESCRIPTIONS_EN: Record<string, string> = {
  'claude-code': 'Anthropic’s official terminal agent with project context and automated workflows.',
  codex: 'OpenAI’s coding assistant CLI and development-workspace skills engine.',
  'antigravity-cli': 'Google’s agentic terminal development platform with multi-agent workflows.',
  opencode: 'An open-source local coding-agent suite with flexible multi-model routing.',
  openclaw: 'An open-source multi-platform AI agent with local automation and Telegram/Discord workflows.',
  hermes: 'Nous Research’s self-evolving agent with persistent memory and autonomous skill generation.',
};

export const ToolAdaptersView: React.FC<ToolAdaptersViewProps> = ({
  tools,
  addToast,
  locale,
}) => {
  const t = (zh: string, en: string) => (locale === 'en' ? en : zh);
  const [showAddModal, setShowAddModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  // 待确认移除的工具（点击「移除工具」后先弹确认框）
  const [toolPendingDelete, setToolPendingDelete] = useState<ToolAdapter | null>(null);
  const [unmanagedSkillsToImport, setUnmanagedSkillsToImport] = useState<UnmanagedSkill[] | null>(null);
  const [isScanningUnmanaged, setIsScanningUnmanaged] = useState(false);
  const [unmanagedScanFeedback, setUnmanagedScanFeedback] = useState<{
    kind: 'scanning' | 'empty' | 'error';
    message: string;
  } | null>(null);

  const addToolMutation = useAddToolAdapter();
  const updateToolMutation = useUpdateToolAdapter();
  const deleteToolMutation = useDeleteToolAdapter();
  const toggleToolMutation = useToggleToolEnabled();
  const scanUnmanagedQuery = useScanUnmanagedSkills({
    enabled: false,
  });
  const importUnmanagedMutation = useImportSkillsFromApps();
  const homeDir = useAppState().data?.homeDir;

  const handleToggleEnabled = (tool: ToolAdapter) => {
    // 启停成功不弹提示（按产品要求仅错误弹窗）；失败才反馈
    const enabled = !tool.isEnabled;
    toggleToolMutation.mutate(
      { id: tool.id, enabled },
      {
        onError: (err) => addToast('error', t('工具状态切换失败', 'Failed to update tool status'), errorToString(err)),
        onSuccess: async () => {
          if (!enabled) return;
          setIsScanningUnmanaged(true);
          setUnmanagedSkillsToImport(null);
          setUnmanagedScanFeedback({
            kind: 'scanning',
            message: t('正在扫描已启用工具的技能目录...', 'Scanning enabled tool directories for skills...'),
          });
          try {
            const result = await scanUnmanagedQuery.refetch();
            if (result.error) {
              setUnmanagedScanFeedback({
                kind: 'error',
                message: t(`扫描存量技能失败：${errorToString(result.error)}`, `Failed to scan existing skills: ${errorToString(result.error)}`),
              });
            } else if (result.data && result.data.length > 0) {
              setUnmanagedScanFeedback(null);
              setUnmanagedSkillsToImport(result.data);
            } else {
              setUnmanagedScanFeedback({
                kind: 'empty',
                message: t('扫描完成，未发现待导入技能。', 'Scan complete. No skills to import were found.'),
              });
            }
          } catch (err) {
            setUnmanagedScanFeedback({
              kind: 'error',
              message: t(`扫描存量技能失败：${errorToString(err)}`, `Failed to scan existing skills: ${errorToString(err)}`),
            });
          } finally {
            setIsScanningUnmanaged(false);
          }
        },
      },
    );
  };

  const handleImportUnmanagedSkills = () => {
    if (!unmanagedSkillsToImport?.length) return;
    importUnmanagedMutation.mutate(
      unmanagedSkillsToImport.map((skill) => ({
        directory: skill.directory,
        sourceDirectory: skill.sourceDirectory,
        relativePath: skill.relativePath,
        // 扫描只返回当前已启用工具中的存量技能，使用原发现位置作为导入分发目标。
        toolIds: skill.foundIn,
      })),
      {
        onSuccess: (imported) => {
          setUnmanagedSkillsToImport(null);
          addToast('success', t('存量技能导入完成', 'Existing skills imported'), t(`已导入 ${imported.length} 个技能至技能仓库。`, `Imported ${imported.length} skills into the library.`));
        },
        onError: (err) => addToast('error', t('存量技能导入失败', 'Failed to import existing skills'), errorToString(err)),
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
        title: t(`选择 ${tool.name} 的技能目录`, `Select the skills directory for ${tool.name}`),
      });
      if (typeof result === 'string') selected = result;
    } catch (err) {
      addToast('error', t('无法打开目录选择器', 'Unable to open the folder picker'), errorToString(err));
      return;
    }
    if (!selected) return;

    try {
      const validation = await toolsApi.validateToolPath(selected);
      if (!validation.valid) {
        addToast('warning', t('路径校验未通过', 'Path validation failed'), validation.message || t(`目录不可用：${selected}`, `Directory is unavailable: ${selected}`));
        return;
      }
    } catch (err) {
      addToast('error', t('路径校验失败', 'Path validation failed'), errorToString(err));
      return;
    }

    updateToolMutation.mutate(
      { id: tool.id, name: tool.name, skillsDir: selected },
      {
        onSuccess: () => addToast('success', t('已更新工具技能目录路径', 'Tool skills directory updated'), selected),
        onError: (err) => addToast('error', t('更新工具路径失败', 'Failed to update tool path'), errorToString(err)),
      },
    );
  };

  /** 确认后执行移除：后端会同步清除该工具在全部分发状态中的记录 */
  const handleDeleteTool = (tool: ToolAdapter) => {
    deleteToolMutation.mutate(tool.id, {
      onSuccess: () => addToast('info', t(`已移除自定义工具适配「${tool.name}」`, `Removed custom tool adapter "${tool.name}"`)),
      onError: (err) => addToast('error', t('移除工具失败', 'Failed to remove tool'), errorToString(err)),
      onSettled: () => setToolPendingDelete(null),
    });
  };

  const handlePickCustomPath = async () => {
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: t('选择自定义工具的技能目录', 'Select the skills directory for the custom tool'),
      });
      if (typeof result === 'string') setCustomPath(result);
    } catch (err) {
      addToast('error', t('无法打开目录选择器', 'Unable to open the folder picker'), errorToString(err));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customPath.trim()) return;

    setIsValidating(true);
    try {
      const validation = await toolsApi.validateToolPath(customPath.trim());
      if (!validation.valid) {
        addToast('warning', t('路径校验未通过', 'Path validation failed'), validation.message || t(`目录不可用：${customPath}`, `Directory is unavailable: ${customPath}`));
        return;
      }
    } catch (err) {
      addToast('error', t('路径校验失败', 'Path validation failed'), errorToString(err));
      return;
    } finally {
      setIsValidating(false);
    }

    addToolMutation.mutate(
      {
        name: customName.trim(),
        vendor: 'Custom',
        description: customDesc.trim() || t('用户自定义 AI 编程智能体工具', 'Custom AI coding assistant'),
        skillsDir: customPath.trim(),
        color: '#6366F1',
      },
      {
        onSuccess: (created) => {
          addToast('success', t(`已添加自定义工具适配「${created.name}」`, `Added custom tool adapter "${created.name}"`));
          setCustomName('');
          setCustomDesc('');
          setCustomPath('');
          setShowAddModal(false);
        },
        onError: (err) => addToast('error', t('添加自定义工具失败', 'Failed to add custom tool'), errorToString(err)),
      },
    );
  };

  // 每个控件的忙碌状态只跟随“自己这次操作”变化。
  // 早期用全局 isBusy 会让任一 mutation 进行中时所有开关/按钮一起 disabled:opacity-50，
  // 表现为切换一个工具时其它工具的开关集体闪烁。
  const togglingToolId = toggleToolMutation.isPending ? toggleToolMutation.variables?.id : null;
  const updatingToolId = updateToolMutation.isPending ? updateToolMutation.variables?.id : null;

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Compact Top Action Bar */}
      <div className="flex items-center justify-end pb-3 border-b border-slate-200/80">
        <button
          onClick={() => setShowAddModal(true)}
          disabled={addToolMutation.isPending || isValidating}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl transition-colors shadow-xs shrink-0 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加自定义工具', 'Add custom tool')}</span>
        </button>
      </div>
      {unmanagedScanFeedback && (
        <p
          role={unmanagedScanFeedback.kind === 'error' ? 'alert' : 'status'}
          className={`-mt-4 text-xs ${
            unmanagedScanFeedback.kind === 'error'
              ? 'text-rose-600'
              : unmanagedScanFeedback.kind === 'scanning'
                ? 'text-indigo-600'
                : 'text-slate-500'
          }`}
        >
          {unmanagedScanFeedback.message}
        </p>
      )}

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tools.map((tool) => {
          const isTogglingThis = togglingToolId === tool.id;
          const isUpdatingThis = updatingToolId === tool.id;
          return (
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
                          {t('官方适配', 'Built-in')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                      {tool.isBuiltin && locale === 'en'
                        ? BUILT_IN_TOOL_DESCRIPTIONS_EN[tool.id] ?? tool.description
                        : tool.description}
                    </div>
                  </div>
                </div>

                {/* Master Switch */}
                <button
                  onClick={() => handleToggleEnabled(tool)}
                  disabled={isTogglingThis || isScanningUnmanaged}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50 disabled:cursor-wait ${
                    tool.isEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                  role="switch"
                  aria-checked={tool.isEnabled}
                  title={tool.isEnabled ? t('点击停用该工具', 'Disable this tool') : t('点击启用该工具', 'Enable this tool')}
                  aria-label={tool.name}
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
                  <span className="text-slate-400 text-[11px] font-semibold">{t('本地技能目录:', 'Local skills directory:')}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <code
                      className={`font-mono text-[11px] px-2.5 py-1.5 rounded-lg flex-1 truncate border ${
                        tool.detected
                          ? 'bg-slate-100/90 text-slate-800 border-slate-200/60'
                          : 'bg-amber-50 text-amber-800 border-amber-200/70'
                      }`}
                      title={tool.detected ? tool.currentPath : t('目录当前不可访问', 'Directory is unavailable')}
                    >
                      {collapseHomePath(tool.currentPath, homeDir)}
                    </code>
                    <button
                      type="button"
                      onClick={() => handlePickFolder(tool)}
                      disabled={isUpdatingThis}
                      className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100 rounded-lg border border-slate-200/80 hover:border-indigo-200 transition-colors shrink-0 shadow-2xs cursor-pointer disabled:opacity-50"
                      title={t('选择本地技能文件夹', 'Choose a local skills folder')}
                      aria-label={t('选择本地技能文件夹', 'Choose a local skills folder')}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {!tool.detected && (
                    <div className="text-[10px] text-amber-700 mt-1">{t('该目录当前不可访问，请检查路径或重新选择。', 'This directory is unavailable. Check the path or choose another one.')}</div>
                  )}
                </div>

              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-3 mt-3 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                <span>{t(`已纳管 ${tool.installedSkillsCount} 个技能`, `${tool.installedSkillsCount} skills managed`)}</span>
              </div>

              {!tool.isBuiltin && (
                <button
                  onClick={() => setToolPendingDelete(tool)}
                  disabled={deleteToolMutation.isPending}
                  className="text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 text-xs hover:underline disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('移除工具', 'Remove tool')}</span>
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>

      {/* Add Custom Tool Modal */}
      {showAddModal && (
        <div
          data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-slate-900">{t('添加自定义 AI 工具', 'Add a custom AI tool')}</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {t('输入工具名称及其在本机的 Skills 扫描目录即可快速接入技能仓库分发网络。', 'Enter a tool name and its local Skills directory to add it to the distribution network.')}
            </p>

            <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('工具名称', 'Tool name')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('例如: Cline / Roo Code / Cursor', 'e.g. Cline / Roo Code / Cursor')}
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('技能目录路径', 'Skills directory path')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    placeholder={t('例如: C:\\Users\\you\\.cline\\skills', 'e.g. C:\\Users\\you\\.cline\\skills')}
                    value={customPath}
                    onChange={(e) => setCustomPath(e.target.value)}
                    className="flex-1 p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    type="button"
                    onClick={handlePickCustomPath}
                    className="p-2.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl border border-slate-200 transition-colors shrink-0"
                    title={t('选择文件夹', 'Choose a folder')}
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">{t('描述信息 (可选)', 'Description (optional)')}</label>
                <input
                  type="text"
                  placeholder={t('例如: VS Code 智能体编程插件', 'e.g. an AI coding extension for VS Code')}
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
                  {t('取消', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={addToolMutation.isPending || isValidating}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white rounded-xl font-bold shadow-xs text-xs flex items-center gap-1.5"
                >
                  {(isValidating || addToolMutation.isPending) && (
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{isValidating ? t('校验路径中...', 'Validating path...') : addToolMutation.isPending ? t('保存中...', 'Saving...') : t('保存并启用', 'Save and enable')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Tool Confirm Modal */}
      {toolPendingDelete && (
        <div
          data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {t(`确认移除工具适配「${toolPendingDelete.name}」？`, `Remove the "${toolPendingDelete.name}" tool adapter?`)}
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {toolPendingDelete.installedSkillsCount > 0
                    ? t(`该工具将从 ${toolPendingDelete.installedSkillsCount} 个技能的分发状态中移除，已建立的链接映射会被同步清除。`, `This tool will be removed from ${toolPendingDelete.installedSkillsCount} skills, and its deployment links will be cleared.`)
                    : t('移除后，该工具在所有技能中的分发状态与链接映射将被同步清除，且不再参与跨工具同步。', 'Removing this tool clears its deployment state and links from all skills. It will no longer participate in cross-tool synchronization.')}
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
                {t('取消', 'Cancel')}
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
                <span>{deleteToolMutation.isPending ? t('正在移除...', 'Removing...') : t('确认移除', 'Remove tool')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {unmanagedSkillsToImport && (
        <div data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{t('发现未纳管的存量技能', 'Existing unmanaged skills found')}</h3>
              <p className="text-xs text-slate-500 mt-1">
                {t(`是否将以下 ${unmanagedSkillsToImport.length} 个技能导入 SkillDock 技能仓库？`, `Import these ${unmanagedSkillsToImport.length} skills into the SkillDock library?`)}
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-2">
              {unmanagedSkillsToImport.map((skill) => (
                <div key={`${skill.foundIn.join(',')}:${skill.relativePath}`} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-xs font-semibold text-slate-800">{skill.name}</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">{skill.path}</div>
                  {skill.directory !== skill.sourceDirectory && (
                    <div className="text-[10px] text-indigo-600 mt-1">
                      {t(`在 SkillDock 中保存为：${skill.directory}`, `Save in SkillDock as: ${skill.directory}`)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnmanagedSkillsToImport(null)}
                disabled={importUnmanagedMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('暂不导入', 'Not now')}
              </button>
              <button
                type="button"
                onClick={handleImportUnmanagedSkills}
                disabled={importUnmanagedMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {importUnmanagedMutation.isPending ? t('导入中...', 'Importing...') : t('导入全部', 'Import all')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
