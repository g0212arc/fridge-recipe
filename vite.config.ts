import { defineConfig } from 'vite';

// GitHub Pages のサブディレクトリ（/fridge-recipe/）でも、ローカルの静的サーバーでも
// そのまま動くよう、資産の参照は相対パスにしておく。
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets' },
  test: { environment: 'node', include: ['src/**/__tests__/**/*.test.ts'] },
});
