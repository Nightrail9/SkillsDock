import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reposApi } from '../lib/api';
import { APP_STATE_KEY } from './useAppState';
import type { AddSkillRepoRequest } from '../types';

export function useAddSkillRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: AddSkillRepoRequest) => reposApi.addRepo(req),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
        queryClient.invalidateQueries({ queryKey: ['skills', 'discoverable'] }),
      ]),
  });
}
