import assert from 'node:assert/strict';
import test from 'node:test';
import { toImportSkillSelections } from './useSkills.helpers.ts';

test('onboarding imports each unmanaged skill only into its discovered tools', () => {
  const selections = toImportSkillSelections([
    {
      directory: 'skill-4',
      sourceDirectory: 'skill-4',
      relativePath: 'skill-4',
      name: 'Skill 4',
      foundIn: ['tool-two'],
      path: '/tool-two/skills/skill-4',
    },
  ]);

  assert.deepEqual(selections, [
    {
      directory: 'skill-4',
      sourceDirectory: 'skill-4',
      relativePath: 'skill-4',
      toolIds: ['tool-two'],
    },
  ]);
});
