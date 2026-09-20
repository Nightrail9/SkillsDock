import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../lib/api';
import { APP_STATE_KEY } from './useAppState';
import type { AppSettings, AppState } from '../types';

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => settingsApi.updateSettings(settings),
    // 后端返回受影响技能 id 列表（分发方式变更时），设置本体直接用提交值回写缓存
    onSuccess: (_result, saved) => {
      queryClient.setQueryData<AppState>(APP_STATE_KEY, (old) =>
        old ? { ...old, settings: saved } : old,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 分发方式变更后一键重建项目级技能链接/副本 */
export function useRedeployProjectLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => settingsApi.redeployProjectLinks(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

/** 迁移中央技能库至新目录（迁移期间调用方展示 loading） */
export function useMigrateLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: string) => settingsApi.migrateLibrary(target),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}
