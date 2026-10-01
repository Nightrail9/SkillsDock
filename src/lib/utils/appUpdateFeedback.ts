/**
 * 生成应用更新检查的“已是最新版本”反馈。
 *
 * @param updateAvailable 检查结果是否发现新版本。
 * @param translate 根据界面语言选择文案的翻译函数。
 * @returns 无更新时返回本地化反馈，有更新时返回 null。
 */
export function getAppUpdateCheckFeedback(
  updateAvailable: boolean,
  translate: (zh: string, en: string) => string,
): string | null {
  if (updateAvailable) return null;
  return translate('当前已是最新版本', 'You are up to date');
}
