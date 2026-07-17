import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // /api → Spring Boot 백엔드 (백엔드가 없으면 프록시 에러 → 앱은 localStorage 모드로 폴백)
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  preview: {
    proxy: { '/api': 'http://localhost:8080' },
  },
})
