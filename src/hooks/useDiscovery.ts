import { useMutation, useQuery } from '@tanstack/react-query';
import { discoveryApi, skillsApi } from '../lib/api';

/**
 * 搜索 skills.sh 公共注册表（真实搜索，无假延时）。
 * 不使用 placeholderData：切换查询词时进入正常 loading 态，
 * 避免上一查询词的旧结果以新结果身份展示。
 */
export function useSkillsShSearch(query: string, limit = 50, offset = 0) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ['skills', 'skillssh', trimmed, limit, offset],
    queryFn: () => discoveryApi.searchSkillsSh(trimmed, limit, offset),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 探测 GitHub 仓库内全部可安装技能（纯查询型命令，用 mutation 由用户手动触发）。
 * 结果由 DiscoveryView 持有展示，不写入全局缓存。
 */
export function useProbeRepoSkills() {
  return useMutation({
    mutationFn: ({ owner, name, branch }: { owner: string; name: string; branch: string }) =>
      skillsApi.probeRepoSkills(owner, name, branch),
  });
}
