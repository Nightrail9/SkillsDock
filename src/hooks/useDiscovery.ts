import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { discoveryApi } from '../lib/api';

/**
 * 搜索 skills.sh 公共注册表（真实搜索，无假延时）。
 * keepPreviousData 保证连续输入时列表不闪烁。
 */
export function useSkillsShSearch(query: string, limit = 50, offset = 0) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['skills', 'skillssh', trimmed, limit, offset],
    queryFn: () => discoveryApi.searchSkillsSh(trimmed, limit, offset),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
