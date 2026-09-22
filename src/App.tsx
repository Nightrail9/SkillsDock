/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Package,
  Search,
  RotateCw,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  Skill,
  ScopeType,
  MainNavTab,
  ToolId,
  DiscoverySkillItem,
  AppSettings,
  AppState,
} from './types';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar } from './components/Sidebar';
import { SkillCard } from './components/SkillCard';
import { InstallModal } from './components/InstallModal';
import { DiscoveryView } from './components/DiscoveryView';
import { SettingsView, SettingsSubTab } from './components/SettingsView';
import { ShareModal } from './components/ShareModal';
import { useTheme } from './hooks/useTheme';
import { OnboardingModal } from './components/OnboardingModal';
import { BatchBar } from './components/BatchBar';
import { UninstallDialog } from './components/UninstallDialog';
import { TagEditModal } from './components/TagEditModal';
import { APP_STATE_KEY, useAppState, useCompleteOnboarding } from './hooks/useAppState';
import { useToast } from './hooks/useToast';
import { ToastContainer } from './components/Toast';
import {
  useToggleSkillTool,
  useBulkToggleSkillTool,
  useSetSkillTags,
  useBulkUninstallSkills,
  useCheckSkillUpdates,
  useUpdateSkill,
  useBulkUpdateSkills,
  useInstallSkillUnified,
} from './hooks/useSkills';
import { useUpdateSettings, useRedeployProjectLinks } from './hooks/useSettings';
import { skillsApi } from './lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { errorToString } from './lib/errors/skillErrorParser';
import { settingsApi } from './lib/api';
import { readLlmApiKey } from './lib/llmKey';

