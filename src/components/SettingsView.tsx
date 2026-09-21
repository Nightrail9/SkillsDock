import React, { useState, useEffect } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { 
  Sliders,
  Bot,
  FolderGit2,
  Brain,
  Info,
  Globe,
  Sun,
  Moon,
  Monitor,
  Layers, 
  ShieldCheck, 
  Check, 
  HelpCircle, 
  HardDrive, 
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FolderOpen,
  KeyRound,
  PlugZap,
  Eye,
  EyeOff
} from 'lucide-react';
import { AppSettings, ToolAdapter, AddToastFn, LlmConfigInput, ProjectScope, Skill } from '../types';
import { useMigrateLibrary } from '../hooks/useSettings';
import { useAppState, useInvalidateAppState } from '../hooks/useAppState';
import { settingsApi } from '../lib/api';
import { collapseHomePath } from '../lib/utils/pathDisplay';
import { errorToString } from '../lib/errors/skillErrorParser';
import { readLlmApiKey, writeLlmApiKey } from '../lib/llmKey';
import { applyTheme } from '../hooks/useTheme';
import { ToolAdaptersView } from './ToolAdaptersView';
import { ProjectsView } from './ProjectsView';

export type SettingsSubTab = 'general' | 'tools' | 'projects' | 'model' | 'about';

