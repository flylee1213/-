import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  // Google Gemini Key
  const apiKey = env.API_KEY || env.VITE_GEMINI_API_KEY || 'AIzaSyAXnh4mhFeAUsqa5irgt4pj2ytlvO_dElI';
  
  // Alibaba Qwen Key (User provided)
  const qwenKey = env.QWEN_KEY || 'sk-94c9fe1db50a4828b0cf07f166e8114e';
  
  return {
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(apiKey),
      'process.env.QWEN_KEY': JSON.stringify(qwenKey),
    },
  };
});