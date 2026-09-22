import React, { useEffect } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Skill } from '../types';

interface UninstallDialogProps {
  isOpen: boolean;
  skillsToUninstall: Skill[];
  /** 卸载命令执行中（禁用按钮防止重复提交） */
  isProcessing?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const UninstallDialog: React.FC<UninstallDialogProps> = ({
  isOpen,
  skillsToUninstall,
  isProcessing = false,
  onClose,
  onConfirm,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isProcessing) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isProcessing, onClose]);

  if (!isOpen || skillsToUninstall.length === 0) return null;

  const isMultiple = skillsToUninstall.length > 1;
  const singleSkill = skillsToUninstall[0];
  const hasPureLocalSkill = skillsToUninstall.some(
    (s) => s.source.type === 'local' && !s.source.isGitHubDetectedFromLocal
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              {isMultiple
                ? `确认彻底卸载选中的 ${skillsToUninstall.length} 个技能？`
                : `确认彻底卸载技能「${singleSkill.displayName}」？`}
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              此操作将从本机的技能仓库以及所有已建立分发的 AI 工具目录（含各项目内的技能目录）中彻底清除。
            </p>
          </div>
        </div>

        {hasPureLocalSkill ? (
          <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-xs text-amber-900 flex items-start gap-2.5 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">纯本地技能不可逆警告：</strong>
              包含来自本地导入且未关联远程 Git 的私有技能。一旦删除，将无法通过网络重新安装，需自行备份源文件。
            </div>
          </div>
        ) : (
          <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs text-slate-600 leading-relaxed">
            远端来源技能卸载后，您随时可从 GitHub 仓库或公共注册表重新一键安装。
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
          >
            {isProcessing && (
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            <span>{isProcessing ? '正在卸载...' : '确认彻底删除'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
