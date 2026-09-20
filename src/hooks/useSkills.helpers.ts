import type { Skill } from '../types';

/**
 * 合并本次导入结果到已安装缓存，按 id 去重。
 *
 * 同一技能重复出现时以新记录为准，避免 mutation 被重复触发时
 * 在 installed 列表中看到重复条目。imported 为空时返回原引用，
 * 让 React Query 跳过无谓的订阅者通知。
 */
export function mergeImportedSkills(
  existing: Skill[] | undefined,
  imported: Skill[],
): Skill[] {
  if (imported.length === 0) return existing ?? imported;

  const merged = new Map(existing?.map((skill) => [skill.id, skill]));
  for (const skill of imported) {
    merged.set(skill.id, skill);
  }
  return Array.from(merged.values());
}

/**
 * 按作用域拆分已安装技能：全局技能 + 按项目分组的项目级技能。
 *
 * scope 缺省视为 "global"。byProject 的 key 为 projectId，
 * 项目级技能缺少 projectId 时归入空字符串分组，避免静默丢失。
 */
export function splitSkillsByScope(skills: Skill[]): {
  global: Skill[];
  byProject: Map<string, Skill[]>;
} {
  const global: Skill[] = [];
  const byProject = new Map<string, Skill[]>();

  for (const skill of skills) {
    if ((skill.scope ?? 'global') === 'project') {
      const key = skill.projectId ?? '';
      const list = byProject.get(key);
      if (list) {
        list.push(skill);
      } else {
        byProject.set(key, [skill]);
      }
    } else {
      global.push(skill);
    }
  }

  return { global, byProject };
}

/** 单个标签分组：tag 为 null 表示未分组的兜底分组 */
export interface SkillTagGroup {
  tag: string | null;
  skills: Skill[];
}

/**
 * 收集标签词表：对现有技能的 tags 去重，
 * 按使用频次降序、同频次按字母序排列。
 */
export function collectTagVocabulary(skills: Skill[]): string[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    for (const tag of skill.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/**
 * 按标签分组技能：一个技能有多个标签时会出现在每个标签组中；
 * 无标签技能归入最后的未分组（tag 为 null）兜底分组。
 * 标签组顺序与 collectTagVocabulary 一致。
 */
export function groupSkillsByTag(skills: Skill[]): SkillTagGroup[] {
  const vocabulary = collectTagVocabulary(skills);
  const groupIndex = new Map(vocabulary.map((tag, index) => [tag, index]));
  const groups: SkillTagGroup[] = vocabulary.map((tag) => ({
    tag,
    skills: [],
  }));
  const untagged: Skill[] = [];

  for (const skill of skills) {
    const tags = skill.tags ?? [];
    if (tags.length === 0) {
      untagged.push(skill);
      continue;
    }
    for (const tag of tags) {
      const index = groupIndex.get(tag);
      if (index !== undefined) {
        groups[index].skills.push(skill);
      }
    }
  }

  if (untagged.length > 0) {
    groups.push({ tag: null, skills: untagged });
  }
  return groups;
}