export default function App() {
  // ===== 后端应用状态（首屏一次取全） =====
  const appStateQuery = useAppState();
  const appState = appStateQuery.data;
  const skills: Skill[] = useMemo(() => appState?.skills ?? [], [appState]);
  const tools = useMemo(() => appState?.tools ?? [], [appState]);
  const projects = useMemo(() => appState?.projects ?? [], [appState]);
  const appSettings = appState?.settings ?? null;
  const t = (zh: string, en: string) => (appSettings?.locale === 'en' ? en : zh);

  useTheme(appSettings?.theme || 'light');

  // ===== Toast 通知（右上角弹窗，操作结果与失败反馈的用户可见出口） =====
  const { toasts, addToast, dismissToast } = useToast();

  // ===== Mutations =====
  const toggleToolMutation = useToggleSkillTool();
  const bulkToggleMutation = useBulkToggleSkillTool();
  const setTagsMutation = useSetSkillTags();
  const bulkUninstallMutation = useBulkUninstallSkills();
  const checkUpdatesMutation = useCheckSkillUpdates();
  const updateSkillMutation = useUpdateSkill();
  const bulkUpdateMutation = useBulkUpdateSkills();
  const installUnifiedMutation = useInstallSkillUnified();
  const updateSettingsMutation = useUpdateSettings();
  const redeployLinksMutation = useRedeployProjectLinks();

  // ===== 启动时回填存量"本地技能"的 skills.sh 社区来源（联网精确匹配；有回填则刷新列表） =====
  const queryClient = useQueryClient();

  // 正在单独生成简介的技能集合
  const [generatingDescSkillIds, setGeneratingDescSkillIds] = useState<Set<string>>(new Set());

  // 为单个技能生成/重新生成简介
  const handleGenerateSingleDescription = useCallback(async (skill: Skill, language?: 'zh' | 'en') => {
    const apiKey = readLlmApiKey().trim();
    if (!apiKey && !appState?.llmConfig?.baseUrl) {
      addToast('error', '请先在设置页完成模型配置');
      return;
    }
    const targetLanguage = language || appState?.llmConfig?.language || 'zh';
    setGeneratingDescSkillIds((prev) => new Set(prev).add(skill.id));
    try {
      const result = await settingsApi.processSkillDescriptions(
        [skill.id],
        apiKey,
        targetLanguage,
      );
      if (result.failures.length > 0) {
        addToast('error', '简介生成失败', result.failures[0].reason);
      } else {
        addToast('success', '简介已生成', `已成功生成「${skill.displayName}」的简介`);
      }
      queryClient.invalidateQueries({ queryKey: APP_STATE_KEY });
    } catch (err) {
      addToast('error', '简介生成失败', errorToString(err));
    } finally {
      setGeneratingDescSkillIds((prev) => {
        const next = new Set(prev);
        next.delete(skill.id);
        return next;
      });
    }
  }, [appState?.llmConfig, addToast, queryClient]);

  // 为选中技能生成简介（语言由设置项决定）
  const [descBusy, setDescBusy] = useState(false);
  const handleGenerateDescriptions = async () => {
    const apiKey = readLlmApiKey().trim();
    if (!apiKey && !appState?.llmConfig?.baseUrl) {
      addToast('error', '请先在设置页完成模型配置');
      return;
    }
    if (selectedSkillIds.size === 0) return;
    const targetIds = [...selectedSkillIds];
    const language = appState?.llmConfig?.language || 'zh';
    setDescBusy(true);
    setGeneratingDescSkillIds((prev) => new Set([...prev, ...targetIds]));
    try {
      const result = await settingsApi.processSkillDescriptions(
        targetIds,
        apiKey,
        language,
      );
      if (result.failures.length > 0) {
        if (result.succeeded > 0) {
          addToast(
            'warning',
            `部分简介生成失败 (${result.succeeded}/${result.processed} 成功)`,
            result.failures.map((f) => f.reason).slice(0, 2).join('; '),
          );
        } else {
          addToast(
            'error',
            '简介生成失败',
            result.failures[0]?.reason || '模型调用未返回有效结果',
          );
        }
      } else if (result.succeeded > 0) {
        addToast('success', '简介生成完成', `已成功生成 ${result.succeeded} 个技能的简介！`);
      }
      queryClient.invalidateQueries({ queryKey: APP_STATE_KEY });
    } catch (err) {
      addToast('error', '简介生成失败', errorToString(err));
    } finally {
      setDescBusy(false);
      setGeneratingDescSkillIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };
  useEffect(() => {
    let cancelled = false;
    skillsApi
      .backfillSources()
      .then((n) => {
        if (!cancelled && n > 0) {
          queryClient.invalidateQueries({ queryKey: APP_STATE_KEY });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  // Top Navigation Tab (Default to 'installed')
  const [currentTab, setCurrentTab] = useState<MainNavTab>('installed');
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('general');

  // Installed Page Filter States (Project Scope & Tags)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedScope, setSelectedScope] = useState<'all' | ScopeType | string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Selection for Batch Mode
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set());

  // Modal Dialog States
  const [installItems, setInstallItems] = useState<DiscoverySkillItem[]>([]);
  const [installProgress, setInstallProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
  } | null>(null);
  const [isBatchInstalling, setIsBatchInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<{ skill?: Skill; isBatch?: boolean } | null>(null);
  const [tagEditingSkillId, setTagEditingSkillId] = useState<string | null>(null);
  const [skillsToUninstall, setSkillsToUninstall] = useState<Skill[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // 分发方式变更后待重部署的项目技能（null = 无待处理）
  const [redeployPromptIds, setRedeployPromptIds] = useState<string[] | null>(null);

  // 更新中的技能集合（按钮 loading 态）
  const [updatingSkillIds, setUpdatingSkillIds] = useState<Set<string>>(new Set());

  const tagEditingSkill = tagEditingSkillId
    ? skills.find((s) => s.id === tagEditingSkillId) ?? null
    : null;

  // 打开新安装目标时清空上一次的错误
  useEffect(() => {
    setInstallError(null);
  }, [installItems]);

  // ===== 新手指引（PRD 3.10）：首次启动自动弹出，完成/跳过后持久化标记 =====
  const completeOnboardingMutation = useCompleteOnboarding();
  const onboardingCompleted = appState?.onboardingCompleted;
  useEffect(() => {
    if (onboardingCompleted === false) {
      setShowOnboarding(true);
    }
  }, [onboardingCompleted]);

  const handleCloseOnboarding = useCallback(() => {
    setShowOnboarding(false);
    // 仅在未完成时落库标记，避免重复写入与无效刷新
    if (onboardingCompleted === false) {
      completeOnboardingMutation.mutate(undefined, {
        onError: (err) => console.warn('记录新手指引状态失败:', errorToString(err)),
      });
    }
  }, [onboardingCompleted, completeOnboardingMutation.mutate]);

  // ===== 自动更新检测：启动时仅当距上次检测已超过设定间隔才执行；运行期间按间隔到期检测 =====
  const autoCheckUpdate = appState?.settings.autoCheckUpdate;
  const checkIntervalDays = appState?.settings.checkIntervalDays;
  const lastUpdateCheckAt = appState?.settings.lastUpdateCheckAt;
  const checkUpdatesMutate = checkUpdatesMutation.mutate;
  useEffect(() => {
    if (!autoCheckUpdate || lastUpdateCheckAt === undefined) return;
    const intervalMs = Math.max(checkIntervalDays ?? 1, 1) * 24 * 3600 * 1000;
    const runIfDue = () => {
      if (Date.now() - lastUpdateCheckAt * 1000 < intervalMs) return;
      checkUpdatesMutate(undefined, {
        onError: (err) => console.warn('自动检查更新失败:', errorToString(err)),
      });
    };
    runIfDue();
    const timer = setInterval(runIfDue, intervalMs);
    return () => clearInterval(timer);
  }, [autoCheckUpdate, checkIntervalDays, lastUpdateCheckAt, checkUpdatesMutate]);

  // Extract all unique tags with count
  const allTags = useMemo(() => {
    const counts: Record<string, number> = {};
    skills.forEach((s) => {
      s.tags.forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [skills]);

  // Filter installed skills by Project, Tags, and Search
  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      // 1. Project Scope Filter
      if (selectedScope === 'global' && skill.scope !== 'global') return false;
      if (selectedScope !== 'all' && selectedScope !== 'global' && skill.projectId !== selectedScope) return false;

      // 2. Tag Level Filter
      if (selectedTags.length > 0 && !selectedTags.some((t) => skill.tags.includes(t))) {
        return false;
      }

      // 3. Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = skill.displayName.toLowerCase().includes(q) || skill.name.toLowerCase().includes(q);
        const matchesDesc = skill.description.toLowerCase().includes(q);
        const matchesTags = skill.tags.some((t) => t.toLowerCase().includes(q));
        const matchesRepo = skill.source.repo?.toLowerCase().includes(q) || false;
        if (!matchesName && !matchesDesc && !matchesTags && !matchesRepo) return false;
      }

      return true;
    });
  }, [skills, selectedScope, selectedTags, searchQuery]);

  // 当前筛选下可见的选中项：选中态可跨筛选/标签页保留，但批量动作严格作用于可见交集
  const visibleSelectedSkills = useMemo(
    () => filteredSkills.filter((s) => selectedSkillIds.has(s.id)),
    [filteredSkills, selectedSkillIds],
  );

  const updateAvailableCount = skills.filter((s) => s.hasUpdate).length;

  // ===== Handlers =====

  // Toggle single tool deployment for a skill
  const handleToggleToolDeploy = useCallback((skillId: string, toolId: ToolId) => {
    const targetSkill = skills.find((s) => s.id === skillId);
    const targetTool = tools.find((t) => t.id === toolId);
    if (!targetSkill || !targetTool) return;

    const willBeDeployed = !targetSkill.deployedTools[toolId];

    toggleToolMutation.mutate(
      { id: skillId, toolId, enabled: willBeDeployed },
      {
        onSuccess: () => {
          if (willBeDeployed) {
            addToast('success', `已在 ${targetTool.name} 中启用`, '已建立分发链接并即时生效');
          } else {
            addToast('info', `已在 ${targetTool.name} 中停用`, '已移除分发链接，技能仓库文件完好保留');
          }
        },
        onError: (err) => {
          addToast('error', '分发状态切换失败', errorToString(err));
        },
      },
    );
  }, [skills, tools, toggleToolMutation, addToast]);

  // Toggle single selection
  const handleToggleSelect = useCallback((skillId: string) => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }, []);

  const isAllFilteredSelected =
    filteredSkills.length > 0 &&
    filteredSkills.every((s) => selectedSkillIds.has(s.id));

  const handleToggleSelectAll = () => {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (isAllFilteredSelected) {
        filteredSkills.forEach((s) => next.delete(s.id));
      } else {
        filteredSkills.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedSkillIds(new Set(filteredSkills.map((s) => s.id)));
  };

  const handleClearSelection = useCallback(() => {
    setSelectedSkillIds(new Set());
  }, []);

  // Batch deploy / retract（串行执行，汇总成功/失败）
  const handleBatchDeployTool = (toolId: ToolId, enable: boolean) => {
    const targetTool = tools.find((t) => t.id === toolId);
    const ids = visibleSelectedSkills.map((s) => s.id);
    if (ids.length === 0) return;

    bulkToggleMutation.mutate(
      { ids, toolId, enabled: enable },
      {
        onSuccess: (result) => {
          if (result.failed.length === 0) {
            addToast(
              'success',
              `批量${enable ? '启用' : '停用'}完成`,
              `已在 ${result.succeeded.length} 个技能上${enable ? '启用' : '停用'} ${targetTool?.name ?? toolId}`
            );
          } else {
            addToast(
              'warning',
              `批量${enable ? '启用' : '停用'}部分失败`,
              `成功 ${result.succeeded.length} 项、失败 ${result.failed.length} 项：${errorToString(result.failed[0].error)}`
            );
          }
        },
      },
    );
  };

  // Check updates（手动触发，带反馈；后端会刷新 lastUpdateCheckAt 并重置自动检测计时）
  const handleCheckUpdates = () => {
    checkUpdatesMutation.mutate(undefined, {
      onSuccess: (updates) => {
        addToast(
          'info',
          '检查更新完成',
          updates.length > 0
            ? `已成功比对远端 Git 提交，当前有 ${updates.length} 个技能有新版本。`
            : '所有技能均已是最新版本。'
        );
      },
      onError: (err) => {
        addToast('error', '检查更新失败', errorToString(err));
      },
    });
  };

  // Update single skill
  const handleUpdateSingle = useCallback((skill: Skill) => {
    if (bulkUpdateMutation.isPending || updatingSkillIds.has(skill.id)) return;
    setUpdatingSkillIds((prev) => new Set(prev).add(skill.id));
    updateSkillMutation.mutate(skill.id, {
      onSuccess: (updated) => {
        addToast(
          'success',
          `技能「${updated.displayName}」更新成功`,
          `已更新至最新提交 ${updated.currentCommit}，并同步至所有已启用工具。`
        );
      },
      onError: (err) => {
        addToast('error', `技能「${skill.displayName}」更新失败`, errorToString(err));
      },
      onSettled: () => {
        setUpdatingSkillIds((prev) => {
          const next = new Set(prev);
          next.delete(skill.id);
          return next;
        });
      },
    });
  }, [bulkUpdateMutation.isPending, updatingSkillIds, updateSkillMutation, addToast]);

  // 批量更新（串行），供「全部更新」与「批量更新选中」共用
  const runBulkUpdate = (ids: string[]) => {
    if (ids.length === 0 || bulkUpdateMutation.isPending) return;
    setUpdatingSkillIds((prev) => new Set([...prev, ...ids]));
    bulkUpdateMutation.mutate(ids, {
      onSuccess: (result) => {
        if (result.failed.length === 0) {
          addToast('success', '全部更新完成', `已将 ${result.succeeded.length} 个技能更新至最新版本并同步。`);
        } else {
          addToast(
            'warning',
            '批量更新部分失败',
            `成功 ${result.succeeded.length} 项、失败 ${result.failed.length} 项：${errorToString(result.failed[0].error)}`
          );
        }
      },
      onError: (err) => {
        addToast('error', '批量更新失败', errorToString(err));
      },
      onSettled: () => {
        setUpdatingSkillIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      },
    });
  };

  const handleUpdateAll = () => {
    if (bulkUpdateMutation.isPending) return;
    runBulkUpdate(skills.filter((s) => s.hasUpdate).map((s) => s.id));
  };

  // 发起卸载：根据设置决定是否需要二次确认
  const requestUninstall = useCallback((targets: Skill[]) => {
    if (targets.length === 0) return;
    if (appSettings?.confirmOnUninstall !== false) {
      setSkillsToUninstall(targets);
    } else {
      bulkUninstallMutation.mutate(
        targets.map((s) => s.id),
        {
          onSuccess: (result) => {
            handleClearSelection();
            if (result.failed.length === 0) {
              addToast('success', '卸载完成', `已彻底移除 ${result.succeeded.length} 个技能包。`);
            } else {
              addToast(
                'warning',
                '批量卸载部分失败',
                `成功 ${result.succeeded.length} 项、失败 ${result.failed.length} 项：${errorToString(result.failed[0].error)}`
              );
            }
          },
        },
      );
    }
  }, [appSettings?.confirmOnUninstall, bulkUninstallMutation, handleClearSelection, addToast]);

  const handleOpenTagEdit = useCallback((skill: Skill) => {
    setTagEditingSkillId(skill.id);
  }, []);

  const handleUninstallSingle = useCallback((skill: Skill) => {
    requestUninstall([skill]);
  }, [requestUninstall]);

  // Uninstall confirm（单个与批量共用，串行执行）
  const handleConfirmUninstall = () => {
    const targets = skillsToUninstall;
    const ids = targets.map((s) => s.id);
    if (ids.length === 0) return;

    bulkUninstallMutation.mutate(ids, {
      onSuccess: (result) => {
        setSkillsToUninstall([]);
        handleClearSelection();
        if (result.failed.length === 0) {
          addToast(
            'success',
            '卸载完成',
            `已从技能仓库及所有工具目录中彻底移除 ${result.succeeded.length} 个技能包。`
          );
        } else {
          addToast(
            'warning',
            '批量卸载部分失败',
            `成功 ${result.succeeded.length} 项、失败 ${result.failed.length} 项：${errorToString(result.failed[0].error)}`
          );
        }
      },
    });
  };

  // Finish installation from modal（真实安装命令，进度由 mutation 状态驱动）。
  // 分发方式不随安装流程选择，统一读取「设置 → 常规」中的全局分发方式
  const handleCompleteInstall = async (params: {
    items: DiscoverySkillItem[];
    scope: ScopeType;
    projectId?: string;
    selectedTools: Record<ToolId, boolean>;
  }) => {
    const toolIds = Object.entries(params.selectedTools)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);

    setInstallError(null);
    setIsBatchInstalling(true);

    const isBatch = params.items.length > 1;
    const succeeded: Skill[] = [];
    const failed: Array<{ item: DiscoverySkillItem; error: string }> = [];

    for (let i = 0; i < params.items.length; i++) {
      const item = params.items[i];
      setInstallProgress({
        current: i + 1,
        total: params.items.length,
        currentName: item.displayName || item.name,
      });

      try {
        const installed = await skillsApi.installUnified(item, {
          scope: params.scope,
          projectId: params.projectId,
          toolIds,
          deployMethod: appSettings?.distributionMethod ?? 'copy',
        });
        succeeded.push(installed);
      } catch (err) {
        failed.push({ item, error: errorToString(err) });
      }
    }

    setIsBatchInstalling(false);
    setInstallProgress(null);

    // 自动为新安装成功的技能生成中文简介
    if (succeeded.length > 0) {
      const apiKey = readLlmApiKey().trim();
      if (apiKey) {
        const targetLanguage = appSettings?.locale === 'en' ? 'en' : 'zh';
        void settingsApi
          .processSkillDescriptions(
            succeeded.map((s) => s.id),
            apiKey,
            targetLanguage,
          )
          .then(() => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }))
          .catch((err) => console.warn('简介自动生成失败:', err));
      }
    }

    await queryClient.invalidateQueries({ queryKey: APP_STATE_KEY });

    if (failed.length === 0) {
      setInstallItems([]);
      setInstallError(null);
      setCurrentTab('installed');
      setSearchQuery('');
      setSelectedScope('all');
      setSelectedTags([]);
      addToast(
        'success',
        isBatch
          ? `一键安装完成（已安装全部 ${succeeded.length} 项）`
          : `技能「${succeeded[0]?.displayName ?? params.items[0].displayName}」安装完成`,
        '已保存至技能仓库并在选定工具中生效。',
      );
    } else if (succeeded.length > 0) {
      // 部分成功
      setInstallItems(failed.map((f) => f.item));
      setInstallError(
        `以下技能安装失败：\n` +
          failed.map((f) => `• ${f.item.displayName}: ${f.error}`).join('\n'),
      );
      addToast(
        'warning',
        `安装部分完成（成功 ${succeeded.length} 项，失败 ${failed.length} 项）`,
        failed.map((f) => `${f.item.displayName}: ${f.error}`).join('; '),
      );
    } else {
      // 全部失败
      setInstallError(
        isBatch
          ? `全部技能安装失败：\n` +
              failed.map((f) => `• ${f.item.displayName}: ${f.error}`).join('\n')
          : failed[0].error,
      );
    }
  };

  // Toggle tag selection (sidebar filter)
  const handleToggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  // 标签增删：乐观更新缓存中的 tags，失败回滚快照，杜绝连点竞态双写
  const applySkillTagsOptimistic = (skillId: string, nextTags: string[]) => {
    const prevState = queryClient.getQueryData<AppState>(APP_STATE_KEY);
    queryClient.setQueryData<AppState>(APP_STATE_KEY, (old) => {
      if (!old) return old;
      return {
        ...old,
        skills: old.skills.map((s) => (s.id === skillId ? { ...s, tags: nextTags } : s)),
      };
    });
    return prevState;
  };

  // Add tag to skill（set_skill_tags 整体替换语义）
  const handleAddTagToSkill = (skillId: string, newTag: string) => {
    const skill = skills.find((s) => s.id === skillId);
    if (!skill || skill.tags.includes(newTag)) return;
    const nextTags = [...skill.tags, newTag];
    const prevState = applySkillTagsOptimistic(skillId, nextTags);
    setTagsMutation.mutate(
      { ids: [skillId], tags: nextTags },
      {
        onSuccess: () => addToast('success', '标签已添加', `已为技能添加 #${newTag}`),
        onError: (err) => {
          if (prevState) queryClient.setQueryData(APP_STATE_KEY, prevState);
          addToast('error', '标签添加失败', errorToString(err));
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
      },
    );
  };

  const handleRemoveTagFromSkill = (skillId: string, tagToRemove: string) => {
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) return;
    const nextTags = skill.tags.filter((t) => t !== tagToRemove);
    const prevState = applySkillTagsOptimistic(skillId, nextTags);
    setTagsMutation.mutate(
      { ids: [skillId], tags: nextTags },
      {
        onSuccess: () => addToast('info', '标签已移除', `已移除标签 #${tagToRemove}`),
        onError: (err) => {
          if (prevState) queryClient.setQueryData(APP_STATE_KEY, prevState);
          addToast('error', '标签移除失败', errorToString(err));
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: APP_STATE_KEY }),
      },
    );
  };

  // Save settings（设置页 / 新手引导共用）；分发方式变更时提示一键重部署
  const handleSaveSettings = async (newSettings: AppSettings): Promise<boolean> => {
    try {
      const affected = await updateSettingsMutation.mutateAsync(newSettings);
      addToast('success', '偏好设置已保存并即时生效');
      if (affected.length > 0) {
        setRedeployPromptIds(affected);
      }
      return true;
    } catch (err) {
      addToast('error', '设置保存失败', errorToString(err));
      return false;
    }
  };

  // 一键重部署：按新分发方式重建项目技能的链接/副本
  const handleRedeployProjectLinks = () => {
    const ids = redeployPromptIds ?? [];
    if (ids.length === 0) return;
    redeployLinksMutation.mutate(ids, {
      onSuccess: (count) => {
        setRedeployPromptIds(null);
        addToast(
          'success',
          '重新部署完成',
          `已按新分发方式重建 ${count} 个项目技能的链接/副本。`,
        );
      },
      onError: (err) => addToast('error', '重新部署失败', errorToString(err)),
    });
  };

  // ===== 首屏 Loading / 错误态 =====
  if (appStateQuery.isLoading) {
    return (
      <div className="flex flex-col h-screen w-full bg-white items-center justify-center gap-4 select-none">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
        <div className="text-sm font-semibold text-slate-700">正在加载 SkillDock 数据...</div>
        <div className="text-xs text-slate-400">正在读取技能仓库、工具适配器与设置</div>
      </div>
    );
  }

  if (appStateQuery.isError || !appState) {
    return (
      <div className="flex flex-col h-screen w-full bg-white items-center justify-center gap-4 select-none px-6">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="text-sm font-semibold text-slate-800">应用状态加载失败</div>
        <div className="text-xs text-slate-500 max-w-md text-center leading-relaxed">
          {errorToString(appStateQuery.error) || '无法读取本地技能仓库数据，请确认后端服务正常运行。'}
        </div>
        <button
          onClick={() => appStateQuery.refetch()}
          className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-xs"
        >
          重新加载
        </button>
      </div>
    );
  }

  const settings = appState.settings;

  return (
    <div className="flex flex-col h-screen w-full bg-white text-slate-900 select-none overflow-hidden font-sans">
      {/* 无边框窗口：标题栏与主导航合并为一行（含自绘窗口控制按钮） */}
      <HeaderBar
        totalSkillsCount={skills.length}
        updateAvailableCount={updateAvailableCount}
        locale={settings.locale}
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          handleClearSelection();
        }}
      />

      {/* Main App Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* TAB 1: Installed Skills Management (with Left Filter Sidebar) */}
        <div className={`flex-1 overflow-hidden ${currentTab === 'installed' ? 'flex' : 'hidden'}`}>
          <Sidebar
            locale={settings.locale}
            selectedScope={selectedScope}
            onSelectScope={setSelectedScope}
            projectList={projects.map((p) => ({
              id: p.id,
              name: p.name,
              count: p.skillCount,
            }))}
            globalCount={skills.filter((s) => s.scope === 'global').length}
            totalCount={skills.length}
            allTags={allTags}
            selectedTags={selectedTags}
            onToggleTag={handleToggleTag}
            onClearTags={() => setSelectedTags([])}
            onOpenRegisterProject={() => {
              setSettingsSubTab('projects');
              setCurrentTab('settings');
            }}
          />

          {/* Right Skills Main Content */}
          <main className="flex-1 flex flex-col min-w-0 bg-[#FBFBFC] overflow-hidden">
            {/* Action Toolbar（与左侧栏头部同高，保证底部横线对齐） */}
            <div data-no-translate className="h-[61px] px-6 bg-white/95 backdrop-blur-xs border-b border-slate-200/80 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder={t('搜索技能名称、描述、标签或仓库...', 'Search skills, descriptions, tags, or repositories...')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors placeholder:text-slate-400 shadow-2xs"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs w-4 h-4 rounded-full flex items-center justify-center bg-slate-200/80"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Right Actions: Check Updates + Updates + Selection Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleCheckUpdates}
                  disabled={checkUpdatesMutation.isPending}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                    updateAvailableCount > 0
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-2xs'
                  }`}
                  title={t('一键检查所有技能的远端 Git 提交与版本更新', 'Check remote Git commits and updates for every skill')}
                >
                  <RotateCw className={`w-4 h-4 ${checkUpdatesMutation.isPending ? 'animate-spin text-indigo-600' : 'text-slate-500'}`} />
                  <span>{checkUpdatesMutation.isPending
                    ? t('检测中...', 'Checking...')
                    : updateAvailableCount > 0
                      ? t(`有 ${updateAvailableCount} 项待更新`, `${updateAvailableCount} updates available`)
                      : t('检查更新', 'Check for updates')}</span>
                </button>

                {updateAvailableCount > 0 && (
                  <button
                    onClick={handleUpdateAll}
                    disabled={bulkUpdateMutation.isPending}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:opacity-60 text-white text-sm font-semibold shadow-xs transition-colors"
                  title={t('一键将所有有更新的技能更新至远程最新提交', 'Update every skill with an available remote update')}
                >
                  <RotateCw className={`w-4 h-4 ${bulkUpdateMutation.isPending ? 'animate-spin' : ''}`} />
                  <span>{t(`全部更新 (${updateAvailableCount})`, `Update all (${updateAvailableCount})`)}</span>
                </button>
                )}

                <span className="h-4 w-px bg-slate-200 mx-1" />

                <span className="text-sm text-slate-500">
                  {appSettings?.locale === 'en' ? (
                    <>Showing <strong className="text-slate-800">{filteredSkills.length}</strong> / {skills.length}</>
                  ) : (
                    <>显示 <strong className="text-slate-800">{filteredSkills.length}</strong> / {skills.length} 项</>
                  )}
                </span>

                {filteredSkills.length > 0 && (
                  <button
                    onClick={handleToggleSelectAll}
                    className={`text-sm font-medium px-3 py-1.5 rounded-xl transition-colors ${
                      isAllFilteredSelected
                        ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 font-semibold'
                        : 'text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-indigo-200/60'
                    }`}
                    title={isAllFilteredSelected
                      ? t('取消当前列表中的所有选中', 'Clear all selections in this list')
                      : t('全选当前列表中的所有技能', 'Select every skill in this list')}
                  >
                    {isAllFilteredSelected ? t('取消全选', 'Clear selection') : t('全选当前', 'Select all')}
                  </button>
                )}
              </div>
            </div>

            {/* Skills Card List Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
              {filteredSkills.length === 0 ? (
                <div className="py-16 text-center space-y-4 max-w-md mx-auto">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Package className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">未找到符合条件的技能</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      请调整搜索关键词或重置项目/标签筛选条件。
                    </p>
                  </div>
                  <div className="pt-2 flex items-center justify-center gap-2">
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedScope('all');
                        setSelectedTags([]);
                      }}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 shadow-2xs transition-colors"
                    >
                      重置所有筛选
                    </button>
                    <button
                      onClick={() => setCurrentTab('discovery')}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs"
                    >
                      发现新技能
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      tools={tools}
                      isSelected={selectedSkillIds.has(skill.id)}
                      onToggleSelect={handleToggleSelect}
                      onToggleToolDeploy={handleToggleToolDeploy}
                      onUpdateSingle={handleUpdateSingle}
                      onOpenTagEdit={handleOpenTagEdit}
                      onUninstallSingle={handleUninstallSingle}
                      onGenerateDescSingle={handleGenerateSingleDescription}
                      isUpdating={updatingSkillIds.has(skill.id) || (skill.hasUpdate && bulkUpdateMutation.isPending)}
                      isGeneratingDesc={generatingDescSkillIds.has(skill.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>

        {/* TAB 2: Discovery and Installation */}
        <main className={`flex-1 flex-col min-w-0 bg-[#FBFBFC] overflow-hidden ${currentTab === 'discovery' ? 'flex' : 'hidden'}`}>
          <DiscoveryView
            installedSkills={skills}
            addToast={addToast}
            onSelectInstall={(item) => setInstallItems([item])}
            onBatchInstall={(items) => setInstallItems(items)}
          />
        </main>

        {/* TAB 3: Settings Page (Unified Settings, Tools, Projects, Models, About) */}
        <main className={`flex-1 flex-col min-w-0 bg-[#FBFBFC] overflow-hidden ${currentTab === 'settings' ? 'flex' : 'hidden'}`}>
          <SettingsView
            settings={settings}
            tools={tools}
            projects={projects}
            skills={skills}
            addToast={addToast}
            onSaveSettings={handleSaveSettings}
            onOpenOnboarding={() => setShowOnboarding(true)}
            onFilterByProject={(projectId) => {
              setSelectedScope(projectId);
              setCurrentTab('installed');
            }}
            activeSubTab={settingsSubTab}
            onSelectSubTab={setSettingsSubTab}
          />
        </main>
      </div>

      {/* Floating Bottom Batch Operations Bar */}
      <BatchBar
        selectedCount={visibleSelectedSkills.length}
        totalCount={filteredSkills.length}
        tools={tools}
        isPending={
          bulkToggleMutation.isPending ||
          bulkUninstallMutation.isPending ||
          bulkUpdateMutation.isPending ||
          descBusy
        }
        onClearSelection={handleClearSelection}
        onSelectAll={handleSelectAll}
        onBatchDeployTool={handleBatchDeployTool}
        onBatchShare={() => setShareTarget({ isBatch: true })}
        onBatchUninstall={() => requestUninstall(visibleSelectedSkills)}
        onGenerateDescriptions={handleGenerateDescriptions}
      />

      {/* Modals & Dialogs */}
      {/* 1. Unified Install Modal */}
      {installItems.length > 0 && (
        <InstallModal
          items={installItems}
          tools={tools}
          projects={projects}
          onClose={() => {
            if (!isBatchInstalling && !installUnifiedMutation.isPending) {
              setInstallItems([]);
              setInstallError(null);
            }
          }}
          onConfirmInstall={handleCompleteInstall}
          isInstalling={isBatchInstalling || installUnifiedMutation.isPending}
          installProgress={installProgress}
          installError={installError}
        />
      )}

      {/* 3. Share Modal */}
      {shareTarget && (
        <ShareModal
          skill={shareTarget.skill || null}
          selectedSkills={shareTarget.isBatch ? visibleSelectedSkills : []}
          onClose={() => setShareTarget(null)}
          addToast={addToast}
        />
      )}

      {/* 4. Tag Edit Modal */}
      {tagEditingSkill && (
        <TagEditModal
          skill={tagEditingSkill}
          allAvailableTags={allTags.map((t) => t.name)}
          isPending={setTagsMutation.isPending}
          onClose={() => setTagEditingSkillId(null)}
          onAddTag={handleAddTagToSkill}
          onRemoveTag={handleRemoveTagFromSkill}
        />
      )}

      {/* 5. Uninstall Confirmation Dialog */}
      <UninstallDialog
        isOpen={skillsToUninstall.length > 0}
        skillsToUninstall={skillsToUninstall}
        isProcessing={bulkUninstallMutation.isPending}
        onClose={() => setSkillsToUninstall([])}
        onConfirm={handleConfirmUninstall}
      />

      {/* 5.5 分发方式变更后的一键重部署提示 */}
      {redeployPromptIds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-96 p-6 space-y-4 select-none">
            <h3 className="text-sm font-bold text-slate-800">分发方式已变更</h3>
            <p className="text-xs leading-relaxed text-slate-500">
              {redeployPromptIds.length} 个项目技能仍按旧方式部署，是否立即按新方式重建链接/副本？
              跳过后可在项目页重新安装对应技能。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRedeployPromptIds(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              >
                稍后处理
              </button>
              <button
                onClick={handleRedeployProjectLinks}
                disabled={redeployLinksMutation.isPending}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-60"
              >
                {redeployLinksMutation.isPending ? '部署中…' : '立即重新部署'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Onboarding & Migration Modal（条件挂载，重开时内部状态随之重置） */}
      {showOnboarding && (
        <OnboardingModal
          isOpen={showOnboarding}
          tools={tools}
          settings={settings}
          addToast={addToast}
          onSaveSettings={handleSaveSettings}
          onClose={handleCloseOnboarding}
          isMandatory={onboardingCompleted === false}
        />
      )}

      {/* Toast 通知容器（最顶层） */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
