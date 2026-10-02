import assert from 'node:assert/strict';
import test from 'node:test';
import { hasNoToolDeployments } from './skillScheduling.ts';

test('skills with no deployed tools are schedulable regardless of scope', () => {
  assert.equal(hasNoToolDeployments({}), true);
  assert.equal(hasNoToolDeployments({ claude: false, codex: false }), true);
});

test('any existing tool deployment excludes a skill from scheduling', () => {
  assert.equal(hasNoToolDeployments({ claude: true, codex: false }), false);
});
