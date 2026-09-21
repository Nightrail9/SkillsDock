import React, { useState, useEffect } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { 
  X, 
  Radar, 
  Check, 
  ArrowRight, 
  CheckCircle2,
  HardDrive,
  Cpu,
  Sparkles,
  FolderOpen,
  AlertCircle,
  Loader2,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { settingsApi } from '../lib/api';
import { ToolAdapter, AppSettings, AddToastFn, DistributionMethod } from '../types';
import { ToolBrandIcon } from './icons/BrandIcons';
import { useScanUnmanagedSkills, useImportSkillsFromApps } from '../hooks/useSkills';
import { useAppState } from '../hooks/useAppState';
import { collapseHomePath } from '../lib/utils/pathDisplay';
import { errorToString } from '../lib/errors/skillErrorParser';

interface OnboardingModalProps {
  isOpen: boolean;
  tools: ToolAdapter[];
  settings?: AppSettings;
  addToast: AddToastFn;
  onSaveSettings?: (newSettings: AppSettings) => Promise<boolean>;
  onClose: () => void;
  isMandatory?: boolean;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  tools,
  settings,
  addToast,
  onSaveSettings,
  onClose,
  isMandatory = false,
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [migrationDone, setMigrationDone] = useState(false);

  // Skill repository settings state inside onboarding
  // 引导内只提供 symlink / copy 两档；设置为 auto 时默认落在 symlink
  const [customPath, setCustomPath] = useState(settings?.libraryPath || '');
  const [deployMethod, setDeployMethod] = useState<DistributionMethod>(
    settings?.distributionMethod === 'copy' ? 'copy' : 'symlink'
  );

  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [isElevating, setIsElevating] = useState(false);

  const handleSelectDeployMethod = (method: DistributionMethod) => {
    if (method === 'symlink') {
      if (!settings?.developerModeEnabled) {
        setShowAdminConfirm(true);
        return;
      }
    }
    setDeployMethod(method);
  };

  const handleRestartAsAdmin = async () => {
    setIsElevating(true);
    try {
      if (settings && onSaveSettings) {
        await onSaveSettings({ ...settings, distributionMethod: 'symlink' });
      }
      await settingsApi.restartAsAdmin();
    } catch (err) {
      setIsElevating(false);
      addToast('error', '管理员提权未完成', errorToString(err));
    }
  };

  const handleOpenDeveloperSettings = async () => {
    try {
      await openUrl('ms-settings:developers');
    } catch (err) {
      addToast('error', '无法打开系统设置', errorToString(err));
    }
  };

  // 第 4 步真实扫描未受管技能
  const scanQuery = useScanUnmanagedSkills({ enabled: isOpen && currentStep === 4 });
  const importMutation = useImportSkillsFromApps();

  useEffect(() => {
    if (settings) {
      setCustomPath(settings.libraryPath);
      setDeployMethod(settings.distributionMethod === 'copy' ? 'copy' : 'symlink');
    }
  }, [settings]);

  // 向导每次重新打开时，重置步骤与内部表单/迁移状态到初始值
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(1);
      setMigrationDone(false);
      setCustomPath(settings?.libraryPath || '');
      setDeployMethod(settings?.distributionMethod === 'copy' ? 'copy' : 'symlink');
      importMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isMandatory && e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isMandatory]);

  const homeDir = useAppState().data?.homeDir;

  if (!isOpen) return null;

  const enabledTools = tools.filter((t) => t.isEnabled);
  const unmanaged = scanQuery.data ?? [];

  /** Tauri 原生目录选择 */
  const handleBrowseFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: '选择技能仓库目录',
      });
      if (typeof selected === 'string') setCustomPath(selected);
    } catch (err) {
      addToast('error', '无法打开目录选择器', errorToString(err));
    }
  };

  const handleSaveRepoSettings = () => {
    if (settings && onSaveSettings) {
      void onSaveSettings({
        ...settings,
        libraryPath: customPath.trim() || settings.libraryPath,
        distributionMethod: deployMethod,
      });
    }
  };

  /** 将扫描到的未受管技能全部导入技能仓库 */
  const handleImportAll = () => {
    if (unmanaged.length === 0) return;
    importMutation.mutate(
      unmanaged.map((u) => ({
        directory: u.directory,
        toolIds: enabledTools.map((t) => t.id),
      })),
      {
        onSuccess: (imported) => {
          setMigrationDone(true);
          addToast(
            'success',
            '存量技能迁移成功',
            `已将 ${imported.length} 个未受管技能无缝纳入技能仓库！`,
          );
        },
        onError: (err) => addToast('error', '存量技能迁移失败', errorToString(err)),
      },
    );
  };

  const totalSteps = 4;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Top Header */}
        <div className="px-6 py-5 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
              首次配置向导 ({currentStep} / {totalSteps})
            </span>
            {isMandatory && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200/60">
                初次使用请完成配置
              </span>
            )}
          </div>
          {!isMandatory && (
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
              title="关闭 (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Step Content */}
        <div className="p-6 text-xs space-y-4 min-h-[340px] flex flex-col justify-between">
          {/* STEP 1: 欢迎与架构说明 */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-xs border border-indigo-100">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="text-center space-y-1.5">
                <h3 className="text-base font-bold text-slate-900">
                  欢迎使用 SkillsDock
                </h3>
                <p className="text-slate-500 leading-relaxed max-w-md mx-auto">
                  告别技能在多个 AI 编程工具间的重复复制与版本脱节。本客户端以技能仓库为单一事实源，实现一处更新、全工具即时同步。
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 text-slate-600">
                <div className="flex items-center gap-2 font-bold text-slate-800">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>核心心智模型</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  所有安装或导入的技能集中存放于您指定的本地技能仓库目录中，通过透明符号链接映射至各个终端 AI 编程工具，免去冗余复制。
                </p>
              </div>
            </div>
          )}

          {/* STEP 2: 配置技能仓库物理路径与同步方式 */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="text-center space-y-1">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2 border border-indigo-100">
                  <HardDrive className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  配置技能仓库物理路径
                </h3>
                <p className="text-slate-500 text-xs max-w-md mx-auto">
                  设置技能包的统一本地存储目录及与目标 AI 工具的分发方式，后续可随时在设置中修改。
                </p>
              </div>

              <div className="space-y-3.5">
                {/* 仓库路径输入与文件夹选择 */}
                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    技能仓库物理存储路径:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={collapseHomePath(customPath, homeDir)}
                      onChange={(e) => setCustomPath(e.target.value)}
                      className="flex-1 p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="例如: ~/.skilldock/skills"
                    />
                    <button
                      type="button"
                      onClick={handleBrowseFolder}
                      className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs flex items-center gap-1.5 transition-colors shrink-0 border border-slate-200 shadow-2xs"
                      title="选择本地文件夹"
                    >
                      <FolderOpen className="w-4 h-4 text-indigo-600" />
                      <span>选择文件夹</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    系统将自动创建该目录，所有从开源社区或 Git 导入的技能均纳管于此。
                  </p>
                </div>

                {/* 分发同步模式选择 */}
                <div>
                  <label className="block font-bold text-slate-800 mb-1.5">
                    跨工具分发方式:
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleSelectDeployMethod('copy')}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        deployMethod === 'copy'
                          ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-xs text-slate-900">
                        <span>文件复制 (推荐)</span>
                        {deployMethod === 'copy' && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        直接拷贝完整技能文件，稳定可靠，免管理员权限。
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectDeployMethod('symlink')}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        deployMethod === 'symlink'
                          ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-xs text-slate-900">
                        <span>符号链接 (需管理员或开发者模式)</span>
                        {deployMethod === 'symlink' && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        零磁盘冗余，统一映射。需开发者模式或管理员权限。
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: 检测识别已安装的 AI 工具 */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="text-center space-y-1">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-2 border border-indigo-100">
                  <Cpu className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  已自动识别的 AI 目标工具
                </h3>
                <p className="text-slate-500 text-xs">
                  系统已探测到下列工具的技能目录，可一键建立跨工具联动分发：
                </p>
              </div>

              <div className="space-y-2">
                {tools.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    未检测到任何 AI 工具，可稍后在「AI 工具」页添加自定义适配器
                  </div>
                ) : (
                  tools.map((tool) => (
                    <div
                      key={tool.id}
                      className="p-3 rounded-2xl border border-slate-200 bg-slate-50/70 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <ToolBrandIcon toolId={tool.id} size={22} />
                        <div>
                          <div className="font-bold text-slate-800 text-xs">{tool.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{tool.currentPath}</div>
                        </div>
                      </div>
                      {tool.detected ? (
                        <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200/60">
                          已就绪
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full font-bold border border-slate-200/80">
                          未检测到目录
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* STEP 4: 扫描与迁移存量技能 */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="text-center space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  扫描与迁移存量孤立技能
                </h3>
                <p className="text-slate-500 text-xs">
                  自动探测各个工具现存未受管的技能包，统一迁移至新配置的技能仓库中。
                </p>
              </div>

              <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                {migrationDone ? (
                  <div className="space-y-2 text-center text-emerald-700">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-600" />
                    <div className="font-bold text-slate-900 text-xs">
                      已成功发现并迁移 {importMutation.data?.length ?? 0} 个存量技能至技能仓库！
                    </div>
                    <p className="text-[11px] text-slate-500">
                      已自动建立分发链接，可在「已安装技能」页统一管理。
                    </p>
                  </div>
                ) : scanQuery.isLoading || importMutation.isPending ? (
                  <div className="py-6 flex flex-col items-center justify-center space-y-4">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute w-16 h-16 rounded-full bg-indigo-500/20 animate-ping" />
                      <div className="absolute w-12 h-12 rounded-full bg-indigo-500/30 animate-pulse" />
                      <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white flex items-center justify-center shadow-md shadow-indigo-500/25 border border-indigo-400/30">
                        <Radar className="w-6 h-6 animate-spin [animation-duration:3s] text-white" />
                      </div>
                    </div>
                    <div className="text-center space-y-1">
                      <div className="text-slate-800 text-xs font-bold">
                        {importMutation.isPending
                          ? '正在迁移技能至技能仓库...'
                          : '正在智能探测已安装 AI 工具中的存量技能...'}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {importMutation.isPending
                          ? '正在建立统一事实源并分发'
                          : '自动扫描各个工具技能目录，稍候片刻'}
                      </div>
                    </div>
                    <div className="w-44 h-1 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-600 rounded-full animate-pulse w-full" />
                    </div>
                  </div>
                ) : scanQuery.isError ? (
                  <div className="space-y-2.5">
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 flex items-start gap-2 whitespace-pre-wrap">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>{errorToString(scanQuery.error)}</span>
                    </div>
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => scanQuery.refetch()}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs transition-colors"
                      >
                        重新扫描
                      </button>
                    </div>
                  </div>
                ) : unmanaged.length === 0 ? (
                  <div className="text-center space-y-2 text-slate-500">
                    <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
                    <div className="text-xs font-medium">
                      未发现未受管的存量技能，各工具目录已是干净状态。
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-xs font-bold text-slate-700">
                      发现 {unmanaged.length} 个未受管技能：
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1.5">
                      {unmanaged.map((u) => (
                        <div
                          key={u.path}
                          className="p-2.5 bg-white rounded-xl border border-slate-200/80 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 text-xs truncate">{u.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono truncate">{u.path}</div>
                          </div>
                          <span className="text-[10px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full font-semibold border border-indigo-200/60 shrink-0">
                            {u.foundIn.length} 处
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="text-center pt-1">
                      <button
                        type="button"
                        onClick={handleImportAll}
                        className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-xs hover:bg-indigo-700 transition-colors shadow-xs"
                      >
                        一键迁移并纳入技能仓库管理
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Stepper Buttons */}
          <div className="pt-4 border-t border-slate-200/80 flex items-center justify-between">
            {currentStep > 1 ? (
              <button
                onClick={() => setCurrentStep((prev) => prev - 1)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
              >
                上一步
              </button>
            ) : isMandatory ? (
              <span className="text-xs text-slate-400 font-medium px-2 py-1">
                步骤 1 / {totalSteps}
              </span>
            ) : (
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 font-medium px-2 py-1"
              >
                跳过向导
              </button>
            )}

            {currentStep < totalSteps ? (
              <button
                onClick={() => {
                  if (currentStep === 2) {
                    handleSaveRepoSettings();
                  }
                  setCurrentStep((prev) => prev + 1);
                }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-xs"
              >
                <span>下一步</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => {
                  handleSaveRepoSettings();
                  onClose();
                }}
                disabled={importMutation.isPending || scanQuery.isLoading}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold shadow-xs transition-colors flex items-center gap-1.5"
              >
                {importMutation.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>技能导入中...</span>
                  </>
                ) : (
                  <span>完成并开启管理</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 符号链接管理员提权提示弹窗（居中浮于最顶层） */}
      {showAdminConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">切换符号链接需要管理员权限</h3>
                <p className="text-xs text-slate-500 mt-0.5">Windows 符号链接需要提权或开启开发者模式</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                在 Windows 系统中，普通非管理员程序无法创建符号链接。若要使用此模式，您可以：
              </p>
              <ol className="list-decimal pl-4 space-y-1.5 text-slate-500">
                <li><strong className="text-slate-700">以管理员身份重启软件：</strong>将弹出系统 UAC 提权确认，后续使用过程中均拥有创建符号链接权限。</li>
                <li><strong className="text-slate-700">开启开发者模式：</strong>在系统设置中启用后，任何程序无需管理员权限即可创建符号链接。</li>
              </ol>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                disabled={isElevating}
                onClick={handleRestartAsAdmin}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60 rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                {isElevating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                <span>{isElevating ? '正在请求提权...' : '以管理员身份重启并切换'}</span>
              </button>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleOpenDeveloperSettings}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                >
                  前往开启开发者模式
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdminConfirm(false)}
                  className="py-2 px-4 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  取消（保持文件复制）
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
