/**
 * 客户端运行平台识别。
 *
 * Tauri 各 WebView 的 UA 均带平台标识（WebView2: "Windows NT..."、WKWebView:
 * "Macintosh; Intel Mac OS X..."、WebKitGTK: "X11; Linux ..."），无需引入额外插件
 * 即可稳定区分。仅用于界面文案与流程分流，不参与安全判定。
 */
export type ClientPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

export function detectPlatform(): ClientPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}

export const isWindowsPlatform = (): boolean => detectPlatform() === 'windows';
