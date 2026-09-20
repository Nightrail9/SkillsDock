import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Tauri 打包使用相对路径加载产物
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    // 防止 Tauri 开发时清屏掩盖报错
    clearScreen: false,
    server: {
      host: '127.0.0.1',
      port: 3000,
      strictPort: true,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
  };
});
