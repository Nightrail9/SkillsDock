/**
 * LLM API Key 的客户端存储。
 *
 * 个人本地工具：Key 不写数据库、不存系统凭据库，只保存在当前客户端
 * （WebView localStorage），由输入框（可切换可见性）维护，按 IPC 调用传给后端。
 */

export const API_KEY_STORAGE_KEY = 'skilldock.llm.apiKey';

/** 读取客户端保存的 API Key（无则空串） */
export function readLlmApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 写入或清除客户端保存的 API Key */
export function writeLlmApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // 存储不可用（隐私模式等）时静默降级为仅内存
  }
}
