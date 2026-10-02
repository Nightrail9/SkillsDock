import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesSelectedScope, matchesSelectedTools } from './skillFilters.ts';

test('scope filter excludes undistributed skills only from global scope', () => {
  assert.equal(matchesSelectedScope('global', [], 'all', false), true);
  assert.equal(matchesSelectedScope('project', ['project-a'], 'all', false), true);
  assert.equal(matchesSelectedScope('global', [], 'project-a', true), false);
  assert.equal(matchesSelectedScope('project', ['project-a', 'project-b'], 'project-a', false), true);
  assert.equal(matchesSelectedScope('project', ['project-b'], 'project-a', false), false);
  assert.equal(matchesSelectedScope('global', [], 'global', true), true);
  assert.equal(matchesSelectedScope('global', [], 'global', false), false);
});

test('tool filters match any selected tool', () => {
  assert.equal(matchesSelectedTools({ claude: true, codex: false }, []), true);
  assert.equal(matchesSelectedTools({ claude: true, codex: false }, ['claude', 'codex']), true);
  assert.equal(matchesSelectedTools({ claude: false, codex: false }, ['claude', 'codex']), false);
});


