import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesSelectedTags } from './tagFilter.ts';

test('matches a skill when it includes any selected tag', () => {
  assert.equal(matchesSelectedTags(['frontend', 'react'], ['frontend', 'react']), true);
  assert.equal(matchesSelectedTags(['frontend'], ['frontend', 'react']), true);
  assert.equal(matchesSelectedTags(['react'], ['frontend', 'react']), true);
  assert.equal(matchesSelectedTags(['backend'], ['frontend', 'react']), false);
});

test('matches all skills when no tags are selected', () => {
  assert.equal(matchesSelectedTags([], []), true);
  assert.equal(matchesSelectedTags(['backend'], []), true);
});
