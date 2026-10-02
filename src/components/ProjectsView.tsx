import React, { useEffect } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { 
  FolderGit2, 
  Plus, 
  Trash2, 
  ArrowRight,
  FolderOpen,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { AppLocale, ProjectScope, Skill, AddToastFn, UnmanagedSkill } from '../types';
import {
  useAddSkillProject,
  useRemoveSkillProject,
  useCheckProjectPaths,
  useScanProjectSkills,
  useImportProjectSkills,
  useAssignSkillProjects,
} from '../hooks/useProjects';
import { errorToString } from '../lib/errors/skillErrorParser';
import { useAppState } from '../hooks/useAppState';
import { collapseHomePath } from '../lib/utils/pathDisplay';

interface ProjectsViewProps {
  projects: ProjectScope[];
  skills: Skill[];
  addToast: AddToastFn;
  onFilterByProject: (projectId: string) => void;
  locale: AppLocale;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  skills,
  addToast,
  onFilterByProject,
  locale,
}) => {
  const t = (zh: string, en: string) => (locale === 'en' ? en : zh);
  const addProjectMutation = useAddSkillProject();
  const removeProjectMutation = useRemoveSkillProject();
  const checkPathsMutation = useCheckProjectPaths();
  const scanProjectSkillsMutation = useScanProjectSkills();
  const importProjectSkillsMutation = useImportProjectSkills();
  const assignSkillProjectsMutation = useAssignSkillProjects();
  const homeDir = useAppState().data?.homeDir;
  const [skillsPendingImport, setSkillsPendingImport] = React.useState<{
    project: ProjectScope;
    skills: UnmanagedSkill[];
  } | null>(null);
  const [projectPendingRemoval, setProjectPendingRemoval] = React.useState<{
    project: ProjectScope;
    skillCount: number;
  } | null>(null);
  const [projectPendingAssignment, setProjectPendingAssignment] = React.useState<ProjectScope | null>(null);
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<string[]>([]);
  const [scanFeedback, setScanFeedback] = React.useState<{
    projectId: string;
    kind: 'scanning' | 'empty' | 'error';
    message: string;
  } | null>(null);

  // 进入页面时实查一次所有项目路径有效性（刷新 isPathValid）
  const checkPathsMutate = checkPathsMutation.mutate;
  useEffect(() => {
    checkPathsMutate(undefined, {
      onError: (err) => console.warn(t('项目路径检查失败:', 'Failed to check project paths:'), errorToString(err)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 新建项目：Tauri 原生目录选择 + add_skill_project（名称由后端按目录名生成） */
  const scanProjectSkills = async (project: ProjectScope) => {
    setScanFeedback({ projectId: project.id, kind: 'scanning', message: t('正在扫描项目技能...', 'Scanning project skills...') });
    try {
      const skills = await scanProjectSkillsMutation.mutateAsync(project.id);
      if (skills.length > 0) {
        setScanFeedback(null);
        setSkillsPendingImport({ project, skills });
      } else {
        setScanFeedback({
          projectId: project.id,
          kind: 'empty',
          message: t('扫描完成，未发现待纳管的项目技能。', 'Scan complete. No unmanaged project skills were found.'),
        });
      }
    } catch (err) {
      setScanFeedback({
        projectId: project.id,
        kind: 'error',
        message: t(`扫描项目技能失败：${errorToString(err)}`, `Failed to scan project skills: ${errorToString(err)}`),
      });
    }
  };

  const handleImportProjectSkills = () => {
    if (!skillsPendingImport) return;
    const { project, skills } = skillsPendingImport;
    importProjectSkillsMutation.mutate(
      {
        projectId: project.id,
        selections: skills.map((skill) => ({
          directory: skill.directory,
          sourceDirectory: skill.sourceDirectory,
          relativePath: skill.relativePath,
          toolIds: skill.foundIn,
        })),
      },
      {
        onSuccess: (imported) => {
          setSkillsPendingImport(null);
          addToast('success', t('项目技能已导入', 'Project skills imported'), t(`已将 ${imported.length} 个技能纳入「${project.name}」管理。`, `Added ${imported.length} skills to "${project.name}".`));
        },
        onError: (err) => addToast('error', t('项目技能导入失败', 'Failed to import project skills'), errorToString(err)),
      },
    );
  };

  const handleRegisterProject = async () => {
    let selected: string | null = null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: t('选择工程项目根目录', 'Select a project root folder'),
      });
      if (typeof result === 'string') selected = result;
    } catch (err) {
      addToast('error', t('无法打开目录选择器', 'Unable to open the folder picker'), errorToString(err));
      return;
    }
    if (!selected) return;

    addProjectMutation.mutate(selected, {
      onSuccess: async (project) => {
        addToast('success', t(`已成功注册项目「${project.name}」`, `Registered project "${project.name}"`), project.path);
        await scanProjectSkills(project);
      },
      onError: (err) => addToast('error', t('项目注册失败', 'Failed to register project'), errorToString(err)),
    });
  };

  /** Opens confirmation before project registrations are removed. */
  const handleUnregisterProject = (project: ProjectScope) => {
    const skillCount = skills.filter((skill) => skill.projectIds.includes(project.id)).length;
    setProjectPendingRemoval({ project, skillCount });
  };

  const handleConfirmRemoveProject = () => {
    if (!projectPendingRemoval || removeProjectMutation.isPending) return;
    const { project, skillCount } = projectPendingRemoval;
    removeProjectMutation.mutate(
      { id: project.id, cleanup: skillCount > 0 },
      {
        onSuccess: () => {
          setProjectPendingRemoval(null);
          addToast(
            'info',
            t('已移除项目注册', 'Project registration removed'),
            skillCount > 0 ? t('已同步卸载项目专属技能并清理分发文件', 'Project skills were uninstalled and deployed files were removed') : undefined,
          );
        },
        onError: (err) => addToast('error', t('移除项目失败', 'Failed to remove project'), errorToString(err)),
      },
    );
  };

  const assignableSkills = projectPendingAssignment
    ? skills.filter((skill) =>
        skill.scope === 'global' || !skill.projectIds.includes(projectPendingAssignment.id),
      )
    : [];

  const handleAssignSkills = async () => {
    if (!projectPendingAssignment || selectedSkillIds.length === 0) return;
    const completed: string[] = [];
    const failed: Array<{ skillId: string; error: string }> = [];
    for (const skillId of selectedSkillIds) {
      try {
        await assignSkillProjectsMutation.mutateAsync({
          skillId,
          projectIds: [projectPendingAssignment.id],
        });
        completed.push(skillId);
      } catch (err) {
        failed.push({ skillId, error: errorToString(err) });
      }
    }

    if (failed.length === 0) {
      addToast(
        'success',
        t('技能已加入项目', 'Skills added to project'),
        t(
          `已将 ${completed.length} 个技能分发到「${projectPendingAssignment.name}」。`,
          `Added ${completed.length} skills to "${projectPendingAssignment.name}".`,
        ),
      );
      setProjectPendingAssignment(null);
      setSelectedSkillIds([]);
      return;
    }

    if (completed.length > 0) {
      setSelectedSkillIds((selected) =>
        selected.filter((skillId) => !completed.includes(skillId)),
      );
    }
    const failureDetails = failed
      .map(({ skillId, error }) => {
        const name = skills.find((skill) => skill.id === skillId)?.displayName ?? skillId;
        return `${name}: ${error}`;
      })
      .join('; ');
    addToast(
      'error',
      t(
        completed.length > 0 ? '部分技能添加失败' : '添加技能失败',
        completed.length > 0 ? 'Some skills could not be added' : 'Failed to add skills',
      ),
      t(
        `成功 ${completed.length} 个，失败 ${failed.length} 个。${failureDetails}`,
        `${completed.length} succeeded, ${failed.length} failed. ${failureDetails}`,
      ),
    );
  };

  const isBusy =
    addProjectMutation.isPending ||
    removeProjectMutation.isPending ||
    importProjectSkillsMutation.isPending ||
    assignSkillProjectsMutation.isPending;

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Compact Top Action Bar */}
      <div className="flex items-center justify-end pb-3 border-b border-slate-200/80">
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() =>
              checkPathsMutation.mutate(undefined, {
                onSuccess: () => addToast('info', t('项目路径状态已刷新', 'Project path status refreshed')),
                onError: (err) => addToast('error', t('路径检查失败', 'Failed to check paths'), errorToString(err)),
              })
            }
            disabled={checkPathsMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-colors shadow-2xs disabled:opacity-50"
            title={t('重新检查所有项目目录是否仍然有效', 'Check whether all project folders are still available')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkPathsMutation.isPending ? 'animate-spin' : ''}`} />
            <span>{t('刷新路径状态', 'Refresh path status')}</span>
          </button>

          <button
            onClick={handleRegisterProject}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl transition-colors shadow-xs disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{addProjectMutation.isPending ? t('注册中...', 'Registering...') : t('新建项目', 'Add project')}</span>
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="py-16 text-center space-y-3 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <FolderOpen className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">{t('尚未注册任何项目', 'No projects registered')}</h3>
            <p className="text-xs text-slate-500 mt-1">
              {t('注册本地工程目录后，即可将技能安装为该项目专属，仅在此项目中生效。', 'Register a local project folder to install skills that are available only in that project.')}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => {
            const projectSkills = skills.filter((s) => s.projectIds.includes(project.id));
            return (
              <div
                key={project.id}
                className="bg-white p-5 rounded-2xl border border-slate-200/85 hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200/60 font-bold group-hover:scale-105 transition-transform">
                        <FolderGit2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                          {project.name}
                        </h3>
                        <div className="text-[10px] text-slate-400 font-mono">{t('注册于', 'Registered')} {project.registeredAt}</div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleUnregisterProject(project)}
                      disabled={isBusy}
                      className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-50"
                      title={t('移除项目注册', 'Unregister project')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-400 font-semibold">{t('项目根目录路径:', 'Project root path:')}</span>
                    <div className="font-mono text-[11px] text-slate-700 bg-slate-100 px-2.5 py-1.5 rounded-lg truncate mt-1 border border-slate-200/60">
                      {collapseHomePath(project.path, homeDir)}
                    </div>
                    {!project.isPathValid && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-lg px-2.5 py-1.5 mt-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>{t('项目路径已失效（目录不存在或不可访问），项目级技能将暂停生效。', 'The project folder is unavailable. Project skills are temporarily inactive.')}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 font-medium">{t('项目技能:', 'Project skills:')}</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px] border border-blue-200/60">
                        {projectSkills.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProjectPendingAssignment(project);
                        setSelectedSkillIds([]);
                      }}
                      disabled={isBusy || !project.isPathValid}
                      className="text-xs text-indigo-700 hover:text-indigo-800 font-semibold disabled:opacity-50"
                    >
                      {t('添加技能', 'Add skills')}
                    </button>
                  </div>

                </div>
                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => scanProjectSkills(project)}
                    disabled={scanProjectSkillsMutation.isPending || isBusy}
                    className="text-xs text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 font-semibold flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    title={t('重新扫描此项目中尚未纳管的技能', 'Scan this project for unmanaged skills')}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${scanProjectSkillsMutation.isPending ? 'animate-spin' : ''}`} />
                    <span>{t('重新扫描项目技能', 'Scan project skills')}</span>
                  </button>
                  <button
                    onClick={() => onFilterByProject(project.id)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 group/btn"
                  >
                    <span>{t('查看此项目专属技能', 'View project skills')}</span>
                    <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
                  </button>
                </div>
                {scanFeedback?.projectId === project.id && (
                  <p
                    role={scanFeedback.kind === 'error' ? 'alert' : 'status'}
                    className={`mt-2 text-xs ${
                      scanFeedback.kind === 'error'
                        ? 'text-rose-600'
                        : scanFeedback.kind === 'scanning'
                          ? 'text-indigo-600'
                          : 'text-slate-500'
                    }`}
                  >
                    {scanFeedback.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {projectPendingAssignment && (
        <div data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-existing-skills-title"
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <div>
              <h3 id="assign-existing-skills-title" className="text-sm font-bold text-slate-900">
                {t('添加技能到项目', 'Add skills to project')}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {t(`选择纳入「${projectPendingAssignment.name}」的技能。`, `Choose skills to assign to "${projectPendingAssignment.name}".`)}
              </p>
            </div>
            {selectedSkillIds.some((id) => skills.find((skill) => skill.id === id)?.scope === 'global') && (
              <p className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800">
                {t(
                  '全局技能将停止全局分发并转为项目技能；项目技能仍可分配给其他项目。',
                  'Global skills will stop global distribution and become project skills. Project skills can still be assigned to other projects.',
                )}
              </p>
            )}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {assignableSkills.length === 0 ? (
                <p className="text-xs text-slate-500 py-5 text-center">
                  {t('没有可添加的技能。', 'No skills are available to add.')}
                </p>
              ) : assignableSkills.map((skill) => (
                <label key={skill.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSkillIds.includes(skill.id)}
                    onChange={(event) => setSelectedSkillIds((previous) =>
                      event.target.checked
                        ? [...previous, skill.id]
                        : previous.filter((id) => id !== skill.id),
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-800">{skill.displayName}</span>
                    <span className="block text-[10px] text-slate-500">
                      {skill.scope === 'global'
                        ? t('当前：全局', 'Current: Global')
                        : t(`当前：${skill.projectNames.join('、')}`, `Current: ${skill.projectNames.join(', ')}`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProjectPendingAssignment(null)}
                disabled={assignSkillProjectsMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleAssignSkills}
                disabled={selectedSkillIds.length === 0 || assignSkillProjectsMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {assignSkillProjectsMutation.isPending ? t('分发中...', 'Distributing...') : t('添加所选技能', 'Add selected skills')}
              </button>
            </div>
          </div>
        </div>
      )}
      {skillsPendingImport && (
        <div data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-skill-import-title"
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg p-6 space-y-4"
          >
            <div>
              <h3 id="project-skill-import-title" className="text-sm font-bold text-slate-900">
                {t('发现项目内未纳管技能', 'Unmanaged project skills found')}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {t(`「${skillsPendingImport.project.name}」中发现 ${skillsPendingImport.skills.length} 个技能。确认后会复制到中央技能库并纳入此项目管理。`, `Found ${skillsPendingImport.skills.length} skills in "${skillsPendingImport.project.name}". They will be copied to the central library and managed by this project.`)}
              </p>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-2">
              {skillsPendingImport.skills.map((skill) => (
                <div
                  key={`${skill.foundIn.join(',')}:${skill.relativePath}`}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200"
                >
                  <div className="text-xs font-semibold text-slate-800">{skill.name}</div>
                  {skill.description && (
                    <div className="text-[11px] text-slate-500 mt-1">{skill.description}</div>
                  )}
                  <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">{skill.path}</div>
                  {skill.directory !== skill.sourceDirectory && (
                    <div className="text-[10px] text-indigo-600 mt-1">
                      {t(`在技能库中保存为：${skill.directory}`, `Save in the library as: ${skill.directory}`)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSkillsPendingImport(null)}
                disabled={importProjectSkillsMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('暂不导入', 'Not now')}
              </button>
              <button
                type="button"
                onClick={handleImportProjectSkills}
                disabled={importProjectSkillsMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {importProjectSkillsMutation.isPending ? t('导入中...', 'Importing...') : t('导入全部', 'Import all')}
              </button>
            </div>
          </div>
        </div>
      )}
      {projectPendingRemoval && (
        <div data-window-modal-backdrop className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="project-removal-title"
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-5"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 id="project-removal-title" className="text-sm font-bold text-slate-900">
                  {t('确认移除项目？', 'Unregister this project?')}
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  {t(`将移除「${projectPendingRemoval.project.name}」的项目注册。`, `Unregister "${projectPendingRemoval.project.name}".`)}
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
              {projectPendingRemoval.skillCount > 0
                ? t(
                    `该项目关联了 ${projectPendingRemoval.skillCount} 个技能。继续后会移除这些技能在本项目中的分发；仍被其他项目使用的技能会保留在技能库及其他项目中。`,
                    `This project uses ${projectPendingRemoval.skillCount} skills. Continuing removes their project distributions here; skills assigned elsewhere remain in the library and those projects.`,
                  )
                : t('该项目当前没有关联技能。项目目录及其中的文件不会被删除。', 'This project has no assigned skills. The project folder and its files will not be deleted.')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProjectPendingRemoval(null)}
                disabled={removeProjectMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveProject}
                disabled={removeProjectMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              >
                {removeProjectMutation.isPending
                  ? t('正在移除...', 'Removing...')
                  : projectPendingRemoval.skillCount > 0
                    ? t('移除并清理技能', 'Unregister and remove skills')
                    : t('确认移除项目', 'Unregister project')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
