import React, { useState, useEffect } from 'react';
import { 
  X, 
  Share2, 
  Copy, 
  CheckCheck, 
  ShieldCheck,
  Package,
  AlertCircle
} from 'lucide-react';
import { Skill, AddToastFn } from '../types';
import { useCreateShareLink } from '../hooks/useSkills';
import { errorToString } from '../lib/errors/skillErrorParser';

interface ShareModalProps {
  skill: Skill | null;
  selectedSkills?: Skill[];
  onClose: () => void;
  addToast: AddToastFn;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  skill,
  selectedSkills = [],
  onClose,
  addToast,
}) => {
  const [copied, setCopied] = useState(false);
  const createShareLinkMutation = useCreateShareLink();

  const isMultiple = selectedSkills.length > 1;
  const targetSkill = skill || selectedSkills[0];
  const targetIds = isMultiple
    ? selectedSkills.map((s) => s.id)
    : targetSkill
      ? [targetSkill.id]
      : [];

  // 打开弹窗即向后端请求真实分享链接（纯本地技能会被后端拒绝）
  const { mutate: createLink, isPending, isError, error, data: shareUrl } = createShareLinkMutation;
  const idsKey = targetIds.join(',');
  useEffect(() => {
    if (idsKey) createLink(idsKey.split(','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      addToast('success', '链接已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      addToast('error', '复制失败', errorToString(err));
    }
  };

  if (!targetSkill && !isMultiple) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Share2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isMultiple
                  ? `导出 ${selectedSkills.length} 个技能的共享清单`
                  : `导出技能共享链接`}
              </h3>
              <p className="text-[11px] text-slate-500">
                复制链接即可与团队成员共享当前技能配置
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
            title="关闭 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 text-xs space-y-4">
          {/* Target Summary */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
              <Package className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-slate-900 text-xs truncate">
                {isMultiple
                  ? `已打包 ${selectedSkills.length} 个技能 (包含 ${selectedSkills.slice(0, 3).map(s => s.displayName).join('、')}${selectedSkills.length > 3 ? ' 等' : ''})`
                  : targetSkill?.displayName}
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                {isMultiple ? `${selectedSkills.length} 项配置清单` : targetSkill?.name}
              </div>
            </div>
          </div>

          {/* Link URL Box */}
          <div>
            <label className="block font-bold text-slate-700 mb-1.5">
              分享链接地址
            </label>

            {isPending ? (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <span>正在生成分享链接...</span>
              </div>
            ) : isError ? (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5 whitespace-pre-wrap">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{errorToString(error)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl ?? ''}
                  className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-indigo-900 select-all focus:bg-white"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopy}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl font-bold flex items-center gap-1.5 shrink-0 transition-colors shadow-xs"
                >
                  {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? '已复制' : '复制链接'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Safety hint */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 text-[11px] text-slate-600 flex items-start gap-2.5 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              该落地页链接仅包含技能的公开 Git 仓库地址与版本号，不包含您本地的私有路径或密钥信息，安全合规。
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shadow-xs"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
