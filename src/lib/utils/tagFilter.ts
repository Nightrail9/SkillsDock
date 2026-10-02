/**
 * Determines whether a skill contains every selected tag.
 * @param skillTags Tags assigned to the skill.
 * @param selectedTags Tags selected by the user.
 * @returns True when every selected tag is present; an empty selection matches all skills.
 */
export function matchesSelectedTags(
  skillTags: readonly string[],
  selectedTags: readonly string[],
): boolean {
  return selectedTags.length === 0 || selectedTags.every((tag) => skillTags.includes(tag));
}
