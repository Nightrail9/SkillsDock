export interface SequentialBulkActionFailure<T> {
  item: T;
  error: unknown;
}

export interface SequentialBulkActionResult<T> {
  succeeded: T[];
  failed: Array<SequentialBulkActionFailure<T>>;
}

/**
 * 串行执行批量操作：每个操作都会写磁盘/配置文件，
 * 并行执行可能互相覆盖，因此逐项顺序执行并汇总成功/失败。
 */
export async function runSequentialBulkAction<T>(
  items: readonly T[],
  action: (item: T) => Promise<unknown>,
): Promise<SequentialBulkActionResult<T>> {
  const succeeded: T[] = [];
  const failed: Array<SequentialBulkActionFailure<T>> = [];

  for (const item of items) {
    try {
      await action(item);
      succeeded.push(item);
    } catch (error) {
      failed.push({ item, error });
    }
  }

  return { succeeded, failed };
}
