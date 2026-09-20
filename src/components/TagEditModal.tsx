import React, { useState, useEffect } from 'react';
import { Tag as TagIcon, X, Plus, Sparkles, Check } from 'lucide-react';
import { Skill } from '../types';

interface TagEditModalProps {
  skill: Skill | null;
  allAvailableTags?: string[];
  onClose: () => void;
  onAddTag: (skillId: string, tag: string) => void;
  onRemoveTag: (skillId: string, tag: string) => void;
}

export const TagEditModal: React.FC<TagEditModalProps> = ({
  skill,
  allAvailableTags = [],
  onClose,
  onAddTag,
  onRemoveTag,
}) => {
  const [newTagInput, setNewTagInput] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!skill) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagInput.trim().replace(/^#/, '');
    if (trimmed) {
      onAddTag(skill.id, trimmed);
      setNewTagInput('');
    }
  };

  const unassignedExistingTags = allAvailableTags.filter(
    (tag) => !skill.tags.includes(tag)
  );

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <TagIcon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">管理分类标签</h3>
              <p className="text-[11px] text-slate-500 font-mono truncate max-w-[240px]">
                {skill.displayName}
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
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Tag input form */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              新建标签
            </label>
            <form onSubmit={handleAdd} className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2.5 text-slate-400 text-xs">#</span>
                <input
                  type="text"
                  autoFocus
                  placeholder="输入新标签名称，按回车添加..."
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={!newTagInput.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加</span>
              </button>
            </form>
          </div>

          {/* Quick Select from Existing Unassigned Tags */}
          {unassignedExistingTags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>快捷选取已有标签 ({unassignedExistingTags.length})</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 rounded-2xl border border-slate-200/80 max-h-36 overflow-y-auto">
                {unassignedExistingTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onAddTag(skill.id, tag)}
                    className="inline-flex items-center gap-1 text-xs bg-white hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 transition-all shadow-2xs group cursor-pointer font-medium"
                    title={`点击将 #${tag} 关联到当前技能`}
                  >
                    <Plus className="w-3 h-3 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                    <span>#{tag}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current tags */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Check className="w-3 h-3 text-emerald-600" />
              <span>已绑定标签 ({skill.tags.length})</span>
            </div>
            {skill.tags.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                暂未设置标签
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-1">
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-800 px-2.5 py-1 rounded-lg border border-indigo-200/70 transition-colors font-semibold"
                  >
                    <span>#{tag}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveTag(skill.id, tag)}
                      className="ml-1 text-indigo-400 hover:text-rose-600 transition-colors p-0.5"
                      title="移除标签"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/70 flex justify-end shrink-0">
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
