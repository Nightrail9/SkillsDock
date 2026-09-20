import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { onboardingApi, skillsApi } from '../lib/api';
import { runSequentialBulkAction } from '../lib/utils/sequentialBulkAction';
import { APP_STATE_KEY } from './useAppState';
import { mergeImportedSkills } from './useSkills.helpers';
import type {
  AppState,
  DiscoverySkillItem,
  ImportSkillSelection,
  InstallRequest,
  ToolId,
} from '../types';

/** 技能详情（含真实 documentation 与 files 文件树） */
export function useSkillDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['skills', 'detail', id],
    queryFn: () => skillsApi.getDetail(id as string),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}

/** 切换技能在某工具上的分发状态 */
export function useToggleSkillTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toolId, enabled }: { id: string; toolId: ToolId; enabled: boolean }) =>
      skillsApi.toggleTool(id, toolId, enabled),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 批量切换技能分发状态（串行：每次操作都会写目标工具目录） */
export function useBulkToggleSkillTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, toolId, enabled }: { ids: string[]; toolId: ToolId; enabled: boolean }) =>
      runSequentialBulkAction(ids, (id) => skillsApi.toggleTool(id, toolId, enabled)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 批量设置技能标签（整体替换语义） */
export function useSetSkillTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, tags }: { ids: string[]; tags: string[] }) =>
      skillsApi.setTags(ids, tags),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 卸载单个技能（卸载即删，无备份） */
export function useUninstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillsApi.uninstall(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 批量卸载（串行执行，汇总成功/失败） */
export function useBulkUninstallSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      runSequentialBulkAction(ids, (id) => skillsApi.uninstall(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 检查更新（会刷新 latestCommit / hasUpdate，完成后静默刷新列表） */
export function useCheckSkillUpdates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => skillsApi.checkUpdates(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 更新单个技能 */
export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillsApi.updateSkill(id),
    onSuccess: (updated) => {
      queryClient.setQueryData<AppState>(APP_STATE_KEY, (old) =>
        old
          ? { ...old, skills: mergeImportedSkills(old.skills, [updated]) }
          : old,
      );
      queryClient.invalidateQueries({ queryKey: ['skills', 'detail', updated.id] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 批量更新（串行） */
export function useBulkUpdateSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      runSequentialBulkAction(ids, (id) => skillsApi.updateSkill(id)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 统一安装（发现页条目） */
export function useInstallSkillUnified() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ skill, req }: { skill: DiscoverySkillItem; req: InstallRequest }) =>
      skillsApi.installUnified(skill, req),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 解析分享链接（纯查询型命令，用 mutation 由用户手动触发） */
export function useParseShareLink() {
  return useMutation({
    mutationFn: (url: string) => skillsApi.parseShareLink(url),
  });
}

/** 生成分享链接 */
export function useCreateShareLink() {
  return useMutation({
    mutationFn: (ids: string[]) => skillsApi.createShareLink(ids),
  });
}

/** 扫描未受管技能（新手引导；enabled 时才主动扫描） */
export function useScanUnmanagedSkills(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['skills', 'unmanaged'],
    queryFn: () => onboardingApi.scanUnmanaged(),
    enabled: options?.enabled ?? false,
    staleTime: 30 * 1000,
  });
}

/** 将未受管技能导入技能仓库 */
export function useImportSkillsFromApps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (selections: ImportSkillSelection[]) =>
      onboardingApi.importFromApps(selections),
    onSuccess: (imported) => {
      queryClient.setQueryData<AppState>(APP_STATE_KEY, (old) =>
        old ? { ...old, skills: mergeImportedSkills(old.skills, imported) } : old,
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
        queryClient.invalidateQueries({ queryKey: ['skills', 'unmanaged'] }),
      ]),
  });
}
