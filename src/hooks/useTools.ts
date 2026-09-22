import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  toolsApi,
  type AddToolAdapterRequest,
  type UpdateToolAdapterRequest,
} from '../lib/api';
import { APP_STATE_KEY } from './useAppState';
import type { AppState, ToolId } from '../types';

export function useAddToolAdapter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: AddToolAdapterRequest) => toolsApi.addToolAdapter(req),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

export function useUpdateToolAdapter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateToolAdapterRequest) => toolsApi.updateToolAdapter(req),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

export function useDeleteToolAdapter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: ToolId) => toolsApi.deleteToolAdapter(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}

export function useToggleToolEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: ToolId; enabled: boolean }) =>
      toolsApi.toggleToolEnabled(id, enabled),
    // 乐观更新：点击后开关立即翻转，避免等后端往返才动
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: APP_STATE_KEY });
      const previous = queryClient.getQueryData<AppState>(APP_STATE_KEY);
      if (previous) {
        queryClient.setQueryData<AppState>(APP_STATE_KEY, {
          ...previous,
          tools: previous.tools.map((t) => (t.id === id ? { ...t, isEnabled: enabled } : t)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      // 失败时回滚到切换前的状态，保持界面与后端一致
      if (ctx?.previous) queryClient.setQueryData(APP_STATE_KEY, ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}
