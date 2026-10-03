import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi } from '../lib/api';
import { APP_STATE_KEY } from './useAppState';
import { runSequentialBulkAction } from '../lib/utils/sequentialBulkAction';
import type { AppState, ImportSkillSelection, ToolId } from '../types';
export function useAddSkillProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => projectsApi.addProject(path),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

export function useScanProjectSkills() {
  return useMutation({
    mutationFn: (projectId: string) => projectsApi.scanUnmanagedSkills(projectId),
  });
}

export function useImportProjectSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, selections }: { projectId: string; selections: ImportSkillSelection[] }) =>
      projectsApi.importSkills(projectId, selections),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

export function useAssignSkillProjects() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, projectIds }: { skillId: string; projectIds: string[] }) =>
      projectsApi.assignSkills(skillId, projectIds),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 串行调度多项技能，单项失败不阻断后续技能。 */
export function useScheduleSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skillIds, targetScope, projectId, toolIds }: {
      skillIds: string[];
      targetScope: 'global' | 'project';
      projectId?: string;
      toolIds: ToolId[];
    }) =>
      runSequentialBulkAction(skillIds, (skillId) => {
        if (targetScope === 'global') {
          return projectsApi.scheduleSkillGlobally(skillId, toolIds);
        }
        if (!projectId) {
          throw new Error('A project must be selected for project distribution.');
        }
        return projectsApi.scheduleSkill(skillId, [projectId], toolIds);
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}


export function useRemoveSkillProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cleanup }: { id: string; cleanup: boolean }) =>
      projectsApi.removeProject(id, cleanup),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/**
 * 实查全部项目路径有效性。
 * 后端返回 ProjectPathStatus[]（{id, path, isPathValid}），
 * 按 id 合并进 ['app-state'] 缓存中 projects 的 isPathValid 字段。
 */
export function useCheckProjectPaths() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => projectsApi.checkPaths(),
    onSuccess: (statuses) => {
      const byId = new Map(statuses.map((s) => [s.id, s.isPathValid]));
      queryClient.setQueryData<AppState>(APP_STATE_KEY, (old) =>
        old
          ? {
              ...old,
              projects: old.projects.map((p) =>
                byId.has(p.id) ? { ...p, isPathValid: byId.get(p.id) as boolean } : p,
              ),
            }
          : old,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}
