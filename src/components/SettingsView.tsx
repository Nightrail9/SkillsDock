import React, { useState, useEffect } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { 
  Layers, 
  ShieldCheck, 
  Check, 
  HelpCircle, 
  HardDrive, 
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FolderOpen
} from 'lucide-react';
import { AppSettings, ToolAdapter, AddToastFn } from '../types';
import { useMigrateLibrary } from '../hooks/useSettings';
import { useAppState } from '../hooks/useAppState';
import { collapseHomePath } from '../lib/utils/pathDisplay';
import { errorToString } from '../lib/errors/skillErrorParser';

interface SettingsViewProps {
  settings: AppSettings;
  tools: ToolAdapter[];
  addToast: AddToastFn;
  onSaveSettings: (newSettings: AppSettings) => void;
  onOpenOnboarding: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  addToast,
  onSaveSettings,
  onOpenOnboarding,
}) => {
  const [formData, setFormData] = useState<AppSettings>({ ...settings });
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [savedStatus, setSavedStatus] = useState(false);
  const migrateMutation = useMigrateLibrary();
  const homeDir = useAppState().data?.homeDir;

  // 后端设置刷新后同步表单（例如迁移完成后 libraryPath 更新）
  useEffect(() => {
    setFormData((prev) => ({ ...prev, ...settings }));
  }, [settings]);

  /** 保存并即时生效 */
  const save = (next: AppSettings) => {
    setFormData(next);
    onSaveSettings(next);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 3000);
  };

  /** 中央库路径迁移：原生目录选择 → migrate_library（迁移中 loading，失败提示） */
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

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 max-w-4xl mx-auto">
      {/* Save Status Notification Banner */}
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
        {/* Section 1: 同步机制 */}
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

        {/* Section 2: 更新检测与卸载确认 */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">版本更新检测与卸载</h2>
          </div>

          {/* 自动检测开关 */}
          <div className="flex items-center justify-between py-1">
            <div>
              <div className="text-xs font-bold text-slate-800">自动检测技能更新</div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                打开应用时，若距上次检测已超过设定间隔，则在后台静默比对远端 Git 提交，不打断当前工作。
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

          {/* 检测间隔 */}
          {formData.autoCheckUpdate && (
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-xs font-bold text-slate-800">检测间隔（天）</div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  打开应用时，若距上次检测已超过该间隔才自动检查更新。GitHub 未认证 API 有速率限制，建议不小于 1 天。
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

          {/* 卸载确认 */}
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

        {/* Section 4: 关于与数据主权 */}
        <div className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">关于与数据主权</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                技能坞 (SkillDock) · 纯本地 AI 编程技能分发中心
              </p>
            </div>

            <button
              type="button"
              onClick={onOpenOnboarding}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
              <span>重新打开配置向导</span>
            </button>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 text-xs text-slate-600 space-y-1 leading-relaxed">
            <div className="font-bold text-slate-800 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>纯本地数据主权保障：</span>
            </div>
            <p>
              本应用无云端服务器中转，无用户数据上传，无遥测打点。所有配置文件、缓存与软链接仅保存在本机。
            </p>
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
  );
};
