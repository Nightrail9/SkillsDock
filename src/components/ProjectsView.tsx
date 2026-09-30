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
import { ProjectScope, Skill, AddToastFn, UnmanagedSkill } from '../types';
import {
  useAddSkillProject,
  useRemoveSkillProject,
  useCheckProjectPaths,
  useScanProjectSkills,
  useImportProjectSkills,
} from '../hooks/useProjects';
import { errorToString } from '../lib/errors/skillErrorParser';
import { useAppState } from '../hooks/useAppState';
import { collapseHomePath } from '../lib/utils/pathDisplay';

interface ProjectsViewProps {
  projects: ProjectScope[];
  skills: Skill[];
  addToast: AddToastFn;
  onFilterByProject: (projectId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  skills,
  addToast,
  onFilterByProject,
}) => {
  const addProjectMutation = useAddSkillProject();
  const removeProjectMutation = useRemoveSkillProject();
  const checkPathsMutation = useCheckProjectPaths();
  const scanProjectSkillsMutation = useScanProjectSkills();
  const importProjectSkillsMutation = useImportProjectSkills();
  const homeDir = useAppState().data?.homeDir;
  const [skillsPendingImport, setSkillsPendingImport] = React.useState<{
    project: ProjectScope;
    skills: UnmanagedSkill[];
  } | null>(null);
  const [projectPendingRemoval, setProjectPendingRemoval] = React.useState<{
    project: ProjectScope;
    skillCount: number;
  } | null>(null);
  const [scanFeedback, setScanFeedback] = React.useState<{
    projectId: string;
    kind: 'scanning' | 'empty' | 'error';
    message: string;
  } | null>(null);

  // 进入页面时实查一次所有项目路径有效性（刷新 isPathValid）
  const checkPathsMutate = checkPathsMutation.mutate;
  useEffect(() => {
    checkPathsMutate(undefined, {
      onError: (err) => console.warn('项目路径检查失败:', errorToString(err)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 新建项目：Tauri 原生目录选择 + add_skill_project（名称由后端按目录名生成） */
  const scanProjectSkills = async (project: ProjectScope) => {
    setScanFeedback({ projectId: project.id, kind: 'scanning', message: '正在扫描项目技能...' });
    try {
      const skills = await scanProjectSkillsMutation.mutateAsync(project.id);
      if (skills.length > 0) {
        setScanFeedback(null);
        setSkillsPendingImport({ project, skills });
      } else {
        setScanFeedback({
          projectId: project.id,
          kind: 'empty',
          message: '扫描完成，未发现待纳管的项目技能。',
        });
      }
    } catch (err) {
      setScanFeedback({
        projectId: project.id,
        kind: 'error',
        message: `扫描项目技能失败：${errorToString(err)}`,
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
          addToast('success', '项目技能已导入', `已将 ${imported.length} 个技能纳入「${project.name}」管理。`);
        },
        onError: (err) => addToast('error', '项目技能导入失败', errorToString(err)),
      },
    );
  };

  const handleRegisterProject = async () => {
    let selected: string | null = null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: '选择工程项目根目录',
      });
      if (typeof result === 'string') selected = result;
    } catch (err) {
      addToast('error', '无法打开目录选择器', errorToString(err));
      return;
    }
    if (!selected) return;

    addProjectMutation.mutate(selected, {
      onSuccess: async (project) => {
        addToast('success', `已成功注册项目「${project.name}」`, project.path);
        await scanProjectSkills(project);
      },
      onError: (err) => addToast('error', '项目注册失败', errorToString(err)),
    });
  };

  /** 打开应用内确认框；项目仍纳管技能时，确认会同时卸载这些技能 */
  const handleUnregisterProject = (project: ProjectScope) => {
    const skillCount = skills.filter((s) => s.projectId === project.id).length;
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
            '已移除项目注册',
            skillCount > 0 ? '已同步卸载项目专属技能并清理分发文件' : undefined,
          );
        },
        onError: (err) => addToast('error', '移除项目失败', errorToString(err)),
      },
    );
  };

  const isBusy =
    addProjectMutation.isPending ||
    removeProjectMutation.isPending ||
    importProjectSkillsMutation.isPending;

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Compact Top Action Bar */}
      <div className="flex items-center justify-end pb-3 border-b border-slate-200/80">
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() =>
              checkPathsMutation.mutate(undefined, {
                onSuccess: () => addToast('info', '项目路径状态已刷新'),
                onError: (err) => addToast('error', '路径检查失败', errorToString(err)),
              })
            }
            disabled={checkPathsMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-colors shadow-2xs disabled:opacity-50"
            title="重新检查所有项目目录是否仍然有效"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkPathsMutation.isPending ? 'animate-spin' : ''}`} />
            <span>刷新路径状态</span>
          </button>

          <button
            onClick={handleRegisterProject}
            disabled={isBusy}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl transition-colors shadow-xs disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{addProjectMutation.isPending ? '注册中...' : '新建项目'}</span>
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
            <h3 className="text-sm font-bold text-slate-800">尚未注册任何项目</h3>
            <p className="text-xs text-slate-500 mt-1">
              注册本地工程目录后，即可将技能安装为该项目专属，仅在此项目中生效。
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => {
            const projectSkills = skills.filter((s) => s.projectId === project.id);
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
                        <div className="text-[10px] text-slate-400 font-mono">注册于 {project.registeredAt}</div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleUnregisterProject(project)}
                      disabled={isBusy}
                      className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors disabled:opacity-50"
                      title="移除项目注册"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-400 font-semibold">项目根目录路径:</span>
                    <div className="font-mono text-[11px] text-slate-700 bg-slate-100 px-2.5 py-1.5 rounded-lg truncate mt-1 border border-slate-200/60">
                      {collapseHomePath(project.path, homeDir)}
                    </div>
                    {!project.isPathValid && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-lg px-2.5 py-1.5 mt-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        <span>项目路径已失效（目录不存在或不可访问），项目级技能将暂停生效。</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 font-medium">专属技能纳管:</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px] border border-blue-200/60">
                      {projectSkills.length} 个
                    </span>
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => scanProjectSkills(project)}
                    disabled={scanProjectSkillsMutation.isPending || isBusy}
                    className="text-xs text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 font-semibold flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    title="重新扫描此项目中尚未纳管的技能"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${scanProjectSkillsMutation.isPending ? 'animate-spin' : ''}`} />
                    <span>重新扫描项目技能</span>
                  </button>
                  <button
                    onClick={() => onFilterByProject(project.id)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 group/btn"
                  >
                    <span>查看此项目专属技能</span>
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
                发现项目内未纳管技能
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                「{skillsPendingImport.project.name}」中发现 {skillsPendingImport.skills.length} 个技能。确认后会复制到中央技能库并纳入此项目管理。
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
                      在技能库中保存为：{skill.directory}
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
                暂不导入
              </button>
              <button
                type="button"
                onClick={handleImportProjectSkills}
                disabled={importProjectSkillsMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {importProjectSkillsMutation.isPending ? '导入中...' : '导入全部'}
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
                  确认移除项目？
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  将移除「{projectPendingRemoval.project.name}」的项目注册。
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
              {projectPendingRemoval.skillCount > 0
                ? `该项目纳管了 ${projectPendingRemoval.skillCount} 个专属技能。继续后会卸载这些技能，并清理它们在项目目录中的分发文件及中央库项目副本。项目中的其他文件不会被删除。`
                : '该项目当前没有纳管的专属技能。项目目录及其中的文件不会被删除。'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProjectPendingRemoval(null)}
                disabled={removeProjectMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveProject}
                disabled={removeProjectMutation.isPending}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              >
                {removeProjectMutation.isPending
                  ? '正在移除...'
                  : projectPendingRemoval.skillCount > 0
                    ? '移除并清理技能'
                    : '确认移除项目'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
