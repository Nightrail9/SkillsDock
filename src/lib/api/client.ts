import { invoke } from '@tauri-apps/api/core';
import { formatSkillErrorMessage } from '../errors/skillErrorParser';

/**
 * Tauri invoke 封装：统一把后端结构化错误（JSON 字符串 / 前缀文本）
 * 转成中文可读的 Error.message 抛出。
 */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(formatSkillErrorMessage(error));
  }
}
