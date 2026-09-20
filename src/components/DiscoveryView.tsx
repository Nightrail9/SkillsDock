import React, { useState } from 'react';
import {
  Search,
  Users,
  Github,
  Download,
  Star,
  Check,
  Link2,
  PackageCheck,
  AlertCircle,
} from 'lucide-react';
import {
  DiscoverySkillItem,
  Skill,
  AddToastFn,
  ShareSkillEntry,
} from '../types';
import { useSkillsShSearch } from '../hooks/useDiscovery';
import { useParseShareLink } from '../hooks/useSkills';
import { useAddSkillRepo } from '../hooks/useRepos';
import { errorToString } from '../lib/errors/skillErrorParser';

interface DiscoveryViewProps {
  installedSkills: Skill[];
  onSelectInstall: (item: DiscoverySkillItem) => void;
  addToast: AddToastFn;
}

/** 从 owner/repo 或 GitHub URL 解析仓库坐标 */
function parseRepoInput(input: string): { owner: string; name: string } | null {
  let s = input.trim().replace(/\.git$/i, '');
  s = s
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], name: parts[1] };
}

/** 取路径末级目录名 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export const DiscoveryView: React.FC<DiscoveryViewProps> = ({
  installedSkills,
  onSelectInstall,
  addToast,
}) => {
  const [mainMode, setMainMode] = useState<'market' | 'github' | 'share'>('market');
  const [searchQuery, setSearchQuery] = useState('');

  // Custom GitHub Source Form
  const [customRepo, setCustomRepo] = useState('');
  const [customBranch, setCustomBranch] = useState('main');
  const [customSubpath, setCustomSubpath] = useState('skills');

  // Link Import State
  const [shareLinkInput, setShareLinkInput] = useState('');
  const [parsedLinkSkills, setParsedLinkSkills] = useState<ShareSkillEntry[] | null>(null);

  // ===== 真实数据源 hooks =====
  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length >= 2;
  const skillsShQuery = useSkillsShSearch(trimmedQuery);

  const addSkillRepoMutation = useAddSkillRepo();
  const parseShareLinkMutation = useParseShareLink();

  // 精确匹配键：registryId 或 "repo:directory"（小写）。
  // 纯本地无来源技能不参与社区结果的"已安装"标记，避免同名不同源误命中。
  const installedRegistryIds = new Set(
    installedSkills
      .map((s) => s.source.registryId)
      .filter((id): id is string => !!id),
  );
  const installedRepoDirs = new Set(
    installedSkills
      .filter((s) => !!s.source.repo)
      .map((s) => `${s.source.repo!.toLowerCase()}:${s.directory.toLowerCase()}`),
  );
  const isItemInstalled = (item: {
    id: string;
    name: string;
    repo?: string;
    registryId?: string;
  }) =>
    installedRegistryIds.has(item.id) ||
    (!!item.registryId && installedRegistryIds.has(item.registryId)) ||
    (!!item.repo &&
      installedRepoDirs.has(`${item.repo.toLowerCase()}:${item.name.toLowerCase()}`));

  // 市场列表：仅在输入 ≥2 字符时检索 skills.sh 公共注册表；未搜索时展示占位提示
  const marketItems: DiscoverySkillItem[] = isSearching
    ? (skillsShQuery.data?.skills ?? [])
    : [];

  // ===== Git 仓库导入：注册仓库源并进入安装向导 =====
  const handleGitRepoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRepoInput(customRepo);
    if (!parsed) {
      addToast('error', '仓库地址无效', '请输入 owner/repo 或合法的 GitHub 仓库 URL');
      return;
    }
    const branch = customBranch.trim() || 'main';
    const subpath = customSubpath.trim();

    // 注册为长期仓库源（失败不阻断安装流程，例如重复添加）
    addSkillRepoMutation.mutate(
      { owner: parsed.owner, name: parsed.name, branch },
      {
        onError: (err) =>
          addToast('warning', '仓库源注册提示', errorToString(err)),
      },
    );

    const skillName = subpath ? baseName(subpath) : parsed.name;
    onSelectInstall({
      id: `github:${parsed.owner}/${parsed.name}/${subpath}`,
      name: skillName,
      displayName: `${skillName} (Git: ${parsed.owner}/${parsed.name})`,
      description: `来自 Git 仓库 ${parsed.owner}/${parsed.name} 的技能包。`,
      author: parsed.owner,
      sourceType: 'github',
      stars: 0,
      downloads: '-',
      repo: `${parsed.owner}/${parsed.name}`,
      branch,
      subpath: subpath || undefined,
      tags: [],
      latestCommit: branch,
      verified: false,
      isInstalled: installedRepoDirs.has(
        `${parsed.owner}/${parsed.name}:${skillName}`.toLowerCase(),
      ),
    });
  };

  // ===== 分享链接导入：真实解析 =====
  const handleParseShareLink = (e: React.FormEvent) => {
    e.preventDefault();
    const url = shareLinkInput.trim();
    if (!url) return;
    setParsedLinkSkills(null);
    parseShareLinkMutation.mutate(url, {
      onSuccess: (result) => {
        if (result.skills.length === 0) {
          addToast('info', '链接解析完成', '该分享链接中没有可导入的技能。');
          return;
        }
        setParsedLinkSkills(result.skills);
      },
      onError: (err) => addToast('error', '分享链接解析失败', errorToString(err)),
    });
  };

  const handleInstallParsedSkill = (entry: ShareSkillEntry) => {
    const name = entry.name;
    onSelectInstall({
      id: `share:${entry.sourceType}:${entry.repo ?? entry.registryId ?? name}`,
      name,
      displayName: entry.displayName || entry.name,
      description: entry.description ?? '',
      author: entry.repo?.split('/')[0] || 'shared',
      sourceType: entry.sourceType,
      stars: 0,
      downloads: '-',
      repo: entry.repo,
      branch: entry.branch,
      subpath: entry.subpath,
      registryId: entry.registryId,
      tags: entry.tags ?? [],
      latestCommit: entry.branch ?? '',
      verified: false,
      isInstalled: isItemInstalled({ id: entry.registryId ?? '', name, repo: entry.repo, registryId: entry.registryId }),
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Compact Top Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
        {mainMode === 'market' ? (
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              placeholder="搜索 skills.sh 公共注册表（至少 2 个字符）..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs transition-all placeholder:text-slate-400"
            />
          </div>
        ) : (
          <div className="text-xs font-medium text-slate-500">
            {mainMode === 'github'
              ? '从 GitHub 仓库克隆技能定义至技能仓库'
              : '解析他人分享的技能链接 / Bundle 清单，批量纳管至技能仓库'}
          </div>
        )}

        {/* Mode Switcher */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/70 text-xs font-semibold shrink-0">
          <button
            onClick={() => setMainMode('market')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
              mainMode === 'market'
                ? 'bg-white text-indigo-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 text-indigo-600" />
            <span>开源社区推荐</span>
          </button>
          <button
            onClick={() => setMainMode('github')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
              mainMode === 'github'
                ? 'bg-white text-indigo-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Github className="w-4 h-4 text-indigo-600" />
            <span>Github 仓库</span>
          </button>
          <button
            onClick={() => setMainMode('share')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
              mainMode === 'share'
                ? 'bg-white text-indigo-700 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Link2 className="w-4 h-4 text-indigo-600" />
            <span>分享链接</span>
          </button>
        </div>
      </div>

      {/* MODE 1: skills.sh 社区技能市场 */}
      {mainMode === 'market' && (
        <div className="space-y-6">
          {!isSearching ? (
            <div className="py-24 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200/70 flex items-center justify-center">
                <Search className="w-7 h-7 text-slate-400" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-600">搜索 skills.sh 公共注册表</p>
                <p className="text-xs text-slate-400">
                  在上方输入关键词（至少 2 个字符），即可检索社区技能并一键安装
                </p>
              </div>
            </div>
          ) : skillsShQuery.isLoading ? (
            <div className="py-16 text-center text-xs text-slate-400">
              正在搜索 skills.sh 公共注册表...
            </div>
          ) : skillsShQuery.isError ? (
            <div className="p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 bg-rose-50 border-rose-200/80 text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>搜索失败：{errorToString(skillsShQuery.error)}</span>
            </div>
          ) : marketItems.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-400">
              没有找到与「{trimmedQuery}」相关的技能
            </div>
          ) : (
            <>
              {skillsShQuery.data && (
                <div className="text-[11px] text-slate-400">
                  skills.sh 搜索「{trimmedQuery}」：共 {skillsShQuery.data.totalCount} 条结果
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {marketItems.map((item) => {
                  const isInstalled = item.isInstalled || isItemInstalled(item);
                  return (
                    <div
                      key={item.id}
                      className="bg-white p-5 rounded-2xl border border-slate-200/85 hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between group"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                              {item.displayName}
                            </h3>
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                              {item.repo}
                            </div>
                          </div>
                          {item.sourceType === 'skills_sh' ? (
                            <div className="flex items-center gap-1 text-[11px] text-sky-700 bg-sky-50 px-2 py-0.5 rounded-lg border border-sky-200/60 font-semibold shrink-0">
                              <Download className="w-3 h-3" />
                              <span>{item.downloads || '-'}</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/60 font-semibold shrink-0">
                              <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                              <span>{item.stars}</span>
                            </div>
                          )}
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                          {item.description}
                        </p>
                      </div>

                      <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[11px] text-slate-400">
                          维护方: <strong className="text-slate-600">{item.author}</strong>
                        </span>

                        {isInstalled ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200">
                            <Check className="w-3.5 h-3.5" />
                            <span>已安装</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => onSelectInstall(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>安装技能</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* MODE 2: Github 仓库导入（含 URL 直链安装） */}
      {mainMode === 'github' && (
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Git 仓库导入 */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-5">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Github className="w-4 h-4 text-slate-800" />
                  <span>添加自定义 Git 技能源</span>
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  填写任意公开或私有 Git 仓库，系统将克隆技能定义文件至技能仓库并支持自动更新检测。
                </p>
              </div>

              <form onSubmit={handleGitRepoSubmit} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    GitHub 仓库路径 (owner/repo 或 HTTPS URL) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="例如: anthropics/skills-kit 或 https://github.com/my-org/agent-tools"
                    value={customRepo}
                    onChange={(e) => setCustomRepo(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-xs transition-all font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">Git 分支 (Branch)</label>
                    <input
                      type="text"
                      value={customBranch}
                      onChange={(e) => setCustomBranch(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">技能所在子目录 (Subpath)</label>
                    <input
                      type="text"
                      value={customSubpath}
                      onChange={(e) => setCustomSubpath(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-xs transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>安装</span>
                  </button>
                </div>
              </form>
            </div>
        </div>
      )}

      {/* MODE 3: 分享链接导入 */}
      {mainMode === 'share' && (
        <div className="max-w-3xl mx-auto space-y-6">
          {/* 分享链接导入 */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-indigo-600" />
                  <span>导入分享链接 / Bundle 清单</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  输入他人分享的技能链接（例如以 <code className="text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded font-mono">https://skilldock.app/s#...</code> 开头），系统将解析其中包含的技能清单。
                </p>
              </div>

              {parseShareLinkMutation.isError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5 whitespace-pre-wrap">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{errorToString(parseShareLinkMutation.error)}</span>
                </div>
              )}

              <form onSubmit={handleParseShareLink} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1.5">
                    分享链接 URL <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="https://skilldock.app/s#..."
                    value={shareLinkInput}
                    onChange={(e) => setShareLinkInput(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={!shareLinkInput.trim() || parseShareLinkMutation.isPending}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-xl shadow-xs transition-colors flex items-center gap-2"
                  >
                    {parseShareLinkMutation.isPending ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>正在解析分享链接...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>解析链接</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              {/* 解析结果清单 */}
              {parsedLinkSkills && parsedLinkSkills.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <PackageCheck className="w-4 h-4 text-emerald-600" />
                    <span>解析出 {parsedLinkSkills.length} 个技能，逐个进入安装向导：</span>
                  </div>
                  {parsedLinkSkills.map((entry) => {
                    const name = entry.name;
                    const alreadyInstalled = isItemInstalled({
                      id: entry.registryId ?? '',
                      name,
                      repo: entry.repo,
                      registryId: entry.registryId,
                    });
                    return (
                      <div
                        key={`${entry.sourceType}:${entry.repo ?? entry.registryId ?? name}`}
                        className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-800 truncate">{entry.displayName || entry.name}</div>
                          <div className="text-[11px] text-slate-500 truncate">{entry.description ?? ''}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                            {entry.repo ?? entry.registryId ?? entry.sourceType}
                          </div>
                        </div>
                        {alreadyInstalled ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 shrink-0">
                            <Check className="w-3 h-3" />
                            <span>已安装</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleInstallParsedSkill(entry)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shrink-0"
                          >
                            安装
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
};
