import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesSelectedTags } from './tagFilter.ts';

test('requires every selected tag to match a skill', () => {
  assert.equal(matchesSelectedTags(['frontend', 'react'], ['frontend', 'react']), true);
  assert.equal(matchesSelectedTags(['frontend'], ['frontend', 'react']), false);
  assert.equal(matchesSelectedTags(['react'], ['frontend', 'react']), false);
  assert.equal(matchesSelectedTags(['backend'], ['frontend', 'react']), false);
});

test('matches all skills when no tags are selected', () => {
  assert.equal(matchesSelectedTags([], []), true);
  assert.equal(matchesSelectedTags(['backend'], []), true);
});
