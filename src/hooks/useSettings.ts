import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../lib/api';
import { APP_STATE_KEY } from './useAppState';
import type { AppSettings, AppState } from '../types';

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => settingsApi.updateSettings(settings),
    // 后端返回 void，直接用提交值回写缓存
    onSuccess: (_result, saved) => {
      queryClient.setQueryData<AppState>(APP_STATE_KEY, (old) =>
        old ? { ...old, settings: saved } : old,
      );
    },
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
