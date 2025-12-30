import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 优先使用环境变量，如果未找到，则使用提供的 Key 作为后备
  const apiKey = env.API_KEY || env.VITE_GEMINI_API_KEY || 'AIzaSyAXnh4mhFeAUsqa5irgt4pj2ytlvO_dElI';
  
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(apiKey),
    },
  };
});