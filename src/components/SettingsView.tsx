import React, { useState, useEffect, useRef } from 'react';
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
  AlertCircle,
  RefreshCw,
  RotateCcw,
  FolderOpen,
  KeyRound,
  PlugZap,
  Eye,
  EyeOff,
  Github,
  ExternalLink,
  Bug,
  Tag,
  User,
  FileText
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { SkillDockLogo } from './icons/BrandIcons';
import { AppLocale, AppSettings, ToolAdapter, AddToastFn, LlmConfigInput, ProjectScope, Skill } from '../types';
import { useMigrateLibrary } from '../hooks/useSettings';
import { useAppState, useInvalidateAppState } from '../hooks/useAppState';
import { settingsApi } from '../lib/api';
import { isTauriEnvironment } from '../lib/api/mockData';
import { collapseHomePath } from '../lib/utils/pathDisplay';
import { isWindowsPlatform } from '../lib/utils/platform';
import { getAppUpdateCheckFeedback } from '../lib/utils/appUpdateFeedback';
import { errorToString } from '../lib/errors/skillErrorParser';
import { readLlmApiKey, writeLlmApiKey } from '../lib/llmKey';
import { applyTheme } from '../hooks/useTheme';
import { applyLocale } from '../hooks/useLocale';
import { ToolAdaptersView } from './ToolAdaptersView';
import { ProjectsView } from './ProjectsView';

