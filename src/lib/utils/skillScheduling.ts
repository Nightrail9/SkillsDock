/** Returns true only when no known tool currently has the skill distributed. */
export function hasNoToolDeployments(deployedTools: Readonly<Record<string, boolean>>): boolean {
  return !Object.values(deployedTools).some(Boolean);
}
