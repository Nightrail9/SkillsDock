import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Check, FolderGit2, Loader2, Search, Send, Tag, X } from 'lucide-react';
import type { AppLocale, ProjectScope, Skill, ToolAdapter, ToolId } from '../types';
import { errorToString } from '../lib/errors/skillErrorParser';
import { matchesSelectedTags } from '../lib/utils/tagFilter';
import { ToolBrandIcon } from './icons/BrandIcons';

export interface SkillScheduleSummary {
  succeeded: string[];
  failed: Array<{ item: string; error: unknown }>;
}

interface SkillSchedulerModalProps {
  skills: Skill[];
  projects: ProjectScope[];
  tools: ToolAdapter[];
  locale: AppLocale;
  isScheduling: boolean;
  onClose: () => void;
  onSchedule: (request: { skillIds: string[]; projectIds: string[]; toolIds: ToolId[] }) => Promise<SkillScheduleSummary>;
}

/** Collects undistributed skills, project targets, and AI tools for a single scheduling action. */
export const SkillSchedulerModal: React.FC<SkillSchedulerModalProps> = ({
  skills,
  projects,
  tools,
  locale,
  isScheduling,
  onClose,
  onSchedule,
}) => {
  const t = (zh: string, en: string) => (locale === 'en' ? en : zh);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [selectedToolIds, setSelectedToolIds] = useState<Set<ToolId>>(
    () => new Set(tools.filter((tool) => tool.isEnabled).map((tool) => tool.id)),
  );
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<SkillScheduleSummary | null>(null);
  const [skillNamesAtSubmit, setSkillNamesAtSubmit] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (isScheduling) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScheduling, onClose]);

  const activeTools = tools.filter((tool) => tool.isEnabled);
  const validProjects = projects.filter((project) => project.isPathValid);
  const availableTags = useMemo(() => {
    const counts: Record<string, number> = {};
    skills.forEach((skill) => skill.tags.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    }));
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [skills]);
  const visibleSkills = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return skills.filter((skill) =>
      matchesSelectedTags(skill.tags, selectedTags) &&
      (!query || skill.displayName.toLocaleLowerCase().includes(query) || skill.name.toLocaleLowerCase().includes(query)),
    );
  }, [skills, search, selectedTags]);
  const selectedSkills = skills.filter((skill) => selectedSkillIds.has(skill.id));
  const deployedProjectCount = selectedSkills.reduce((count, skill) => {
    return count + new Set([...skill.projectIds, ...selectedProjectIds]).size;
  }, 0);
  const plannedDeploymentCount = deployedProjectCount * selectedToolIds.size;
  const hasGlobalSkills = selectedSkills.some((skill) => skill.scope === 'global');
  const allVisibleSelected = visibleSkills.length > 0 && visibleSkills.every((skill) => selectedSkillIds.has(skill.id));
  const canSchedule = selectedSkills.length > 0 && selectedProjectIds.size > 0 && selectedToolIds.size > 0 && !isScheduling;

  const toggleSetItem = <T extends string>(current: Set<T>, value: T, setValue: (next: Set<T>) => void) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setValue(next);
  };

  const handleSchedule = async () => {
    if (!canSchedule) return;
    setSubmitError(null);
    setSummary(null);
    setSkillNamesAtSubmit(Object.fromEntries(selectedSkills.map((skill) => [skill.id, skill.displayName])));
    try {
      const result = await onSchedule({
        skillIds: selectedSkills.map((skill) => skill.id),
        projectIds: [...selectedProjectIds],
        toolIds: [...selectedToolIds],
      });
      setSummary(result);
      setSelectedSkillIds(new Set());
      if (result.failed.length === 0) onClose();
    } catch (error) {
      setSubmitError(errorToString(error));
    }
  };

  return (
    <div data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="skill-scheduler-title" className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <header className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center"><Send className="w-4 h-4" /></div>
            <div>
              <h2 id="skill-scheduler-title" className="text-sm font-bold text-slate-900">{t('调度未分发技能', 'Schedule undistributed skills')}</h2>
              <p className="text-[11px] text-slate-500">{t('选择技能、项目和工具，一次完成项目分发', 'Choose skills, projects, and tools to distribute in one step')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isScheduling} aria-label={t('关闭', 'Close')} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 disabled:opacity-50"><X className="w-5 h-5" /></button>
        </header>

        <div className="p-5 space-y-4 overflow-y-auto min-h-0 flex-1 text-xs">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-700">{t('技能', 'Skills')} <span className="text-slate-400">({selectedSkillIds.size} / {skills.length})</span></h3>
              <button type="button" onClick={() => setSelectedSkillIds(allVisibleSelected ? new Set([...selectedSkillIds].filter((id) => !visibleSkills.some((skill) => skill.id === id))) : new Set([...selectedSkillIds, ...visibleSkills.map((skill) => skill.id)]))} disabled={isScheduling || visibleSkills.length === 0} className="text-indigo-600 hover:text-indigo-800 disabled:text-slate-400">
                {allVisibleSelected ? t('取消当前结果', 'Clear visible selection') : t('全选当前结果', 'Select visible results')}
              </button>
            </div>
            <label className="relative block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} disabled={isScheduling} placeholder={t('搜索技能名称...', 'Search skills...')} className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
            </label>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><Tag className="w-3 h-3" />{t('按标签筛选', 'Filter by tags')}</h4>
                {selectedTags.length > 0 && (
                  <button type="button" onClick={() => setSelectedTags([])} disabled={isScheduling} className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:text-slate-400">
                    {t('清除', 'Clear')} ({selectedTags.length})
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {availableTags.length === 0 ? (
                  <span className="text-[10px] text-slate-400">{t('暂无标签', 'No tags')}</span>
                ) : availableTags.map(({ name, count }) => {
                  const isSelected = selectedTags.includes(name);
                  return (
                    <button key={name} type="button" aria-pressed={isSelected} onClick={() => setSelectedTags((current) => (
                      isSelected ? current.filter((tag) => tag !== name) : [...current, name]
                    ))} disabled={isScheduling} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] transition-colors disabled:opacity-50 ${
                      isSelected ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}>
                      <span>#{name}</span><span className={`font-mono ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              {visibleSkills.length === 0 ? (
                <p className="p-4 text-center text-slate-400">{t('没有符合筛选条件的待调度技能', 'No undistributed skills match these filters')}</p>
              ) : visibleSkills.map((skill) => (
                <label key={skill.id} className="flex items-start gap-2.5 p-3 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={selectedSkillIds.has(skill.id)} disabled={isScheduling} onChange={() => toggleSetItem(selectedSkillIds, skill.id, setSelectedSkillIds)} className="mt-0.5 accent-indigo-600" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800 truncate">{skill.displayName}</span>
                      <span className="shrink-0 text-[10px] text-slate-500">{skill.scope === 'global' ? t('全局技能', 'Global') : t(`已关联 ${skill.projectIds.length} 个项目`, `${skill.projectIds.length} assigned projects`)}</span>
                    </span>
                    <span className="block text-slate-500 truncate mt-0.5">{skill.description || skill.name}</span>
                    {skill.scope === 'project' && skill.projectNames.length > 0 && (
                      <span className="block text-[10px] text-slate-400 mt-0.5 truncate">
                        {t('已关联项目：', 'Assigned projects: ')}{skill.projectNames.join(locale === 'en' ? ', ' : '、')}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 font-semibold text-slate-700"><FolderGit2 className="w-3.5 h-3.5" />{t('目标项目', 'Target projects')}</h3>
              {validProjects.length === 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">{t('没有路径有效的项目，请先注册或修复项目目录。', 'No projects with valid paths. Register a project or repair its directory first.')}</p>
              ) : (
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {validProjects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 p-2.5 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={selectedProjectIds.has(project.id)} disabled={isScheduling} onChange={() => toggleSetItem(selectedProjectIds, project.id, setSelectedProjectIds)} className="accent-indigo-600" />
                      <span className="truncate text-slate-700">{project.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {projects.some((project) => !project.isPathValid) && <p className="text-[10px] text-amber-700">{t('无效路径项目不可选，需先修复项目目录。', 'Projects with invalid paths cannot be selected; repair their directories first.')}</p>}
            </section>

            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 font-semibold text-slate-700"><Bot className="w-3.5 h-3.5" />{t('目标 AI 工具', 'Target AI tools')}</h3>
              {activeTools.length === 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">{t('没有已启用的 AI 工具，请先在设置中启用工具。', 'No AI tools are enabled. Enable a tool in Settings first.')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {activeTools.map((tool) => {
                    const isSelected = selectedToolIds.has(tool.id);
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleSetItem(selectedToolIds, tool.id, setSelectedToolIds)}
                        disabled={isScheduling}
                        className={`p-3 rounded-2xl border text-left flex items-center justify-between transition-all disabled:opacity-50 ${
                          isSelected
                            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 font-semibold shadow-2xs'
                            : 'bg-slate-50/70 border-slate-200 text-slate-600 hover:bg-slate-100/60'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <ToolBrandIcon toolId={tool.id} size={18} />
                          <span className="text-xs truncate">{tool.name}</span>
                        </span>
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] shrink-0 ${
                          isSelected ? 'bg-emerald-600 border border-emerald-600' : 'border border-slate-300 bg-white'
                        }`}>
                          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {selectedSkills.length > 0 && (
            <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-2">
              <h3 className="font-semibold text-indigo-900 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{t('分发预览', 'Distribution preview')}</h3>
              <p className="text-indigo-900/80">{t(`将分发到 ${deployedProjectCount} 个“技能-项目”目标，预计建立 ${plannedDeploymentCount} 个工具分发。`, `This schedules ${deployedProjectCount} skill-project targets and creates ${plannedDeploymentCount} tool distributions.`)}</p>
              {hasGlobalSkills && <p className="text-amber-800">{t(`${selectedSkills.filter((skill) => skill.scope === 'global').length} 个全局技能将转为项目技能，不再属于全局作用范围。`, `${selectedSkills.filter((skill) => skill.scope === 'global').length} global skills will become project-scoped and stop being global.`)}</p>}
              {selectedSkills.some((skill) => skill.scope === 'project' && skill.projectIds.length > 0) && <p className="text-indigo-900/80">{t('项目技能启用所选工具后，会分发到它已关联的所有项目，以及本次选择的项目。', 'Selected tools will be distributed to every project already assigned to a project-scoped skill, plus the projects selected here.')}</p>}
              <p className="text-slate-600">{t('各目标项目使用同一组所选工具：', 'The same selected tools will be used for all target projects: ')}{activeTools.filter((tool) => selectedToolIds.has(tool.id)).map((tool) => tool.name).join(', ') || t('尚未选择', 'None selected')}</p>
            </section>
          )}

          {submitError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700">{t('调度失败：', 'Scheduling failed: ')}{submitError}</p>}
          {summary && summary.failed.length > 0 && (
            <section role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
              <p className="font-semibold text-amber-900">{t(`已完成 ${summary.succeeded.length} 项，失败 ${summary.failed.length} 项。`, `${summary.succeeded.length} succeeded; ${summary.failed.length} failed.`)}</p>
              <ul className="space-y-1 text-amber-900/90">
                {summary.failed.map(({ item, error }) => <li key={item}>{skillNamesAtSubmit[item] ?? item}: {errorToString(error)}</li>)}
              </ul>
              <p className="text-amber-800">{t('部分失败的技能可能已完成作用域转换或部分工具分发；请在技能卡片检查实际状态。', 'A failed item may already have changed scope or partially distributed. Check its card for the current state.')}</p>
            </section>
          )}
        </div>

        <footer className="px-5 py-4 border-t border-slate-200/80 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[10px] text-slate-500">{selectedSkills.length} {t('个技能', 'skills')} · {selectedProjectIds.size} {t('个项目', 'projects')} · {selectedToolIds.size} {t('个工具', 'tools')}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={isScheduling} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/70 disabled:opacity-50">{t('取消', 'Cancel')}</button>
            <button type="button" onClick={handleSchedule} disabled={!canSchedule} className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
              {isScheduling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isScheduling ? t('正在调度...', 'Scheduling...') : t('确认分发', 'Schedule')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
