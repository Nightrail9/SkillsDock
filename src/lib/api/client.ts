import { invoke } from '@tauri-apps/api/core';
import { formatSkillErrorMessage } from '../errors/skillErrorParser';
import { isTauriEnvironment, handleMockInvoke } from './mockData';

/**
 * Tauri invoke 封装：优先通过 Tauri IPC 通信；若在纯 Web 浏览器环境中访问，
 * 自动回退到本地 Mock 运行时，保证界面正常加载与功能预览。
 */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriEnvironment()) {
    return handleMockInvoke<T>(command, args);
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(formatSkillErrorMessage(error));
  }
}
