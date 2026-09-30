import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSkillActiveInSelectedTools,
  matchesSelectedToolAndEffectFilter,
  matchesSelectedScope,
  matchesSelectedTools,
  toggleSkillEffectFilter,
} from './skillFilters.ts';

test('project scope includes only skills owned by that project', () => {
  assert.equal(matchesSelectedScope('global', undefined, 'all'), true);
  assert.equal(matchesSelectedScope('project', 'project-a', 'all'), true);
  assert.equal(matchesSelectedScope('global', undefined, 'project-a'), false);
  assert.equal(matchesSelectedScope('project', 'project-a', 'project-a'), true);
  assert.equal(matchesSelectedScope('project', 'project-b', 'project-a'), false);
  assert.equal(matchesSelectedScope('global', undefined, 'global'), true);
});

test('tool filters match any selected tool', () => {
  assert.equal(matchesSelectedTools({ claude: true, codex: false }, []), true);
  assert.equal(matchesSelectedTools({ claude: true, codex: false }, ['claude', 'codex']), true);
  assert.equal(matchesSelectedTools({ claude: false, codex: false }, ['claude', 'codex']), false);
});

test('effect status requires an enabled tool with the skill deployed', () => {
  const tools = [
    { id: 'claude', isEnabled: true },
    { id: 'codex', isEnabled: false },
  ];
  assert.equal(isSkillActiveInSelectedTools({ claude: true }, tools, []), true);
  assert.equal(isSkillActiveInSelectedTools({ codex: true }, tools, []), false);
  assert.equal(isSkillActiveInSelectedTools({ claude: true }, tools, ['codex']), false);
  assert.equal(isSkillActiveInSelectedTools({ claude: false }, tools, []), false);
});

test('skill enablement filter toggles off when its selected option is clicked again', () => {
  assert.equal(toggleSkillEffectFilter('all', 'active'), 'active');
  assert.equal(toggleSkillEffectFilter('active', 'active'), 'all');
  assert.equal(toggleSkillEffectFilter('inactive', 'active'), 'active');
  assert.equal(toggleSkillEffectFilter('all', 'inactive'), 'inactive');
  assert.equal(toggleSkillEffectFilter('inactive', 'inactive'), 'all');
});

test('selected tools limit status checks without requiring deployment when status is selected', () => {
  const tools = [
    { id: 'claude', isEnabled: true },
    { id: 'codex', isEnabled: true },
    { id: 'disabled-tool', isEnabled: false },
  ];

  assert.equal(matchesSelectedToolAndEffectFilter({}, tools, ['claude'], 'inactive'), true);
  assert.equal(matchesSelectedToolAndEffectFilter({ claude: true }, tools, ['claude'], 'inactive'), false);
  assert.equal(matchesSelectedToolAndEffectFilter({ codex: true }, tools, ['claude'], 'inactive'), true);
  assert.equal(matchesSelectedToolAndEffectFilter({ codex: true }, tools, [], 'inactive'), false);
  assert.equal(matchesSelectedToolAndEffectFilter({ 'disabled-tool': true }, tools, [], 'inactive'), true);
  assert.equal(matchesSelectedToolAndEffectFilter({ codex: true }, tools, ['claude'], 'all'), false);
  assert.equal(matchesSelectedToolAndEffectFilter({ claude: true }, tools, ['claude'], 'active'), true);
});
