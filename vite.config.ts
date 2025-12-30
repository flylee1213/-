import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    define: {
      // 优先使用系统提供的 API_KEY，如果没有则尝试查找 VITE_GEMINI_API_KEY
      // 使用 || '' 确保如果未定义，前端收到的是空字符串而不是 undefined，避免潜在的引用错误
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.VITE_GEMINI_API_KEY || ''),
    },
  };
});