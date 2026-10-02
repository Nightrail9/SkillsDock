
/**
 * Determines whether a skill belongs to the selected scope.
 * Global scope lists only globally deployed skills; project-scoped skills may belong to multiple projects.
 */
export function matchesSelectedScope(
  skillScope: 'global' | 'project',
  skillProjectIds: readonly string[],
  selectedScope: string,
  isGloballyAvailable: boolean,
): boolean {
  if (selectedScope === 'all') return true;
  if (selectedScope === 'global') return skillScope === 'global' && isGloballyAvailable;
  return skillScope === 'project' && skillProjectIds.includes(selectedScope);
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


