import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vite.dev/config/
// 本地开发默认 `/`；CI 里通过 VITE_BASE=/仓库名/ 适配 github.io/仓库名/ 子路径
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        404: resolve(__dirname, '404.html'),
      },
    },
  },
})
