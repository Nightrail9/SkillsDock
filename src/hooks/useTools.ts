import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  toolsApi,
  type AddToolAdapterRequest,
  type UpdateToolAdapterRequest,
} from '../lib/api';
import { APP_STATE_KEY } from './useAppState';
import type { ToolId } from '../types';

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
    onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
  });
}