/** 纯浏览器预览模式下的版本兜底值（Tauri 内一律以 getVersion() 为准） */
const FALLBACK_APP_VERSION = '0.5.3';

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
  const confirmedSettingsRef = useRef<AppSettings>({ ...settings });
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveVersionRef = useRef(0);
  const t = (zh: string, en: string) => (formData.locale === 'en' ? en : zh);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAdminConfirm, setShowAdminConfirm] = useState(false);
  const [isElevating, setIsElevating] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('');
  const [isPortableInstall, setIsPortableInstall] = useState<boolean | null>(
    () => !isTauriEnvironment() ? false : null,
  );
  const [availableAppUpdate, setAvailableAppUpdate] = useState<Update | null>(null);
  const [appUpdateFeedback, setAppUpdateFeedback] = useState<string | null>(null);
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState(false);
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false);
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
    confirmedSettingsRef.current = settings;
    setFormData((prev) => ({ ...prev, ...settings }));
  }, [settings]);

  // 关于页版本号：Tauri 内从包信息读取（单一事实源），浏览器预览用兜底常量
  useEffect(() => {
    let disposed = false;
    if (!isTauriEnvironment()) {
      setAppVersion(FALLBACK_APP_VERSION);
      return;
    }
    getVersion()
      .then((v) => !disposed && setAppVersion(v))
      .catch(() => !disposed && setAppVersion(FALLBACK_APP_VERSION));
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let disposed = false;
    invoke<boolean>('is_portable_install')
      .then((isPortable) => !disposed && setIsPortableInstall(isPortable))
      .catch((error) => {
        console.warn('Failed to detect portable app installation:', error);
        if (!disposed) setIsPortableInstall(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => () => {
    if (availableAppUpdate) {
      void availableAppUpdate.close().catch((error) => {
        console.warn('Failed to release app updater resources:', error);
      });
    }
  }, [availableAppUpdate]);

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
      setLlmMessage(t('模型配置已保存。', 'Model settings saved.'));
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
      setLlmMessage(`${t('连接失败', 'Connection failed')}: ${errorToString(err)}`);
      setTestPassed(false);
    } finally {
      setLlmBusy(null);
    }
  };

  /** 保存并即时生效 */
  const save = (next: AppSettings) => {
    const version = ++settingsSaveVersionRef.current;
    setFormData(next);
    if (next.theme !== formData.theme) {
      applyTheme(next.theme);
    }
    if (next.locale !== formData.locale) {
      applyLocale(next.locale);
    }
    settingsSaveQueueRef.current = settingsSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const ok = await onSaveSettings(next);
        if (ok) {
          confirmedSettingsRef.current = next;
        }
        if (version !== settingsSaveVersionRef.current || ok) return;

        const confirmed = confirmedSettingsRef.current;
        setFormData(confirmed);
        applyTheme(confirmed.theme);
        applyLocale(confirmed.locale);
      });
  };

  const resetToDefaults = () => {
    setShowResetConfirm(true);
  };

  const handleConfirmReset = () => {
    setShowResetConfirm(false);
    save({
      ...formData,
      distributionMethod: 'copy',
      autoCheckUpdate: true,
      checkIntervalDays: 1,
      theme: 'light',
      locale: 'zh',
      confirmOnUninstall: true,
      closeToTray: true,
    });
  };

  const handleCheckAppUpdate = async () => {
    if (!isTauriEnvironment()) {
      addToast('info', t('应用更新仅在桌面版中可用', 'App updates are available in the desktop app'));
      return;
    }

    setIsCheckingAppUpdate(true);
    setAvailableAppUpdate(null);
    setAppUpdateFeedback(null);
    try {
      const update = await check();
      const feedback = getAppUpdateCheckFeedback(update !== null, t);
      setAppUpdateFeedback(feedback);
      if (!update) {
        return;
      }
      setAvailableAppUpdate(update);
      addToast('info', t(`发现新版本 ${update.version}`, `Version ${update.version} is available`));
    } catch (error) {
      addToast('error', t('检查应用更新失败', 'Failed to check for app updates'), errorToString(error));
    } finally {
      setIsCheckingAppUpdate(false);
    }
  };

  const handleInstallAppUpdate = async () => {
    if (!availableAppUpdate) return;
    setIsInstallingAppUpdate(true);
    try {
      await availableAppUpdate.downloadAndInstall();
      await relaunch();
    } catch (error) {
      addToast('error', t('安装应用更新失败', 'Failed to install app update'), errorToString(error));
      setIsInstallingAppUpdate(false);
    }
  };

  const handleSelectDistributionMethod = (method: 'symlink' | 'copy') => {
    if (method === 'symlink') {
      if (!settings.developerModeEnabled) {
        if (!isWindowsPlatform()) {
          // macOS/Linux 原生支持创建符号链接；探测未通过说明当前挂载点/沙箱不支持，
          // 此时应回退复制并明确告知，而不是弹出 Windows 专属的 UAC/开发者模式引导。
          addToast(
            'info',
            t('当前环境不支持符号链接，已切换为文件复制', 'Symlinks unsupported here, switched to file copy'),
            t(
              '该文件系统不允许创建符号链接，技能将复制到各工具目录。',
              'This filesystem does not allow symlinks; skills will be copied to each tool directory.',
            ),
          );
          save({ ...formData, distributionMethod: 'copy' });
          return;
        }
        setShowAdminConfirm(true);
        return;
      }
    }
    save({ ...formData, distributionMethod: method });
  };

  const handleRestartAsAdmin = async () => {
    setIsElevating(true);
    try {
      await save({ ...formData, distributionMethod: 'symlink' });
      await settingsApi.restartAsAdmin();
    } catch (err) {
      setIsElevating(false);
      addToast('error', t('管理员提权未完成', 'Elevation canceled'), errorToString(err));
    }
  };

  const handleOpenDeveloperSettings = async () => {
    try {
      await openUrl('ms-settings:developers');
    } catch (err) {
      addToast('error', t('无法打开系统设置', 'Cannot open settings'), errorToString(err));
    }
  };

  /** 中央库路径迁移 */
  const handleMigrateLibrary = async () => {
    let target: string | null = null;
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t('选择新的技能仓库目录', 'Select a new skill library location'),
      });
      if (typeof selected === 'string') target = selected;
    } catch (err) {
      addToast('error', t('无法打开目录选择器', 'Unable to open the folder picker'), errorToString(err));
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
            t('技能仓库迁移完成', 'Skill library migrated'),
            t(
              `已迁移 ${result.migratedCount} 个技能${result.skippedCount > 0 ? `，跳过 ${result.skippedCount} 个（目标已存在同名目录：${result.skipped.join('、')}）` : ''}，新目录：${target}`,
              `Moved ${result.migratedCount} skills${result.skippedCount > 0 ? `; skipped ${result.skippedCount} because the destination already contains: ${result.skipped.join(', ')}` : ''}. New location: ${target}`,
            ),
          );
        } else {
          const skippedDetail = result.skippedCount > 0
            ? t(`（${result.skipped.join('、')}）`, ` (${result.skipped.join(', ')})`)
            : '';
          const detail = t(
            `成功 ${result.migratedCount} 项、跳过 ${result.skippedCount} 项${skippedDetail}、失败 ${result.errors.length} 项：\n${result.errors.join('\n')}`,
            `Moved ${result.migratedCount}, skipped ${result.skippedCount}${skippedDetail}, failed ${result.errors.length}:\n${result.errors.join('\n')}`,
          );
          setMigrationError(detail);
          addToast('warning', t('技能仓库迁移部分失败', 'Skill library migration partially failed'), detail);
        }
      },
      onError: (err) => {
        const msg = errorToString(err);
        setMigrationError(msg);
        addToast('error', t('技能仓库迁移失败', 'Skill library migration failed'), msg);
      },
    });
  };

  const isMigrating = migrateMutation.isPending;

  const subNavItems: {
    id: SettingsSubTab;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'general',
      label: t('常规', 'General'),
      icon: <Sliders className="w-4 h-4" />,
    },
    {
      id: 'tools',
      label: t('AI 工具', 'AI tools'),
      icon: <Bot className="w-4 h-4" />,
    },
    {
      id: 'projects',
      label: t('项目工程', 'Projects'),
      icon: <FolderGit2 className="w-4 h-4" />,
    },
    {
      id: 'model',
      label: t('模型服务', 'Model services'),
      icon: <Brain className="w-4 h-4" />,
    },
    {
      id: 'about',
      label: t('关于软件', 'About'),
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
              {t('设置分类', 'Settings')}
            </h2>
          </div>
          {subNavItems.map((item) => {
            const isActive = currentSubTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2.5 transition-colors border focus:outline-none focus-visible:outline-none focus:ring-0 ${
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
          <div className="flex-1 overflow-y-auto">
            <div className="p-8 space-y-6 max-w-4xl mx-auto w-full">
              {/* Section 1: 语言与外观 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-5">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">{t('界面语言与外观', 'Language & appearance')}</h2>
                </div>

                {/* 语言选择：明确显示为 Chinese 与 English */}
                <div className="space-y-2">
                  <label id="settings-locale-label" className="text-xs font-semibold text-slate-700">{t('界面语言', 'Interface language')}</label>
                  <div role="radiogroup" aria-labelledby="settings-locale-label" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="settings-locale"
                        value="zh"
                        checked={formData.locale === 'zh'}
                        onChange={() => save({ ...formData, locale: 'zh' })}
                        className="sr-only peer"
                      />
                      <div className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 ${
                        formData.locale === 'zh'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}>
                        <div>
                          <div className="font-bold text-slate-900 text-xs">Chinese</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{t('简体中文界面语言', 'Simplified Chinese interface')}</div>
                        </div>
                        {formData.locale === 'zh' && (
                          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </div>
                    </label>

                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="settings-locale"
                        value="en"
                        checked={formData.locale === 'en'}
                        onChange={() => save({ ...formData, locale: 'en' })}
                        className="sr-only peer"
                      />
                      <div className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 ${
                        formData.locale === 'en'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}>
                        <div>
                          <div className="font-bold text-slate-900 text-xs">English</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">English interface language</div>
                        </div>
                        {formData.locale === 'en' && (
                          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </div>
                    </label>
                  </div>
                </div>

                {/* 主题选择：Light / Dark / System */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label id="settings-theme-label" className="text-xs font-semibold text-slate-700">{t('外观主题', 'Appearance')}</label>
                  <div role="radiogroup" aria-labelledby="settings-theme-label" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="settings-theme"
                        value="light"
                        checked={formData.theme === 'light'}
                        onChange={() => save({ ...formData, theme: 'light' })}
                        className="sr-only peer"
                      />
                      <div className={`p-3.5 rounded-2xl border transition-all flex items-center gap-3 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 ${
                        formData.theme === 'light'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}>
                        <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                          <Sun className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 text-xs">Light</div>
                          <div className="text-[11px] text-slate-500">{t('亮色模式', 'Light mode')}</div>
                        </div>
                        {formData.theme === 'light' && (
                          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </div>
                    </label>

                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="settings-theme"
                        value="dark"
                        checked={formData.theme === 'dark'}
                        onChange={() => save({ ...formData, theme: 'dark' })}
                        className="sr-only peer"
                      />
                      <div className={`p-3.5 rounded-2xl border transition-all flex items-center gap-3 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 ${
                        formData.theme === 'dark'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}>
                        <div className="w-8 h-8 rounded-xl bg-slate-800 text-indigo-300 flex items-center justify-center shrink-0">
                          <Moon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 text-xs">Dark</div>
                          <div className="text-[11px] text-slate-500">{t('暗色模式', 'Dark mode')}</div>
                        </div>
                        {formData.theme === 'dark' && (
                          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </div>
                    </label>

                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="settings-theme"
                        value="system"
                        checked={formData.theme === 'system'}
                        onChange={() => save({ ...formData, theme: 'system' })}
                        className="sr-only peer"
                      />
                      <div className={`p-3.5 rounded-2xl border transition-all flex items-center gap-3 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 ${
                        formData.theme === 'system'
                          ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                      }`}>
                        <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                          <Monitor className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 text-xs">System</div>
                          <div className="text-[11px] text-slate-500">{t('跟随系统', 'Follow system')}</div>
                        </div>
                        {formData.theme === 'system' && (
                          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Section 2: 分发机制 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">{t('技能分发同步方式', 'Skill distribution')}</h2>
                </div>

                <div role="radiogroup" aria-label={t('技能分发同步方式', 'Skill distribution')} className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name="settings-distribution-method"
                      value="copy"
                      checked={formData.distributionMethod === 'copy'}
                      onChange={() => handleSelectDistributionMethod('copy')}
                      className="sr-only peer"
                    />
                    <div className={`p-4 rounded-2xl border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 ${
                      formData.distributionMethod === 'copy'
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-slate-900 text-xs">{t('文件复制 (Copy) - 推荐', 'Copy files - Recommended')}</span>
                        {formData.distributionMethod === 'copy' && (
                          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {t('将技能文件完整拷贝至各工具配置目录。稳定可靠，无需管理员权限或开启开发者模式。', 'Copies complete files to every tool directory. Stable and reliable without requiring administrator access.')}
                      </p>
                    </div>
                  </label>

                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name="settings-distribution-method"
                      value="symlink"
                      checked={formData.distributionMethod === 'symlink'}
                      onChange={() => handleSelectDistributionMethod('symlink')}
                      className="sr-only peer"
                    />
                    <div className={`p-4 rounded-2xl border transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 ${
                      formData.distributionMethod === 'symlink'
                        ? 'border-indigo-600 bg-indigo-50/40 ring-1 ring-indigo-600 shadow-2xs'
                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-slate-900 text-xs">{t('符号链接 (Symlink)', 'Symbolic link')}</span>
                        {formData.distributionMethod === 'symlink' && (
                          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-indigo-600" />
                        )}
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {isWindowsPlatform()
                          ? t('技能仓库作为单一事实源，建立透明符号链接。需以管理员身份运行或在系统中启用开发者模式。', 'The skill library remains the single source of truth. Requires running as Administrator or enabling Developer Mode.')
                          : t('技能仓库作为单一事实源，建立透明符号链接。macOS / Linux 原生支持，无需额外设置。', 'The skill library remains the single source of truth. Natively supported on macOS / Linux, no extra setup required.')}
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Section 3: 技能仓库本地存储目录 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">{t('技能仓库物理存储路径', 'Skill library location')}</h2>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {t('所有安装与导入的技能文件集中存放在此目录下。支持修改路径并将现有技能自动迁移至新目录。', 'Installed and imported skills are stored here. Changing the location migrates the existing library automatically.')}
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
                        <span>{t('正在迁移...', 'Migrating...')}</span>
                      </>
                    ) : (
                      <>
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>{t('选择新路径并迁移', 'Choose a new location')}</span>
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
                      {t(
                        `技能仓库文件及链接映射已成功迁移至新目录（迁移 ${migrateMutation.data.migratedCount} 项${migrateMutation.data.skippedCount > 0 ? `，跳过 ${migrateMutation.data.skippedCount} 项` : ''}）！`,
                        `Skill files and links moved successfully (${migrateMutation.data.migratedCount} moved${migrateMutation.data.skippedCount > 0 ? `, ${migrateMutation.data.skippedCount} skipped` : ''}).`,
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Section 4: 更新检测与卸载确认 */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 text-indigo-600" />
                  <h2 className="text-sm font-bold text-slate-900">{t('版本更新检测与卸载', 'Updates & uninstall')}</h2>
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 space-y-3">
                  <div>
                    <div className="text-xs font-bold text-slate-800">{t('SkillDock 应用更新', 'SkillDock app updates')}</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {isPortableInstall === true
                        ? t('绿色便携版请下载新 ZIP 手动替换。', 'For the portable ZIP, download and replace it manually.')
                        : t('适用于 Windows 安装版和 macOS 安装版。绿色便携版请下载新 ZIP 手动替换。', 'Available for the Windows installer and macOS app. For the portable ZIP, download and replace it manually.')}
                    </p>
                    {availableAppUpdate && (
                      <p className="text-[11px] text-indigo-700 mt-2">
                        {t(`当前版本 ${appVersion}，可更新至 ${availableAppUpdate.version}`, `Current ${appVersion}; version ${availableAppUpdate.version} is available`)}
                      </p>
                    )}
                    {appUpdateFeedback && (
                      <p role="status" className="text-[11px] text-emerald-700 mt-2">
                        {appUpdateFeedback}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCheckAppUpdate}
                      disabled={isPortableInstall !== false || isCheckingAppUpdate || isInstallingAppUpdate}
                      className="px-3.5 py-2 bg-white border border-indigo-200 hover:bg-indigo-100 disabled:opacity-60 text-indigo-700 font-semibold rounded-xl text-xs transition-colors"
                    >
                      {isCheckingAppUpdate ? t('正在检查…', 'Checking…') : t('检查应用更新', 'Check app updates')}
                    </button>
                    {availableAppUpdate && isPortableInstall === false && (
                      <button
                        type="button"
                        onClick={handleInstallAppUpdate}
                        disabled={isInstallingAppUpdate}
                        className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-xl text-xs transition-colors"
                      >
                        {isInstallingAppUpdate ? t('正在下载并安装…', 'Downloading and installing…') : t('安装并重启', 'Install and restart')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <div id="settings-close-to-tray-label" className="text-xs font-bold text-slate-800">{t('关闭时最小化到托盘', 'Minimize to tray when closing')}</div>
                    <p id="settings-close-to-tray-description" className="text-[11px] text-slate-500 mt-0.5">
                      {t('点击窗口关闭按钮时隐藏 SkillDock，应用继续在系统托盘运行。', 'The close button hides SkillDock while it keeps running in the system tray.')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => save({ ...formData, closeToTray: !formData.closeToTray })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      formData.closeToTray ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                    role="switch"
                    aria-checked={formData.closeToTray}
                    aria-labelledby="settings-close-to-tray-label"
                    aria-describedby="settings-close-to-tray-description"
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition duration-200 ${
                        formData.closeToTray ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <div id="settings-auto-update-label" className="text-xs font-bold text-slate-800">{t('自动检测技能更新', 'Check for updates automatically')}</div>
                    <p id="settings-auto-update-description" className="text-[11px] text-slate-500 mt-0.5">
                      {t('打开应用时，若距上次检测已超过设定间隔，则在后台静默比对远端 Git 提交。', 'When opening the app, compare remote Git commits in the background after the selected interval.')}
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
                    aria-labelledby="settings-auto-update-label"
                    aria-describedby="settings-auto-update-description"
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
                      <div className="text-xs font-bold text-slate-800">{t('检测间隔（天）', 'Check interval (days)')}</div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {t('打开应用时，若距上次检测已超过该间隔才自动检查更新。建议不小于 1 天。', 'Updates are checked only when this interval has elapsed. At least one day is recommended.')}
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

              </div>

              {/* Action button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetToDefaults}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
                >
                  {t('恢复默认设置', 'Restore defaults')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View 2: AI 工具 (Tools Adapters) */}
        {currentSubTab === 'tools' && (
          <ToolAdaptersView tools={tools} addToast={addToast} locale={formData.locale} />
        )}

        {/* View 3: 项目工程 (Projects) */}
        {currentSubTab === 'projects' && (
          <ProjectsView
            projects={projects}
            skills={skills}
            addToast={addToast}
            onFilterByProject={onFilterByProject}
            locale={formData.locale}
          />
        )}

        {/* View 4: 模型服务 (Model Services) */}
        {currentSubTab === 'model' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-8 space-y-6 max-w-4xl mx-auto w-full">
              <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-900">{t('LLM 技能描述处理配置', 'LLM skill description settings')}</h2>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {t(
                  '使用 OpenAI Chat Completions 兼容接口，将已安装技能的英文描述翻译、中文描述压缩为约 20 词左右的精简简介。',
                  'Use an OpenAI Chat Completions-compatible API to translate English skill descriptions and condense Chinese descriptions into concise summaries of about 20 words.',
                )}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">{t('提供商名称', 'Provider name')}</span>
                  <input
                    value={llmForm.providerName}
                    onChange={(e) => updateLlmForm({ ...llmForm, providerName: e.target.value })}
                    placeholder={t('DeepSeek / OpenAI / 本地模型', 'DeepSeek / OpenAI / local model')}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-700">{t('模型名称', 'Model name')}</span>
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
                    title={showKey ? t('隐藏 API Key', 'Hide API key') : t('显示 API Key', 'Show API key')}
                    aria-label={showKey ? t('隐藏 API Key', 'Hide API key') : t('显示 API Key', 'Show API key')}
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </label>

              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-slate-700">{t('生成简介语言', 'Description language')}</span>
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
                    <span>{t('中文简介', 'Chinese')}</span>
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
                    <span>{t('英文简介', 'English')}</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={saveLlm}
                  disabled={llmBusy !== null || !testPassed}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all"
                  title={!testPassed ? t('请先点击“测试连接”并测试成功后再保存', 'Test the connection successfully before saving') : t('保存模型配置', 'Save model settings')}
                >
                  {llmBusy === 'save' ? t('保存中...', 'Saving...') : t('保存模型配置', 'Save model settings')}
                </button>
                <button
                  type="button"
                  onClick={testLlm}
                  disabled={llmBusy !== null}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-bold inline-flex items-center gap-1.5 transition-all"
                >
                  <PlugZap className="w-3.5 h-3.5" />
                  {llmBusy === 'test' ? t('测试中...', 'Testing...') : t('测试连接', 'Test connection')}
                </button>
              </div>

              {llmMessage && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 whitespace-pre-wrap">
                  {llmMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        {/* View 5: 关于软件 (About - 开源规范布局) */}
        {currentSubTab === 'about' && (
          <div className="flex-1 overflow-y-auto">
            <div className="p-8 space-y-6 max-w-4xl mx-auto w-full">
              {/* 主软件标识卡片 */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-1 rounded-2xl bg-slate-50 border border-slate-200/70 shadow-2xs">
                    <SkillDockLogo size={48} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">SkillsDock</h2>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/70 font-mono">
                        {appVersion ? `v${appVersion}` : 'v—'}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70 font-mono">
                        Apache-2.0
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      {t('专为 AI 开发者打造的 Skills 集中管理与跨工具分发桌面客户端。', 'A desktop app for AI developers to manage Skills centrally and distribute them across tools.')}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs shrink-0"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                  <span>{t('配置向导', 'Setup guide')}</span>
                </button>
              </div>

              {/* 开源仓库与生态入口 */}
              <div className="space-y-3 pt-2">
                <div className="text-xs font-bold text-slate-800">{t('开源社区与仓库', 'Open source & repositories')}</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div
                    onClick={() => openUrl('https://github.com/Nightrail9/SkillsDock').catch(() => {})}
                    className="p-4 rounded-2xl border border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-all group shadow-2xs"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                        <Github className="w-4 h-4 text-slate-800" />
                        <span>{t('GitHub 仓库', 'GitHub repository')}</span>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                    </div>
                    <p className="text-[11px] text-slate-500 truncate font-mono">
                      Nightrail9/SkillsDock
                    </p>
                  </div>

                  <div
                    onClick={() => openUrl('https://github.com/Nightrail9/SkillsDock/issues').catch(() => {})}
                    className="p-4 rounded-2xl border border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-all group shadow-2xs"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                        <Bug className="w-4 h-4 text-indigo-600" />
                        <span>{t('问题与需求', 'Issues & feature requests')}</span>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {t('提交缺陷反馈与功能建议', 'Report bugs and suggest features')}
                    </p>
                  </div>

                  <div
                    onClick={() => openUrl('https://github.com/Nightrail9/SkillsDock/releases').catch(() => {})}
                    className="p-4 rounded-2xl border border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-50 cursor-pointer transition-all group shadow-2xs"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                        <Tag className="w-4 h-4 text-emerald-600" />
                        <span>{t('Releases 日志', 'Release notes')}</span>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                    </div>
                    <p className="text-[11px] text-slate-500 truncate">
                      {t('查看版本发布与变更记录', 'View releases and change history')}
                    </p>
                  </div>
                </div>
              </div>

              {/* 原作者与开源协议元数据 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <User className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-600 font-medium">{t('原作者 / 维护者', 'Author / maintainer')}</span>
                  </div>
                  <span
                    onClick={() => openUrl('https://github.com/Nightrail9').catch(() => {})}
                    className="text-xs font-bold text-slate-800 hover:text-indigo-600 cursor-pointer transition-colors font-mono flex items-center gap-1"
                  >
                    Nightrail9
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs">
                    <FileText className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-600 font-medium">{t('开源许可证', 'Open-source license')}</span>
                  </div>
                  <span
                    onClick={() => openUrl('https://github.com/Nightrail9/SkillsDock/blob/main/LICENSE').catch(() => {})}
                    className="text-xs font-bold text-slate-800 hover:text-indigo-600 cursor-pointer transition-colors font-mono flex items-center gap-1"
                  >
                    Apache License 2.0
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </span>
                </div>
              </div>

              {/* 本地数据保障说明 */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs text-slate-600 space-y-1.5 leading-relaxed">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>{t('本地数据主权保障', 'Your data stays local')}</span>
                </div>
                <p>
                  {t(
                    'SkillsDock 遵循 Local-First 原则，无云端服务器中转，无用户隐私数据上传，零遥测打点。所有配置文件、技能仓库、项目工程映射与工具符号链接仅保存在您的个人电脑中。',
                    'SkillsDock is local-first: no cloud relay, private data uploads, or telemetry. Settings, the skill library, project mappings, and tool symlinks stay on your computer.',
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      </main>

      {/* 恢复默认设置二次确认弹窗（居中浮于最顶层） */}
      {showResetConfirm && (
        <div data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{t('恢复默认设置确认', 'Restore default settings')}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{t('是否确定重置所有常规配置？', 'Are you sure you want to reset general settings?')}</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs text-slate-600 space-y-1.5 leading-relaxed">
              <p className="font-medium text-slate-800">{t('将执行以下重置：', 'The following settings will be reset:')}</p>
              <ul className="list-disc pl-4 space-y-1 text-slate-500">
                <li>{t('技能分发同步方式重置为「文件复制」', 'Distribution method reset to "Copy"')}</li>
                <li>{t('开启自动检查更新，周期为 1 天', 'Enable auto update check (1 day interval)')}</li>
                <li>{t('界面主题恢复为浅色，语言恢复为中文', 'Theme reset to Light, language reset to Chinese')}</li>
                <li>{t('卸载技能时开启二次确认', 'Enable confirmation dialog before uninstalling')}</li>
              </ul>
              <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-200/60">
                {t('注意：技能仓库中的现有技能文件和项目工程配置不会受到影响。', 'Note: Existing skill files and project configurations will not be affected.')}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl shadow-xs transition-colors"
              >
                {t('确认恢复', 'Confirm restore')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 符号链接管理员提权提示弹窗（居中浮于最顶层） */}
      {showAdminConfirm && (
        <div data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{t('切换符号链接需要管理员权限', 'Administrator permissions required')}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{t('Windows 符号链接需要提权或开启开发者模式', 'Windows symlinks require elevation or Developer Mode')}</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                {t('在 Windows 系统中，普通非管理员程序无法创建符号链接。若要使用此模式，您可以：', 'On Windows, standard non-admin programs cannot create symbolic links. To use this mode, you can:')}
              </p>
              <ol className="list-decimal pl-4 space-y-1.5 text-slate-500">
                <li><strong className="text-slate-700">{t('以管理员身份重启软件：', 'Restart as Administrator: ')}</strong>{t('将弹出系统 UAC 提权确认，后续使用过程中均拥有创建符号链接权限。', 'A UAC prompt will appear, granting full permissions for your subsequent session.')}</li>
                <li><strong className="text-slate-700">{t('开启开发者模式：', 'Enable Developer Mode: ')}</strong>{t('在系统设置中启用后，任何程序无需管理员权限即可创建符号链接。', 'Once enabled in Windows Settings, all apps can create symlinks without admin rights.')}</li>
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
                <span>{isElevating ? t('正在请求提权...', 'Requesting elevation...') : t('以管理员身份重启并切换', 'Restart as Administrator and switch')}</span>
              </button>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleOpenDeveloperSettings}
                  className="flex-1 py-2 px-3 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                >
                  {t('前往开启开发者模式', 'Open Windows Settings')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdminConfirm(false)}
                  className="py-2 px-4 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  {t('取消（保持文件复制）', 'Cancel (Keep copy)')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
