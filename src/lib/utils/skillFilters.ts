export interface ToolEffectState {
  id: string;
  isEnabled: boolean;
}

export type SkillEffectFilter = 'all' | 'active' | 'inactive';

/**
 * Toggles a skill enablement filter, clearing it when the selected option is clicked again.
 * @param currentFilter The currently selected filter.
 * @param requestedFilter The active or inactive filter requested by the user.
 * @returns `all` when the request repeats the current filter, otherwise the requested filter.
 */
export function toggleSkillEffectFilter(
  currentFilter: SkillEffectFilter,
  requestedFilter: Exclude<SkillEffectFilter, 'all'>,
): SkillEffectFilter {
  return currentFilter === requestedFilter ? 'all' : requestedFilter;
}

/**
 * Determines whether a skill belongs to the selected scope.
 * @param skillScope The skill's global or project scope.
 * @param skillProjectId The owning project id for project-scoped skills.
 * @param selectedScope The selected scope, project id, or `all`.
 * @returns True when the skill belongs to the selected scope. A project selection matches only that project.
 */
export function matchesSelectedScope(
  skillScope: 'global' | 'project',
  skillProjectId: string | undefined,
  selectedScope: string,
): boolean {
  if (selectedScope === 'all') return true;
  if (selectedScope === 'global') return skillScope === 'global';
  return skillScope === 'project' && skillProjectId === selectedScope;
}

/**
 * Determines whether a skill is deployed to any selected tool.
 * @param deployedTools Tool ids mapped to this skill's deployment state.
 * @param selectedToolIds Tool ids selected by the user.
 * @returns True when any selected tool has this skill deployed, or when no tool is selected.
 */
export function matchesSelectedTools(
  deployedTools: Readonly<Record<string, boolean>>,
  selectedToolIds: readonly string[],
): boolean {
  return selectedToolIds.length === 0 || selectedToolIds.some((toolId) => deployedTools[toolId]);
}

/**
 * Checks whether a skill is active in at least one relevant enabled tool.
 * @param deployedTools Tool ids mapped to this skill's deployment state.
 * @param tools Known tool enablement states.
 * @param selectedToolIds When non-empty, limits the check to these tools.
 * @returns True when the skill is deployed to an enabled relevant tool.
 */
export function isSkillActiveInSelectedTools(
  deployedTools: Readonly<Record<string, boolean>>,
  tools: readonly ToolEffectState[],
  selectedToolIds: readonly string[],
): boolean {
  return tools.some((tool) =>
    (selectedToolIds.length === 0 || selectedToolIds.includes(tool.id)) &&
    tool.isEnabled &&
    deployedTools[tool.id],
  );
}

/**
 * Applies tool deployment filtering or uses selected tools as the status evaluation scope.
 * @param deployedTools Tool ids mapped to this skill's deployment state.
 * @param tools Known tool enablement states.
 * @param selectedToolIds Tool ids selected by the user.
 * @param effectFilter The requested skill enablement status.
 * @returns True when the skill matches the selected tool and status conditions.
 */
export function matchesSelectedToolAndEffectFilter(
  deployedTools: Readonly<Record<string, boolean>>,
  tools: readonly ToolEffectState[],
  selectedToolIds: readonly string[],
  effectFilter: SkillEffectFilter,
): boolean {
  if (effectFilter === 'all') {
    return matchesSelectedTools(deployedTools, selectedToolIds);
  }

  const isActive = isSkillActiveInSelectedTools(deployedTools, tools, selectedToolIds);
  return effectFilter === 'active' ? isActive : !isActive;
}
