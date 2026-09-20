/**
 * 把用户主目录下的绝对路径折叠为 `~/...` 形式用于展示。
 * 比较时忽略大小写与路径分隔符差异；不在主目录下的路径原样返回。
 */
export function collapseHomePath(path: string, homeDir?: string): string {
  if (!path || !homeDir) return path;
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const p = norm(path);
  const h = norm(homeDir);
  if (!h) return path;
  if (p.toLowerCase() === h.toLowerCase()) return '~';
  if (p.toLowerCase().startsWith(`${h.toLowerCase()}/`)) {
    return `~${p.slice(h.length)}`;
  }
  return path;
}
