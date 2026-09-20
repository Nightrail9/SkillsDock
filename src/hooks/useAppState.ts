import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appStateApi } from '../lib/api';

export const APP_STATE_KEY = ['app-state'] as const;

/**
 * 首屏应用状态：skills + tools + projects + settings + repos 一次取全。
 * staleTime: Infinity —— 只通过 mutation 后的显式 invalidate 刷新。
 */
export function useAppState() {
  return useQuery({
    queryKey: APP_STATE_KEY,
    queryFn: () => appStateApi.get(),
    staleTime: Infinity,
  });
}

export function useInvalidateAppState() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY });
}

/** 标记新手指引已完成/已跳过（持久化到后端 settings） */
export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => appStateApi.completeOnboarding(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}
