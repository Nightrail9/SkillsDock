import assert from 'node:assert/strict';
import test from 'node:test';
import { runSequentialBulkAction } from './sequentialBulkAction.ts';

test('notifies after each bulk item settles and continues after failures', async () => {
  const settled: Array<[string, string | undefined]> = [];
  const result = await runSequentialBulkAction(
    ['first', 'second', 'third'],
    async (item) => {
      if (item === 'second') throw new Error('second failed');
    },
    (item, error) => settled.push([item, error instanceof Error ? error.message : undefined]),
  );

  assert.deepEqual(settled, [
    ['first', undefined],
    ['second', 'second failed'],
    ['third', undefined],
  ]);
  assert.deepEqual(result.succeeded, ['first', 'third']);
  assert.equal(result.failed[0]?.item, 'second');
});