interface SettingsViewProps {
  settings: AppSettings;
  tools: ToolAdapter[];
  projects: ProjectScope[];
  skills: Skill[];
  addToast: AddToastFn;
  onSaveSettings: (newSettings: AppSettings) => Promise<boolean>;
  onOpenOnboarding: () => void;
  onFilterByProject: (projectId: string) => void;
  activeSubTab?: SettingsSubTab;
  onSelectSubTab?: (tab: SettingsSubTab) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  tools,
  projects,
  skills,
  addToast,
  onSaveSettings,
  onOpenOnboarding,
  onFilterByProject,
  activeSubTab: externalSubTab,
  onSelectSubTab,
}) => {
  const [internalSubTab, setInternalSubTab] = useState<SettingsSubTab>('general');
  const currentSubTab = externalSubTab ?? internalSubTab;

  const handleSelectTab = (tab: SettingsSubTab) => {
    setInternalSubTab(tab);
    onSelectSubTab?.(tab);
  };

  const [formData, setFormData] = useState<AppSettings>({ ...settings });
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState(false);
  const [llmForm, setLlmForm] = useState<{
    providerName: string;
    baseUrl: string;
    model: string;
    language: 'zh' | 'en';
  }>({
    providerName: '',
    baseUrl: '',
    model: '',
    language: 'zh',
  });
  const [testPassed, setTestPassed] = useState(false);
  const [apiKey, setApiKey] = useState(() => readLlmApiKey());
  const [showKey, setShowKey] = useState(false);
  const [llmBusy, setLlmBusy] = useState<'save' | 'test' | 'clear' | null>(null);
  const [llmMessage, setLlmMessage] = useState<string | null>(null);
  const migrateMutation = useMigrateLibrary();
  const appState = useAppState().data;
  const invalidateAppState = useInvalidateAppState();
  const homeDir = appState?.homeDir;
  const llmConfig = appState?.llmConfig;

  useEffect(() => {
    setFormData((prev) => ({ ...prev, ...settings }));
  }, [settings]);

  useEffect(() => {
    if (!llmConfig) return;
    setLlmForm({
      providerName: llmConfig.providerName,
      baseUrl: llmConfig.baseUrl,
      model: llmConfig.model,
      language: (llmConfig.language as 'zh' | 'en') || 'zh',
    });
    setTestPassed(false);
  }, [llmConfig]);

  const updateLlmForm = (next: {
    providerName: string;
    baseUrl: string;
    model: string;
    language: 'zh' | 'en';
  }) => {
    setLlmForm(next);
    setTestPassed(false);
  };

  const llmInput = (): LlmConfigInput => ({
    ...llmForm,
    apiKey: apiKey.trim() || undefined,
  });

  const updateApiKey = (value: string) => {
    setApiKey(value);
    writeLlmApiKey(value);
    setTestPassed(false);
  };

  const saveLlm = async () => {
    if (!testPassed) return;
    setLlmBusy('save');
    setLlmMessage(null);
    try {
      await settingsApi.saveLlmConfig(llmInput());
      setLlmMessage('模型配置已保存。');
      await invalidateAppState();
    } catch (err) {
      setLlmMessage(errorToString(err));
    } finally {
      setLlmBusy(null);
    }
  };

  const testLlm = async () => {
    setLlmBusy('test');
    setLlmMessage(null);
    try {
      const result = await settingsApi.testLlmConnection(llmInput());
      setLlmMessage(`${result.message}：${result.model}`);
      setTestPassed(true);
    } catch (err) {
      setLlmMessage(`连接失败：${errorToString(err)}`);
      setTestPassed(false);
    } finally {
      setLlmBusy(null);
    }
  };

  /** 保存并即时生效 */
  const save = (next: AppSettings) => {
    setFormData(next);
    if (next.theme !== formData.theme) {
      applyTheme(next.theme);
    }
    void onSaveSettings(next);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onSaveSettings(formData);
    if (ok) {
      setSavedStatus(true);
      setTimeout(() => setSavedStatus(false), 3000);
    }
  };

  /** 中央库路径迁移 */
  const handleMigrateLibrary = async () => {
    let target: string | null = null;
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: '选择新的技能仓库目录',
      });
      if (typeof selected === 'string') target = selected;
    } catch (err) {
      addToast('error', '无法打开目录选择器', errorToString(err));
      return;
    }
    if (!target || target === settings.libraryPath) return;

    setMigrationError(null);
    migrateMutation.mutate(target, {
      onSuccess: (result) => {
        if (result.errors.length === 0) {
          setFormData((prev) => ({ ...prev, libraryPath: target }));
          addToast(
            'success',
            '技能仓库迁移完成',
            `已迁移 ${result.migratedCount} 个技能${
              result.skippedCount > 0
                ? `，跳过 ${result.skippedCount} 个（目标已存在同名目录：${result.skipped.join('、')}）`
                : ''
            }，新目录：${target}`,
          );
        } else {
          const skippedDetail =
            result.skippedCount > 0 ? `（${result.skipped.join('、')}）` : '';
          const detail = `成功 ${result.migratedCount} 项、跳过 ${result.skippedCount} 项${skippedDetail}、失败 ${result.errors.length} 项：\n${result.errors.join('\n')}`;
          setMigrationError(detail);
          addToast('warning', '技能仓库迁移部分失败', detail);
        }
      },
      onError: (err) => {
        const msg = errorToString(err);
        setMigrationError(msg);
        addToast('error', '技能仓库迁移失败', msg);
      },
    });
  };

  const isMigrating = migrateMutation.isPending;
  const activeToolsCount = tools.filter((t) => t.isEnabled && t.detected).length;

  const subNavItems: {
    id: SettingsSubTab;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'general',
      label: '常规',
      icon: <Sliders className="w-4 h-4" />,
    },
    {
      id: 'tools',
      label: 'AI 工具',
      icon: <Bot className="w-4 h-4" />,
    },
    {
      id: 'projects',
      label: '项目工程',
      icon: <FolderGit2 className="w-4 h-4" />,
    },
    {
      id: 'model',
      label: '模型服务',
      icon: <Brain className="w-4 h-4" />,
    },
    {
      id: 'about',
      label: '关于软件',
      icon: <Info className="w-4 h-4" />,
    },
  ];

  return (
    <div className="flex-1 flex overflow-hidden bg-[#FBFBFC]">
      {/* Left Sub Navigation Sidebar */}
      <aside className="w-60 bg-white border-r border-slate-200/80 flex flex-col p-3 select-none shrink-0">
        <div className="space-y-1">
          <div className="px-3 py-2 mb-1">
            <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              设置分类
            </h2>
          </div>
          {subNavItems.map((item) => {
            const isActive = currentSubTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors border focus:outline-none focus-visible:outline-none focus:ring-0 ${
                  isActive
                    ? 'bg-indigo-50/80 text-indigo-700 font-semibold border-indigo-200/70 shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 border-transparent'
                }`}
              >
                <span className={isActive ? 'text-indigo-600' : 'text-slate-400'}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right Content Panel */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#FBFBFC]">
        {/* View 1: 常规 (General) */}
        {currentSubTab === 'general' && (
          <div className="flex-1 overflow-y-auto p-8 space-y-6 max-w-4xl mx-auto w-full">
            {savedStatus && (
              <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200/90 rounded-2xl text-xs font-semibold text-emerald-800 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>设置已即时保存并全局生效</span>
                </div>
                <span className="text-[11px] text-emerald-600 font-mono">Auto-saved</span>
              </div>
            )}
            <form onSubmit={handleSave} className="space-y-6">
              {/* Section 1: 语言与外观 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-5">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">界面语言与外观</h2>
                </div>

                {/* 语言选择：明确显示为 Chinese 与 English */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700">界面语言</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div
                      onClick={() => save({ ...formData, locale: 'zh' })}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                        formData.locale === 'zh'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900 text-xs">Chinese</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">简体中文界面语言</div>
                      </div>
                      {formData.locale === 'zh' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>

                    <div
                      onClick={() => save({ ...formData, locale: 'en' })}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center justify-between ${
                        formData.locale === 'en'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-slate-900 text-xs">English</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">English interface language</div>
                      </div>
                      {formData.locale === 'en' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>
                  </div>
                </div>

                {/* 主题选择：Light / Dark / System */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label className="text-xs font-semibold text-slate-700">外观主题</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div
                      onClick={() => save({ ...formData, theme: 'light' })}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center gap-3 ${
                        formData.theme === 'light'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                        <Sun className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900 text-xs">Light</div>
                        <div className="text-[11px] text-slate-500">亮色模式</div>
                      </div>
                      {formData.theme === 'light' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>

                    <div
                      onClick={() => save({ ...formData, theme: 'dark' })}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center gap-3 ${
                        formData.theme === 'dark'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-slate-800 text-indigo-300 flex items-center justify-center shrink-0">
                        <Moon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900 text-xs">Dark</div>
                        <div className="text-[11px] text-slate-500">暗色模式</div>
                      </div>
                      {formData.theme === 'dark' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>

                    <div
                      onClick={() => save({ ...formData, theme: 'system' })}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-center gap-3 ${
                        formData.theme === 'system'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                        <Monitor className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900 text-xs">System</div>
                        <div className="text-[11px] text-slate-500">跟随系统</div>
                      </div>
                      {formData.theme === 'system' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: 分发机制 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">技能分发同步方式</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div
                    onClick={() => save({ ...formData, distributionMethod: 'symlink' })}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      formData.distributionMethod === 'symlink'
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-slate-900 text-xs">符号链接 (Symlink)</span>
                      {formData.distributionMethod === 'symlink' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      技能仓库作为单一事实源，目标工具目录内建立透明符号链接。更新一次处处生效，零额外存储开销。
                    </p>
                  </div>

                  <div
                    onClick={() => save({ ...formData, distributionMethod: 'copy' })}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      formData.distributionMethod === 'copy'
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-slate-900 text-xs">文件复制 (Copy)</span>
                      {formData.distributionMethod === 'copy' && (
                        <span className="w-2 h-2 rounded-full bg-indigo-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      将文件完整拷贝至各工具配置目录。适用于 Windows 系统无法开启开发者模式或权限受限环境。
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-start gap-3 text-xs text-slate-600 leading-relaxed">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800">Windows 权限提示：</span>
                    在「Windows 设置 → 隐私和安全 → 针对开发人员」中开启<strong>「开发者模式」</strong>后，普通非管理员权限即可秒级创建符号链接。
                  </div>
                </div>
              </div>

              {/* Section 3: 技能仓库本地存储目录 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">技能仓库物理存储路径</h2>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  所有安装与导入的技能文件集中存放在此目录下。支持修改路径并将现有技能自动迁移至新目录。
                </p>

                <div className="flex items-center gap-2.5">
                  <code className="flex-1 p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-slate-800 truncate">
                    {collapseHomePath(formData.libraryPath, homeDir)}
                  </code>
                  <button
                    type="button"
                    onClick={handleMigrateLibrary}
                    disabled={isMigrating}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold rounded-xl text-xs transition-colors shadow-xs shrink-0 flex items-center gap-1.5"
                  >
                    {isMigrating ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>正在迁移...</span>
                      </>
                    ) : (
                      <>
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>选择新路径并迁移</span>
                      </>
                    )}
                  </button>
                </div>

                {migrationError && (
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-2 whitespace-pre-wrap">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{migrationError}</span>
                  </div>
                )}

                {migrateMutation.isSuccess && migrateMutation.data.errors.length === 0 && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>
                      技能仓库文件及链接映射已成功迁移至新目录（迁移 {migrateMutation.data.migratedCount} 项
                      {migrateMutation.data.skippedCount > 0 ? `，跳过 ${migrateMutation.data.skippedCount} 项` : ''}）！
                    </span>
                  </div>
                )}
              </div>

              {/* Section 4: 更新检测与卸载确认 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">版本更新检测与卸载</h2>
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <div className="text-xs font-bold text-slate-800">自动检测技能更新</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      打开应用时，若距上次检测已超过设定间隔，则在后台静默比对远端 Git 提交。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => save({ ...formData, autoCheckUpdate: !formData.autoCheckUpdate })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      formData.autoCheckUpdate ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                    role="switch"
                    aria-checked={formData.autoCheckUpdate}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ${
                        formData.autoCheckUpdate ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {formData.autoCheckUpdate && (
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <div className="text-xs font-bold text-slate-800">检测间隔（天）</div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        打开应用时，若距上次检测已超过该间隔才自动检查更新。建议不小于 1 天。
                      </p>
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={formData.checkIntervalDays}
                      onChange={(e) => {
                        const days = Math.max(1, Math.min(30, Number(e.target.value) || 1));
                        save({ ...formData, checkIntervalDays: days });
                      }}
                      className="w-24 p-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-center focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between py-1">
                  <div>
                    <div className="text-xs font-bold text-slate-800">卸载前需要二次确认</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      卸载即彻底删除且无备份，建议保持开启以防误操作。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => save({ ...formData, confirmOnUninstall: !formData.confirmOnUninstall })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      formData.confirmOnUninstall ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                    role="switch"
                    aria-checked={formData.confirmOnUninstall}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ${
                        formData.confirmOnUninstall ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Action button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
                >
                  保存全部设置
                </button>
              </div>
            </form>
          </div>
        )}

        {/* View 2: AI 工具 (Tools Adapters) */}
        {currentSubTab === 'tools' && (
          <ToolAdaptersView tools={tools} addToast={addToast} />
        )}

        {/* View 3: 项目工程 (Projects) */}
        {currentSubTab === 'projects' && (
          <ProjectsView
            projects={projects}
            skills={skills}
            addToast={addToast}
            onFilterByProject={onFilterByProject}
          />
        )}

        {/* View 4: 模型服务 (Model Services) */}
        {currentSubTab === 'model' && (
          <div className="flex-1 overflow-y-auto p-8 space-y-6 max-w-4xl mx-auto w-full">
            <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-900">LLM 技能描述处理配置</h2>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                使用 OpenAI Chat Completions 兼容接口，将已安装技能的英文描述翻译、中文描述压缩为约 30 字的精简简介。
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">提供商名称</span>
                  <input
                    value={llmForm.providerName}
                    onChange={(e) => updateLlmForm({ ...llmForm, providerName: e.target.value })}
                    placeholder="DeepSeek / OpenAI / 本地模型"
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">模型名称</span>
                  <input
                    value={llmForm.model}
                    onChange={(e) => updateLlmForm({ ...llmForm, model: e.target.value })}
                    placeholder="deepseek-chat"
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">API Base URL</span>
                <input
                  value={llmForm.baseUrl}
                  onChange={(e) => updateLlmForm({ ...llmForm, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />API Key
                </span>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => updateApiKey(e.target.value)}
                    placeholder="sk-..."
                    autoComplete="new-password"
                    className="w-full pr-10 p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                    title={showKey ? '隐藏 API Key' : '显示 API Key'}
                    aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </label>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">生成简介语言</span>
                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="radio"
                      name="llm_language"
                      value="zh"
                      checked={llmForm.language === 'zh'}
                      onChange={() => updateLlmForm({ ...llmForm, language: 'zh' })}
                      className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                    />
                    <span>中文简介（约 20 词左右）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="radio"
                      name="llm_language"
                      value="en"
                      checked={llmForm.language === 'en'}
                      onChange={() => updateLlmForm({ ...llmForm, language: 'en' })}
                      className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 cursor-pointer accent-indigo-600"
                    />
                    <span>英文简介（约 20 词左右）</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={saveLlm}
                  disabled={llmBusy !== null || !testPassed}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all"
                  title={!testPassed ? '请先点击“测试连接”并测试成功后再保存' : '保存模型配置'}
                >
                  {llmBusy === 'save' ? '保存中...' : '保存模型配置'}
                </button>
                <button
                  type="button"
                  onClick={testLlm}
                  disabled={llmBusy !== null}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 transition-all"
                >
                  <PlugZap className="w-3.5 h-3.5" />
                  {llmBusy === 'test' ? '测试中...' : '测试连接'}
                </button>
              </div>

              {llmMessage && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 whitespace-pre-wrap">
                  {llmMessage}
                </div>
              )}
            </div>
          </div>
        )}

        {/* View 5: 关于软件 (About) */}
        {currentSubTab === 'about' && (
          <div className="flex-1 overflow-y-auto p-8 space-y-6 max-w-4xl mx-auto w-full">
            <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">技能坞 (SkillsDock)</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    纯本地极速 AI 编程技能聚合与多工具分发中心 · 版本 v1.2
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                  <span>重新打开配置向导</span>
                </button>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs text-slate-600 space-y-2 leading-relaxed">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>纯本地数据主权保障：</span>
                </div>
                <p>
                  本应用无任何云端服务器中转，无用户隐私数据上传，零遥测打点。所有配置文件、本地技能仓库、项目工程映射与工具符号链接仅保存在您的个人电脑中。
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
                  <div className="text-slate-400 text-[11px]">运行架构</div>
                  <div className="font-bold text-slate-800 mt-1">Tauri 2 + React 19</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
                  <div className="text-slate-400 text-[11px]">持久化存储</div>
                  <div className="font-bold text-slate-800 mt-1">SQLite 嵌入式数据库</div>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
                  <div className="text-slate-400 text-[11px]">分发方式</div>
                  <div className="font-bold text-slate-800 mt-1">NTFS 符号链接 / 物理拷贝</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
