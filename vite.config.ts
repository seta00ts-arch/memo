import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages（プロジェクトページ）はリポジトリ名のサブパス配信になるため、
  // CI（GH_PAGES=true）でビルドする時だけ base を切り替える。ローカル開発には影響しない。
  base: process.env.GH_PAGES ? "/memo/" : "/",
  plugins: [react()],
})
