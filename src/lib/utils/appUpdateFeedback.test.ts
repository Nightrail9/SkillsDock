import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppUpdateCheckFeedback } from './appUpdateFeedback.ts';

test('shows localized feedback when no app update is available', () => {
  const feedback = getAppUpdateCheckFeedback(false, (zh) => zh);

  assert.equal(feedback, '当前已是最新版本');
});

test('does not show latest-version feedback when an update is available', () => {
  const feedback = getAppUpdateCheckFeedback(true, (zh) => zh);

  assert.equal(feedback, null);
});
